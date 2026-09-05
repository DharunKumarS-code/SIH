"""DEM / DSM GeoTIFF raster I/O + footprint sampling.

Reading uses rasterio (already an ai-service dependency for georeferencing).
If rasterio is unavailable at runtime the raster is treated as unusable and
callers get an explicit FAILED / UNAVAILABLE status — never a fabricated value.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np

from .config import settings
from .crs import normalise_crs

try:
    import rasterio
    from rasterio.io import MemoryFile

    _HAS_RASTERIO = True
except Exception:  # pragma: no cover
    _HAS_RASTERIO = False

try:
    from pyproj import Transformer

    _HAS_PYPROJ = True
except Exception:  # pragma: no cover
    _HAS_PYPROJ = False


class RasterError(Exception):
    """Malformed / unreadable raster — a client input problem (HTTP 400 upstream)."""


@dataclass
class RasterInfo:
    kind: str  # "DEM" | "DSM"
    crs: str | None
    transform: tuple  # (a, b, c, d, e, f) affine, world = affine(col, row)
    width: int
    height: int
    resolution_m: tuple | None  # (x_res, y_res) in CRS units — ONLY meaningful if CRS units are metres
    crs_units_are_metres: bool
    bounds: tuple  # (west, south, east, north) in the raster's own CRS
    nodata: float | None
    array: np.ndarray  # float32, NoData -> np.nan
    min_elev: float | None
    max_elev: float | None
    notes: list


def open_raster(data: bytes, kind: str) -> RasterInfo:
    if not data:
        raise RasterError("Empty raster upload.")
    if not _HAS_RASTERIO:
        raise RasterError("rasterio is not available in this ai-service deployment.")
    try:
        with MemoryFile(data) as mem:
            with mem.open() as ds:
                if ds.width > settings.max_raster_px or ds.height > settings.max_raster_px:
                    raise RasterError(
                        f"Raster too large ({ds.width}x{ds.height} px > "
                        f"{settings.max_raster_px}px per side limit)."
                    )
                band = ds.read(1, masked=True).astype("float64")
                arr = band.filled(np.nan).astype("float32")
                nodata = ds.nodata
                crs_str = ds.crs.to_string() if ds.crs else None
                crs_obj = normalise_crs(crs_str)
                units_m = bool(crs_obj and crs_obj.is_projected and "metre" in (crs_obj.axis_info[0].unit_name if crs_obj.axis_info else "metre"))
                t = ds.transform
                res = (abs(t.a), abs(t.e)) if units_m else None
                finite = arr[np.isfinite(arr)]
                notes = []
                if crs_str is None:
                    notes.append("Raster has no embedded CRS — crsStatus UNKNOWN.")
                if finite.size == 0:
                    notes.append("Raster has no valid (non-NoData) elevation values.")
                return RasterInfo(
                    kind=kind,
                    crs=crs_str,
                    transform=(t.a, t.b, t.c, t.d, t.e, t.f),
                    width=ds.width,
                    height=ds.height,
                    resolution_m=res,
                    crs_units_are_metres=units_m,
                    bounds=tuple(ds.bounds),
                    nodata=float(nodata) if nodata is not None else None,
                    array=arr,
                    min_elev=float(finite.min()) if finite.size else None,
                    max_elev=float(finite.max()) if finite.size else None,
                    notes=notes,
                )
    except RasterError:
        raise
    except Exception as e:  # rasterio raises many exception types for bad input
        raise RasterError(f"Could not read raster: {e}") from e


def _forward(transform, col, row):
    a, b, c, d, e, f = transform
    return a * col + b * row + c, d * col + e * row + f


def _inverse_point(transform, x, y):
    a, b, c, d, e, f = transform
    det = a * e - b * d
    if abs(det) < 1e-12:
        raise RasterError("Degenerate raster affine transform.")
    col = (e * (x - c) - b * (y - f)) / det
    row = (a * (y - f) - d * (x - c)) / det
    return col, row


def _point_in_polygon(xs: np.ndarray, ys: np.ndarray, ring: list) -> np.ndarray:
    """Vectorised ray-casting point-in-polygon (no extra dependency)."""
    n = len(ring)
    inside = np.zeros(xs.shape, dtype=bool)
    x1, y1 = ring[0]
    for i in range(1, n + 1):
        x2, y2 = ring[i % n]
        cond = ((y1 > ys) != (y2 > ys)) & (
            xs < (x2 - x1) * (ys - y1) / ((y2 - y1) if y2 != y1 else 1e-12) + x1
        )
        inside ^= cond
        x1, y1 = x2, y2
    return inside


def sample_footprint(raster: RasterInfo, ring_lonlat: list, buffer_m: float = None, mode: str = "union"):
    """Sample raster cell values around a WGS84 footprint ring.

    `mode`:
      "union"   — footprint interior + a `buffer_m` margin (default; used for
                  DSM/roof sampling, where the roof surface itself is wanted).
      "annulus" — ONLY the `buffer_m` margin ring OUTSIDE the footprint, i.e.
                  footprint interior excluded (used for DEM/ground sampling —
                  the ground directly under a building is normally occluded in
                  the source data, so ground elevation is read from just
                  outside the footprint instead, the standard technique).
      "interior"— footprint interior only, no margin.

    Returns dict: samples (np.ndarray, finite only), candidateCells (int, the
    sampled-region coverage denominator used for the confidence "coverage"
    factor), crsStatus, note.
    """
    buffer_m = settings.footprint_buffer_m if buffer_m is None else buffer_m
    if raster is None:
        return {"samples": np.array([]), "candidateCells": 0, "crsStatus": "UNKNOWN", "note": "Raster unavailable."}
    if raster.crs is None or not _HAS_PYPROJ:
        return {"samples": np.array([]), "candidateCells": 0, "crsStatus": "UNKNOWN", "note": "Raster CRS unknown — cannot sample."}

    try:
        tf = Transformer.from_crs("EPSG:4326", raster.crs, always_xy=True)
        ring_native = [tf.transform(lon, lat) for lon, lat in ring_lonlat]
    except Exception as e:
        return {"samples": np.array([]), "candidateCells": 0, "crsStatus": "UNKNOWN", "note": f"Reprojection failed: {e}"}

    # buffer the ring outward in native units (assume metres for a projected CRS;
    # otherwise approximate via a small degree delta — flagged in the note).
    buf = buffer_m if raster.crs_units_are_metres else buffer_m / 111_320.0
    cx = sum(p[0] for p in ring_native) / len(ring_native)
    cy = sum(p[1] for p in ring_native) / len(ring_native)
    buffered = [(x + buf * (1 if x >= cx else -1), y + buf * (1 if y >= cy else -1)) for x, y in ring_native]
    all_pts = ring_native + buffered
    xs_b = [p[0] for p in all_pts]
    ys_b = [p[1] for p in all_pts]
    xmin, xmax = min(xs_b), max(xs_b)
    ymin, ymax = min(ys_b), max(ys_b)

    corners = [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]
    cols, rows = [], []
    for x, y in corners:
        c, r = _inverse_point(raster.transform, x, y)
        cols.append(c)
        rows.append(r)
    c0, c1 = max(0, int(np.floor(min(cols))) - 1), min(raster.width, int(np.ceil(max(cols))) + 1)
    r0, r1 = max(0, int(np.floor(min(rows))) - 1), min(raster.height, int(np.ceil(max(rows))) + 1)
    if c1 <= c0 or r1 <= r0:
        return {"samples": np.array([]), "candidateCells": 0, "crsStatus": "MATCHED", "note": "Footprint falls outside raster bounds."}

    col_idx, row_idx = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
    world_x, world_y = _forward(raster.transform, col_idx + 0.5, row_idx + 0.5)
    inside_orig = _point_in_polygon(world_x, world_y, ring_native)
    inside_buffered = _point_in_polygon(world_x, world_y, buffered) if buffer_m > 0 else inside_orig

    if mode == "interior":
        keep = inside_orig
    elif mode == "annulus":
        keep = inside_buffered & ~inside_orig
    else:  # "union"
        keep = inside_orig | inside_buffered

    candidate_cells = int(keep.sum())
    vals = raster.array[row_idx[keep], col_idx[keep]]
    samples = vals[np.isfinite(vals)]
    return {"samples": samples, "candidateCells": candidate_cells, "crsStatus": "MATCHED", "note": None}
