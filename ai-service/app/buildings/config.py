"""Configurable thresholds for the building-extraction pipeline.

Every knob is documented and overridable via environment variables so nothing
is hard-coded through the codebase (spec: "Do not hardcode thresholds").
"""
from __future__ import annotations

import os
from dataclasses import dataclass


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
    # which segmentation backend to try first: "classical" (default, always
    # available) or "unet" (needs torch + weights; falls back to classical).
    model: str = os.environ.get("AI_MODEL", "classical")
    unet_weights: str = os.environ.get("AI_UNET_WEIGHTS", "")

    # binary-mask cutoff on the per-pixel building probability [0..1].
    building_confidence_threshold: float = _f("BUILDING_CONFIDENCE_THRESHOLD", 0.50)

    # per-building confidence -> HIGH / MEDIUM / LOW
    conf_high: float = _f("AI_CONF_HIGH", 0.80)
    conf_med: float = _f("AI_CONF_MED", 0.55)

    # geometry limits
    min_building_area_px: int = _i("AI_MIN_BUILDING_AREA_PX", 60)      # non-georef
    min_building_area_m2: float = _f("AI_MIN_BUILDING_AREA_M2", 12.0)  # georef
    simplify_tolerance_px: float = _f("AI_SIMPLIFY_TOL_PX", 1.5)
    duplicate_iou: float = _f("AI_DUPLICATE_IOU", 0.90)   # >= -> duplicate
    overlap_iou_flag: float = _f("AI_OVERLAP_IOU_FLAG", 0.30)  # >= (and < dup) -> flag

    # image handling
    max_image_px: int = _i("AI_MAX_IMAGE_PX", 4096)       # per side before tiling
    tile_px: int = _i("AI_TILE_PX", 1024)
    tile_overlap_px: int = _i("AI_TILE_OVERLAP_PX", 64)

    disclaimer: str = (
        "AI_DEMO / MODEL OUTPUT. Candidate building geometry produced by an "
        "automated model. NOT official cadastral, survey, ULPIN, ownership or "
        "building-approval data. Requires human review."
    )


settings = Settings()

CONFIDENCE_LEVELS = ("HIGH", "MEDIUM", "LOW")
GEOMETRY_STATUS = ("VALID", "WARNING", "ERROR")
PIPELINE_STATUS = (
    "COMPLETED",
    "MODEL_NOT_AVAILABLE",
    "INFERENCE_UNAVAILABLE",
    "NO_BUILDINGS",
    "FAILED",
)
