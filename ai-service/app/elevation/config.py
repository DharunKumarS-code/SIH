"""Configurable thresholds for the elevation / LiDAR / DEM / DSM pipeline.

Every knob is overridable via environment variables so nothing is hard-coded
(same convention as app/buildings/config.py and app/floorplans/config.py).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    # ---- upload / processing limits ----
    max_points: int = _i("ELEV_MAX_POINTS", 20_000_000)  # hard cap; chunked reads stop after this many
    chunk_points: int = _i("ELEV_CHUNK_POINTS", 500_000)  # laspy chunked-read block size
    max_raster_px: int = _i("ELEV_MAX_RASTER_PX", 8192)   # per side

    # ---- DEM / DSM grid generation (from a raw point cloud) ----
    # Streaming min-per-cell (DEM / ground) and max-per-cell (DSM / surface) —
    # memory-safe (no need to hold the whole point cloud) and deterministic.
    # Empty cells are left as explicit NoData — large gaps are NEVER filled with
    # invented values (spec section 8).
    grid_resolution_m: float = _f("ELEV_GRID_RESOLUTION_M", 1.0)
    max_grid_cells: int = _i("ELEV_MAX_GRID_CELLS", 4_000_000)  # safety cap on (rows*cols)

    # ---- ground classification fallback (no ASPRS classification present) ----
    ground_cell_m: float = _f("ELEV_GROUND_CELL_M", 2.0)  # coarse grid for the lowest-point heuristic
    ground_percentile: float = _f("ELEV_GROUND_PERCENTILE", 5.0)  # take the low-percentile point per cell as "ground"

    # ---- building height sampling ----
    footprint_buffer_m: float = _f("ELEV_FOOTPRINT_BUFFER_M", 1.0)
    # Ground (DEM) is sampled from an ANNULUS just outside the footprint — the
    # ground directly beneath a building is normally occluded in the source
    # data — not from inside it. Wider than footprint_buffer_m so it reliably
    # clears roof overhang.
    ground_annulus_buffer_m: float = _f("ELEV_GROUND_ANNULUS_BUFFER_M", 3.0)
    min_valid_samples: int = _i("ELEV_MIN_VALID_SAMPLES", 4)
    ground_stat: str = os.environ.get("ELEV_GROUND_STAT", "median")  # median | p10
    roof_stat: str = os.environ.get("ELEV_ROOF_STAT", "median")      # median | p90 | trimmed_mean
    outlier_low_pct: float = _f("ELEV_OUTLIER_LOW_PCT", 2.0)
    outlier_high_pct: float = _f("ELEV_OUTLIER_HIGH_PCT", 98.0)

    # ---- quality thresholds ----
    # height < negative_height_error_m -> ERROR (large negative, likely CRS/datum
    # fault); 0 > height >= negative_height_error_m -> WARNING (small negative —
    # may just be sensor noise or a minor registration offset).
    negative_height_error_m: float = _f("ELEV_NEG_HEIGHT_ERROR_M", -2.0)
    max_plausible_height_m: float = _f("ELEV_MAX_PLAUSIBLE_HEIGHT_M", 250.0)
    warn_height_m: float = _f("ELEV_WARN_HEIGHT_M", 120.0)
    zero_height_tolerance_m: float = _f("ELEV_ZERO_HEIGHT_TOL_M", 0.15)
    outlier_rate_warn: float = _f("ELEV_OUTLIER_RATE_WARN", 0.35)
    sample_coverage_warn: float = _f("ELEV_SAMPLE_COVERAGE_WARN", 0.4)  # fraction of footprint+buffer cells with data

    # ---- confidence scoring weights (sum to 1.0) ----
    confidence_weights: dict = field(default_factory=lambda: {
        "samples": 0.30,
        "coverage": 0.25,
        "consistency": 0.25,
        "crs": 0.20,
    })
    confidence_high: float = _f("ELEV_CONF_HIGH", 0.75)
    confidence_medium: float = _f("ELEV_CONF_MED", 0.45)

    disclaimer: str = (
        "ELEVATION_DEMO / MODEL OUTPUT. Building height, ground and roof elevation "
        "are estimated from DSM-minus-DEM analysis of demo/research or "
        "user-supplied elevation data. NOT official, survey-certified or "
        "government-authoritative elevation data. Vegetation, vehicles and complex "
        "roof geometry can bias the estimate. Requires human review."
    )


settings = Settings()

DATASET_TYPES = ("DEM", "DSM", "POINTCLOUD")
DATASET_STATUS = ("VALIDATED", "PROCESSED", "FAILED", "INVALID")
QUALITY_STATUS = ("VALID", "WARNING", "ERROR")
CONFIDENCE_LEVELS = ("HIGH", "MEDIUM", "LOW")
CRS_STATUS = ("MATCHED", "REPROJECTED", "MISMATCH", "UNKNOWN")
SOURCE_LABELS = ("ELEVATION_DEMO", "RESEARCH_DATA", "TEST_FIXTURE", "USER_SUPPLIED", "MODEL_OUTPUT")
