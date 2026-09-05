"""2D polygon geometry primitives for the topology validation engine (Phase 7).

DETERMINISTIC_VALIDATION only — plain computational geometry, never called
"AI". Reuses the exact CRS-reprojection approach already proven in
app/gnss/crs.py: WGS84 lon/lat rings are reprojected to a planar CRS (UTM
44N, Chennai) before any shapely predicate or area/overlap computation runs,
so "metres" mean metres and area/overlap numbers are directly comparable to
the tolerances configured in the Node topology engine.

`pyproj`/`shapely` are optional at import time (same pattern as every other
Phase 3-6 Python module) — if unavailable, every function reports its own
"unavailable" outcome (`available: False`) rather than crashing or guessing a
validity/overlap result.
"""
from __future__ import annotations

try:
    from pyproj import CRS, Transformer
    from shapely.geometry import Polygon
    from shapely.validation import explain_validity

    _HAS_DEPS = True
except Exception:  # pragma: no cover
    _HAS_DEPS = False

from .config import settings

_transformer_cache: dict[str, "Transformer"] = {}


def _transformer():
    key = settings.projected_crs
    if key not in _transformer_cache:
        _transformer_cache[key] = Transformer.from_crs(
            CRS.from_epsg(4326), CRS.from_user_input(key), always_xy=True,
        )
    return _transformer_cache[key]


def to_planar_ring(ring):
    """Reproject a WGS84 [lon, lat] ring to planar (metre) coordinates.

    Returns None — never a guessed/partial ring — if pyproj is unavailable,
    the ring is too short, or any coordinate fails to transform.
    """
    if not _HAS_DEPS or not ring or len(ring) < 4:
        return None
    t = _transformer()
    out = []
    for pt in ring:
        try:
            x, y = pt[0], pt[1]
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                return None
            px, py = t.transform(x, y)
            if px != px or py != py:  # NaN check
                return None
            out.append((px, py))
        except Exception:
            return None
    return out


def analyze_polygon(ring) -> dict:
    """Intrinsic validity of one ring: is it a well-formed simple polygon?

    `isSimple` False means the ring self-intersects. `isValid` False covers
    shapely's broader validity notion (self-intersection, spikes, wrong ring
    order, ...) — a self-intersecting ring is always also invalid, but not
    every invalid ring self-intersects, which is why Phase 7 keeps
    SELF_INTERSECTION and INVALID_POLYGON as two distinct rule ids.
    """
    if not _HAS_DEPS:
        return {
            "available": False, "isValid": None, "isSimple": None,
            "areaM2": None, "validityReason": "shapely/pyproj not installed on the ai-service",
        }
    planar = to_planar_ring(ring)
    if planar is None:
        # Too short / unprojectable is a plain INVALID_POLYGON case — `isSimple`
        # is None (not applicable), never False, so this is never mistaken for
        # the more specific SELF_INTERSECTION rule by a caller that checks
        # `isSimple === false` first.
        return {
            "available": True, "isValid": False, "isSimple": None, "areaM2": 0.0,
            "validityReason": "ring has fewer than 4 coordinates or could not be projected",
        }
    try:
        poly = Polygon(planar)
        is_simple = bool(poly.is_simple)
        is_valid = bool(poly.is_valid)
        reason = None if is_valid else explain_validity(poly)
        # area is well-defined even for a self-intersecting ring (shapely
        # applies the even-odd/shoelace rule) — useful for INVALID_AREA context.
        area = float(poly.area)
        return {"available": True, "isValid": is_valid, "isSimple": is_simple, "areaM2": area, "validityReason": reason}
    except Exception as e:  # a ring shapely can't even construct a Polygon from
        return {"available": True, "isValid": False, "isSimple": None, "areaM2": 0.0, "validityReason": str(e)}


def pair_metrics(ring_a, ring_b) -> dict:
    """Planar relationship between two rings: intersects, overlapAreaM2, iou.

    `iou` (intersection-over-union) is the standard duplicate/near-duplicate
    signal — 1.0 means geometrically identical, not merely "similar size".
    Each input ring is repaired with a zero-width buffer if shapely reports it
    invalid, matching the same repair-before-compare convention already used
    in app/buildings/validation.py and app/floorplans/geometry.py.
    """
    if not _HAS_DEPS:
        return {"available": False, "intersects": None, "overlapAreaM2": None, "iou": None}
    pa, pb = to_planar_ring(ring_a), to_planar_ring(ring_b)
    if pa is None or pb is None:
        return {"available": True, "intersects": False, "overlapAreaM2": 0.0, "iou": 0.0}
    try:
        a, b = Polygon(pa), Polygon(pb)
        if not a.is_valid:
            a = a.buffer(0)
        if not b.is_valid:
            b = b.buffer(0)
        if a.is_empty or b.is_empty:
            return {"available": True, "intersects": False, "overlapAreaM2": 0.0, "iou": 0.0}
        inter = a.intersection(b).area
        union = a.area + b.area - inter
        iou = (inter / union) if union > 0 else 0.0
        return {"available": True, "intersects": bool(inter > 1e-9), "overlapAreaM2": float(inter), "iou": float(iou)}
    except Exception:
        return {"available": True, "intersects": None, "overlapAreaM2": None, "iou": None}
