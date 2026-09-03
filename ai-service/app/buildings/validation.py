"""Deterministic polygon-quality checks (NOT AI).

Runs over the polygonised candidates and flags: invalidity, self-intersection,
zero area, duplicates, excessive overlap, out-of-bounds. Repairable geometry is
already repaired in polygonize._repair; here we never silently discard — an
unrepairable polygon keeps geometry_status == "ERROR".
"""
from __future__ import annotations

from shapely.geometry import Polygon, box

from .config import settings


def _iou(a: Polygon, b: Polygon) -> float:
    if a is None or b is None or a.is_empty or b.is_empty:
        return 0.0
    try:
        inter = a.intersection(b).area
        union = a.area + b.area - inter
        return inter / union if union > 0 else 0.0
    except Exception:
        return 0.0


def validate(candidates: list[dict], width: int, height: int) -> list[dict]:
    frame = box(0, 0, width, height)
    geoms = [c.get("geom") for c in candidates]

    for i, c in enumerate(candidates):
        g = geoms[i]
        issues = list(c.get("geometry_issues", []))
        status = c.get("geometry_status", "VALID")

        if g is None:
            c["geometry_status"] = "ERROR"
            if "no repairable geometry" not in issues:
                issues.append("no repairable geometry")
            c["geometry_issues"] = issues
            c["duplicate_of"] = None
            c["overlaps"] = []
            continue

        if g.area <= 0:
            status = "ERROR"
            issues.append("zero area")
        if not g.is_simple:
            status = _worse(status, "WARNING")
            issues.append("non-simple ring")
        if not frame.buffer(2).contains(g.centroid):
            status = _worse(status, "WARNING")
            issues.append("centroid outside image bounds")

        dup_of = None
        overlaps = []
        for j in range(i):
            other = geoms[j]
            if other is None:
                continue
            iou = _iou(g, other)
            if iou >= settings.duplicate_iou:
                dup_of = candidates[j].get("local_id", j)
                status = _worse(status, "WARNING")
                issues.append(f"duplicate of #{dup_of} (IoU {iou:.2f})")
                break
            if iou >= settings.overlap_iou_flag:
                overlaps.append({"other": candidates[j].get("local_id", j), "iou": round(iou, 3)})
        if overlaps and dup_of is None:
            status = _worse(status, "WARNING")
            issues.append(f"overlaps {len(overlaps)} other candidate(s)")

        c["geometry_status"] = status
        c["geometry_issues"] = issues
        c["duplicate_of"] = dup_of
        c["overlaps"] = overlaps

    return candidates


_RANK = {"VALID": 0, "WARNING": 1, "ERROR": 2}


def _worse(a: str, b: str) -> str:
    return b if _RANK.get(b, 0) > _RANK.get(a, 0) else a
