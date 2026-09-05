"""Room topology / graph + door-and-window inference (Phase 4).

Two rooms whose polygons come within ``door_adjacency_px`` of each other are
taken to share an opening (a door, or an un-iconed passage). Each opening
becomes:
  * a DOOR feature (id, type, geometry, confidence, connected rooms, reviewRequired)
  * an edge in the room graph.

Nodes  : rooms / corridors / stairs
Edges  : openings + valid spatial adjacency
The graph feeds apartment/unit inference (``units.py``).
"""
from __future__ import annotations

from shapely.geometry import mapping

from .config import COMMON_CLASSES, settings


def _pt(geom):
    c = geom.centroid
    return [round(c.x, 2), round(c.y, 2)]


def build_topology(rooms: list[dict]):
    """Return (nodes, edges, door_features)."""
    band = settings.door_adjacency_px
    nodes = [
        {
            "id": r["featureId"],
            "class": r["class"],
            "kind": "circulation" if r["class"] in COMMON_CLASSES else "room",
        }
        for r in rooms
    ]

    edges = []
    doors = []
    for i in range(len(rooms)):
        gi = rooms[i].get("geom")
        if gi is None:
            continue
        bi = gi.buffer(band)
        for j in range(i + 1, len(rooms)):
            gj = rooms[j].get("geom")
            if gj is None:
                continue
            if not bi.intersects(gj.buffer(band)):
                continue
            inter = bi.intersection(gj.buffer(band))
            if inter.is_empty:
                continue
            # gap width proxy: how deep the two buffered shapes overlap
            overlap_w = (inter.area ** 0.5)
            # a very wide join is a shared wall removed / open plan, not a door
            is_doorlike = overlap_w <= band * 4
            conf = 0.6 if is_doorlike else 0.35
            did = f"FP-DR-{len(doors) + 1:06d}"
            doors.append(
                {
                    "featureId": did,
                    "class": "DOOR" if is_doorlike else "OPENING",
                    "type": "DOOR" if is_doorlike else "OPENING",
                    "geometry": mapping(inter.centroid),
                    "pixelPoint": _pt(inter),
                    "confidence": round(conf, 3),
                    "connectedRooms": [rooms[i]["featureId"], rooms[j]["featureId"]],
                    "geometryStatus": "VALID",
                    "reviewRequired": conf < settings.conf_med,
                }
            )
            edges.append(
                {
                    "from": rooms[i]["featureId"],
                    "to": rooms[j]["featureId"],
                    "via": did,
                    "kind": "door" if is_doorlike else "opening",
                }
            )
    return nodes, edges, doors


def adjacency(nodes: list[dict], edges: list[dict]) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = {n["id"]: set() for n in nodes}
    for e in edges:
        if e["from"] in adj and e["to"] in adj:
            adj[e["from"]].add(e["to"])
            adj[e["to"]].add(e["from"])
    return adj
