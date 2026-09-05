"""Deterministic geometry / topology validation for floor-plan output (Phase 4).

Plain rule-based checking — NOT AI, NOT a legal cadastral validation. Mirrors the
Phase-2 convention: each rule yields VALID | WARNING | ERROR with a ``rule`` slug,
``featureId`` and a human-readable ``message``. Repairable geometry is already
repaired upstream; here nothing is silently dropped.

Building/floor-association rules (unit-outside-building, floor-outside-building,
incorrect-floor-association) are enforced in the Node layer
(``services/aiFloorPlans/associate.js``) where the real building geometry lives;
this module records that they are pending as INFO.
"""
from __future__ import annotations

from .config import settings
from .geometry import iou

RANK = {"VALID": 0, "WARNING": 1, "ERROR": 2}


def _worse(a: str, b: str) -> str:
    return b if RANK.get(b, 0) > RANK.get(a, 0) else a


def _issue(level, feature_id, status, rule, message):
    return {
        "level": level,
        "featureId": feature_id,
        "status": status,
        "severity": status,
        "rule": rule,
        "message": message,
    }


def validate(*, rooms, units, common_areas, unclassified, doors, nodes, edges,
             width, height, scale_m_per_px):
    issues: list[dict] = []

    node_ids = {n["id"] for n in nodes}

    # 1/2/11 — per-room intrinsic geometry
    for r in rooms:
        if r["geometryStatus"] == "ERROR":
            issues.append(_issue("Room", r["featureId"], "ERROR", "ROOM_GEOMETRY_VALID",
                                 f"Room {r['featureId']} has invalid/unrepairable geometry."))
        elif r["geometryStatus"] == "WARNING":
            issues.append(_issue("Room", r["featureId"], "WARNING", "ROOM_GEOMETRY_REPAIRED",
                                 f"Room {r['featureId']} geometry was repaired: {'; '.join(r['geometryIssues'])}."))
        if r["areaPx"] <= 0:
            issues.append(_issue("Room", r["featureId"], "ERROR", "ROOM_AREA_POSITIVE",
                                 f"Room {r['featureId']} has non-positive area."))

    # 3/5 — duplicate / inappropriate room overlap
    geoms = [(r["featureId"], r.get("geom")) for r in rooms]
    for i in range(len(geoms)):
        for j in range(i + 1, len(geoms)):
            fi, gi = geoms[i]
            fj, gj = geoms[j]
            if gi is None or gj is None:
                continue
            ov = iou(gi, gj)
            if ov >= settings.duplicate_iou:
                issues.append(_issue("Room", fj, "WARNING", "ROOM_DUPLICATE",
                                     f"Room {fj} duplicates {fi} (IoU {ov:.2f})."))
            elif ov >= settings.overlap_iou_flag:
                issues.append(_issue("Room", f"{fi}/{fj}", "WARNING", "ROOM_OVERLAP",
                                     f"Rooms {fi} and {fj} overlap (IoU {ov:.2f}) — rooms should be disjoint."))

    # 4/12 — unit overlap + disconnected unit geometry
    for i in range(len(units)):
        ui = units[i]
        if ui["unitBoundary"].get("type") == "MultiPolygon":
            issues.append(_issue("Unit", ui["featureId"], "WARNING", "UNIT_GEOMETRY_CONNECTED",
                                 f"Unit {ui['featureId']} boundary is disconnected (multi-part)."))
        if ui["area"] is not None and ui["area"] <= 0:
            issues.append(_issue("Unit", ui["featureId"], "ERROR", "UNIT_AREA_POSITIVE",
                                 f"Unit {ui['featureId']} has non-positive area."))
        for j in range(i + 1, len(units)):
            uj = units[j]
            si, sj = set(ui["rooms"]), set(uj["rooms"])
            if si & sj:
                issues.append(_issue("Unit", f"{ui['featureId']}/{uj['featureId']}", "ERROR",
                                     "UNIT_ROOMS_DISJOINT",
                                     f"Units {ui['featureId']} and {uj['featureId']} share room(s) {sorted(si & sj)}."))

    # 6 — coverage gap: how much interior space is not inside any unit/common
    interior_px = float(width * height)
    covered = sum(u["areaPx"] for u in units) + sum(c["areaPx"] for c in common_areas)
    room_px = sum(r["areaPx"] for r in rooms) or 1.0
    if room_px and covered / room_px < 0.6 and rooms:
        issues.append(_issue("Floor", "unit-coverage", "WARNING", "UNIT_BOUNDARY_GAPS",
                             f"Only {covered / room_px * 100:.0f}% of detected room area is assigned to a unit or common area."))

    # 8 — room placed in no unit and not common
    placed = {rid for u in units for rid in u["rooms"]} | {rid for c in common_areas for rid in c["rooms"]}
    for r in rooms:
        if r["featureId"] not in placed and r.get("geom") is not None:
            issues.append(_issue("Room", r["featureId"], "WARNING", "ROOM_IN_A_UNIT",
                                 f"Room {r['featureId']} ({r['class']}) is not part of any unit or common area."))
    for u in unclassified:
        issues.append(_issue("Room", u["featureId"], "WARNING", "ROOM_CLASSIFIED",
                             f"Room {u['featureId']} could not be classified ({u['reason']})."))

    # 13 — excessive tiny polygons / room explosion
    if len(rooms) > settings.max_rooms:
        issues.append(_issue("Floor", "room-count", "WARNING", "EXCESSIVE_ROOMS",
                             f"{len(rooms)} rooms detected (> {settings.max_rooms}) — likely segmentation noise."))

    # 14 — topology integrity
    for e in edges:
        if e["from"] not in node_ids or e["to"] not in node_ids:
            issues.append(_issue("Topology", e.get("via", "?"), "ERROR", "TOPOLOGY_VALID",
                                 f"Graph edge references an unknown node: {e}."))
    for d in doors:
        for rid in d["connectedRooms"]:
            if rid not in node_ids:
                issues.append(_issue("Door", d["featureId"], "WARNING", "DOOR_ROOMS_EXIST",
                                     f"Door {d['featureId']} connects unknown room {rid}."))

    # 15 — missing scale
    if scale_m_per_px is None:
        issues.append(_issue("Floor", "scale", "WARNING", "SCALE_PRESENT",
                             "No pixel->metre scale supplied — areas reported in PIXEL_SQUARED."))

    # 16/17 — elevation + building association are resolved in the Node layer
    issues.append(_issue("Floor", "elevation", "INFO", "ELEVATION_PRESENT",
                         "Floor elevation is unknown at the segmentation stage (set null unless a building/floor reference is provided)."))
    issues.append(_issue("Floor", "building-association", "INFO", "BUILDING_ASSOCIATION_PRESENT",
                         "Building/floor association is resolved by the API layer when buildingId/floorId are provided."))

    counts = {"valid": 0, "warning": 0, "error": 0, "info": 0}
    for i in issues:
        counts[i["status"].lower()] = counts.get(i["status"].lower(), 0) + 1
    status = "VALID"
    for i in issues:
        if i["status"] in RANK:
            status = _worse(status, i["status"])
    return {"status": status, "counts": counts, "issues": issues}
