"""Apartment / property-unit inference (Phase 4) — a core Phase-4 feature.

NOT "every room is an apartment". Units are inferred from the room graph:

  * circulation rooms (CORRIDOR / STAIR) are shared -> never folded into a unit
  * a UNIT = a connected cluster of private rooms joined by interior doors,
    without crossing a circulation node
  * clusters are scored (wet room? living/sleeping room? plausible size?
    valid geometry?) -> confidence; ambiguous clusters get reviewRequired=True
  * rooms that cannot be placed (OTHER / unrepairable geometry) are returned as
    ``unclassified`` — the algorithm does NOT force every polygon into a unit.

Multiple apartments per floor, common corridors, stairs/cores and irregular
shapes are all allowed. Output geometry stays in the LOCAL floor-plan CRS; the
Node layer performs any geographic placement against a real building/floor.
"""
from __future__ import annotations

from shapely.geometry import mapping
from shapely.ops import unary_union

from .config import COMMON_CLASSES, LIVING_CLASSES, WET_ROOM_CLASSES, settings
from .topology import adjacency


def _bbox(geom):
    minx, miny, maxx, maxy = geom.bounds
    return [round(minx, 2), round(miny, 2), round(maxx, 2), round(maxy, 2)]


def _score_cluster(members: list[dict]) -> tuple[float, list[str]]:
    reasons = []
    classes = {m["class"] for m in members}
    has_wet = bool(classes & set(WET_ROOM_CLASSES))
    has_living = bool(classes & set(LIVING_CLASSES))
    n = len(members)

    score = 0.4
    if has_wet:
        score += 0.2
    else:
        reasons.append("no kitchen/bathroom detected in cluster")
    if has_living:
        score += 0.15
    else:
        reasons.append("no living/bedroom detected in cluster")
    if 2 <= n <= 8:
        score += 0.15
    elif n == 1:
        score -= 0.15
        reasons.append("single-room cluster — could be one room, not a unit")
    else:
        score -= 0.1
        reasons.append(f"unusually large cluster ({n} rooms)")

    if any(m["geometryStatus"] == "ERROR" for m in members):
        score -= 0.15
        reasons.append("a member room has invalid geometry")

    return max(0.05, min(0.95, score)), reasons


def infer_units(rooms: list[dict], nodes: list[dict], edges: list[dict],
                scale_m_per_px: float | None):
    """Return (units, common_areas, unclassified)."""
    by_id = {r["featureId"]: r for r in rooms}
    private_ids = [
        r["featureId"] for r in rooms
        if r["class"] not in COMMON_CLASSES and r.get("geom") is not None
    ]
    common_rooms = [r for r in rooms if r["class"] in COMMON_CLASSES]
    unclassified = [
        {"featureId": r["featureId"], "class": r["class"], "reason": "unrepairable geometry"}
        for r in rooms if r.get("geom") is None
    ]

    adj = adjacency(nodes, edges)

    # connected components over PRIVATE rooms only (don't traverse circulation)
    seen: set[str] = set()
    clusters: list[list[str]] = []
    private_set = set(private_ids)
    for rid in private_ids:
        if rid in seen:
            continue
        stack = [rid]
        comp = []
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            comp.append(cur)
            for nb in adj.get(cur, ()):
                if nb in private_set and nb not in seen:
                    stack.append(nb)
        clusters.append(comp)

    units = []
    for idx, comp in enumerate(clusters, start=1):
        members = [by_id[c] for c in comp]
        geoms = [m["geom"] for m in members if m.get("geom") is not None]
        if not geoms:
            continue
        boundary = unary_union(geoms)
        if boundary.geom_type == "MultiPolygon":
            # keep the footprint envelope so the unit reads as one boundary
            boundary = boundary.convex_hull
        conf, reasons = _score_cluster(members)
        area_px = float(sum(m["areaPx"] for m in members))
        if scale_m_per_px:
            area_val = round(area_px * scale_m_per_px * scale_m_per_px, 2)
            area_unit, area_status = "M2", "SCALED"
        else:
            area_val = round(area_px, 1)
            area_unit, area_status = "PIXEL_SQUARED", "SCALE_UNAVAILABLE"

        gstatus = "VALID"
        if not boundary.is_valid:
            gstatus = "WARNING"
        review = conf < settings.conf_med or gstatus != "VALID" or len(reasons) > 0

        units.append(
            {
                "featureId": f"FP-UNIT-{idx:03d}",
                "localUnitId": f"AI-UNIT-{idx:03d}",
                "rooms": comp,
                "roomTypes": [by_id[c]["class"] for c in comp],
                "unitBoundary": mapping(boundary),
                "pixelPolygon": [[round(x, 2), round(y, 2)] for x, y in
                                 (boundary.exterior.coords if boundary.geom_type == "Polygon" else [])],
                "bboxPx": _bbox(boundary),
                "areaPx": round(area_px, 1),
                "area": area_val,
                "areaUnit": area_unit,
                "areaStatus": area_status,
                "confidence": round(conf, 3),
                "geometryStatus": gstatus,
                "ambiguityReasons": reasons,
                "reviewRequired": bool(review),
                "source": "AI_DEMO",
            }
        )

    common_areas = []
    for k, r in enumerate(common_rooms, start=1):
        if r.get("geom") is None:
            continue
        common_areas.append(
            {
                "featureId": f"FP-COMMON-{k:03d}",
                "class": r["class"],
                "rooms": [r["featureId"]],
                "pixelPolygon": r["pixelPolygon"],
                "bboxPx": _bbox(r["geom"]),
                "areaPx": r["areaPx"],
                "area": r["area"],
                "areaUnit": r["areaUnit"],
                "areaStatus": r["areaStatus"],
                "confidence": r["confidence"],
                "geometryStatus": r["geometryStatus"],
                "reviewRequired": r["reviewRequired"],
                "source": "AI_DEMO",
            }
        )

    return units, common_areas, unclassified
