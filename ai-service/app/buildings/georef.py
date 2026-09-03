"""Pixel-space polygons -> WGS84 (EPSG:4326) lon/lat when the source raster is
georeferenced. Plain images stay in pixel space and are flagged
NON_GEOREFERENCED_AI_DEMO — no geographic coordinates are ever invented.
"""
from __future__ import annotations

from .preprocessing import PreparedImage

try:  # optional
    from pyproj import Transformer  # type: ignore
    _HAS_PYPROJ = True
except Exception:  # pragma: no cover
    _HAS_PYPROJ = False


def _affine(px, transform):
    a, b, c, d, e, f = transform
    x, y = px
    return (a * x + b * y + c, d * x + e * y + f)


def to_geographic(pixel_ring, prepared: PreparedImage):
    """Return (ring_lonlat | None, geo_status, area_m2 | None)."""
    if not prepared.georeferenced or not prepared.transform:
        return None, "NON_GEOREFERENCED_AI_DEMO", None
    if not _HAS_PYPROJ:  # pragma: no cover
        return None, "NON_GEOREFERENCED_AI_DEMO", None

    src = prepared.crs or "EPSG:4326"
    try:
        tf = Transformer.from_crs(src, "EPSG:4326", always_xy=True)
    except Exception:  # pragma: no cover
        return None, "NON_GEOREFERENCED_AI_DEMO", None

    src_xy = [_affine(p, prepared.transform) for p in pixel_ring]
    lonlat = [tf.transform(x, y) for (x, y) in src_xy]
    # close the ring
    if lonlat and lonlat[0] != lonlat[-1]:
        lonlat.append(lonlat[0])

    area_m2 = None
    res = prepared.resolution_m
    if res:
        # pixel area * m/px^2 — an estimate; documented as such
        px_area = _ring_area(pixel_ring)
        area_m2 = round(px_area * res * res, 1)
    return [[round(lon, 8), round(lat, 8)] for lon, lat in lonlat], "GEOREFERENCED", area_m2


def _ring_area(ring) -> float:
    a = 0.0
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0
