"""Stream a LAS/LAZ point cloud once into a DEM (ground, min-per-cell) and a
DSM (surface, max-per-cell) grid (spec sections 8-9).

Streaming, not batch: `las_io.chunk_iterator` yields bounded chunks and this
module accumulates directly into the two fixed-size output grids with
`np.minimum.at` / `np.maximum.at`, so memory use is O(grid cells + chunk size)
regardless of point-cloud size, up to `settings.max_points`.

Empty cells are left as NoData (NaN) — large coverage gaps are never filled
with invented values (spec section 8/9).
"""
from __future__ import annotations

import numpy as np

from . import las_io
from .config import settings
from .crs import normalise_crs
from .ground_classification import GROUND_METHOD_CLASSIFICATION, choose_method
from .las_io import ASPRS_GROUND_CODE
from .raster_io import RasterInfo


def build_dem_dsm_from_las(data: bytes, las_info) -> dict:
    b = las_info.bounds
    res = settings.grid_resolution_m
    xmin, xmax, ymin, ymax = b["xmin"], b["xmax"], b["ymin"], b["ymax"]
    notes = []

    cols = max(1, int(np.ceil((xmax - xmin) / res)) or 1)
    rows = max(1, int(np.ceil((ymax - ymin) / res)) or 1)
    if cols * rows > settings.max_grid_cells:
        scale = ((cols * rows) / settings.max_grid_cells) ** 0.5
        res = res * scale
        cols = max(1, int(np.ceil((xmax - xmin) / res)) or 1)
        rows = max(1, int(np.ceil((ymax - ymin) / res)) or 1)
        notes.append(f"Grid resolution coarsened to {res:.2f} m to stay within the {settings.max_grid_cells}-cell processing cap.")

    n = rows * cols
    dem_acc = np.full(n, np.inf, dtype="float64")
    dsm_acc = np.full(n, -np.inf, dtype="float64")
    dem_hit = np.zeros(n, dtype=bool)
    dsm_hit = np.zeros(n, dtype=bool)

    ground_method, base_confidence = choose_method(las_info.classificationAvailable)
    total_pts = 0
    ground_pts = 0

    for x, y, z, cls in las_io.chunk_iterator(data):
        if len(x) == 0:
            continue
        total_pts += len(x)
        col = np.clip(((x - xmin) / res).astype("int64"), 0, cols - 1)
        row = np.clip(((ymax - y) / res).astype("int64"), 0, rows - 1)  # north-up: row 0 = ymax
        idx = row * cols + col

        np.maximum.at(dsm_acc, idx, z)
        dsm_hit[idx] = True

        if ground_method == GROUND_METHOD_CLASSIFICATION and cls is not None:
            gmask = cls == ASPRS_GROUND_CODE
        else:
            gmask = np.ones(len(z), dtype=bool)  # fallback: candidate set = all points, min-per-cell below
        if gmask.any():
            gi = idx[gmask]
            gz = z[gmask]
            np.minimum.at(dem_acc, gi, gz)
            dem_hit[gi] = True
            ground_pts += int(gmask.sum())

    dem = np.where(dem_hit, dem_acc, np.nan).astype("float32").reshape(rows, cols)
    dsm = np.where(dsm_hit, dsm_acc, np.nan).astype("float32").reshape(rows, cols)

    crs_obj = normalise_crs(las_info.crs)
    units_m = bool(crs_obj and crs_obj.is_projected)
    transform = (res, 0.0, xmin, 0.0, -res, ymax)

    def _info(kind, arr):
        finite = arr[np.isfinite(arr)]
        return RasterInfo(
            kind=kind, crs=las_info.crs, transform=transform, width=cols, height=rows,
            resolution_m=(res, res) if units_m else None, crs_units_are_metres=units_m,
            bounds=(xmin, ymin, xmax, ymax), nodata=None, array=arr,
            min_elev=float(finite.min()) if finite.size else None,
            max_elev=float(finite.max()) if finite.size else None,
            notes=list(notes),
        )

    coverage = float(dem_hit.sum()) / n if n else 0.0
    notes.append(
        f"DEM generated from {ground_pts:,} ground points ({ground_method}); "
        f"DSM generated from {total_pts:,} total points (max-per-cell surface top)."
    )
    if coverage < settings.sample_coverage_warn:
        notes.append(f"DEM grid coverage is low ({coverage:.0%} of cells have a ground sample) — expect NoData gaps.")

    return {
        "dem": _info("DEM", dem),
        "dsm": _info("DSM", dsm),
        "groundClassificationMethod": ground_method,
        "groundClassificationConfidence": base_confidence,
        "groundPointCount": ground_pts,
        "totalPointCount": total_pts,
        "gridResolutionM": res,
        "gridCoverage": coverage,
        "notes": notes,
    }
