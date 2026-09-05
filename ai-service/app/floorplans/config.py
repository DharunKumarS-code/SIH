"""Configurable settings for the AI floor-plan segmentation pipeline (Phase 4).

Every knob is documented and overridable via an environment variable so nothing
is hard-coded through the codebase (spec: "Do not hard-code thresholds. Centralize
configuration"). Mirrors the style of ``app/buildings/config.py``.

Nothing here trains a model or downloads weights. The always-available default is
a deterministic classical-CV segmenter; a real semantic-segmentation model is an
opt-in upgrade (``FLOORPLAN_MODEL=semseg`` + weights) documented in
``docs/16-ai-floor-plan-segmentation.md``.
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


# Normalised application classes. A model-specific class map (classmap.py)
# projects raw model labels (e.g. CubiCasa5K) onto this vocabulary.
APP_CLASSES = (
    "WALL",
    "ROOM",
    "CORRIDOR",
    "DOOR",
    "WINDOW",
    "STAIR",
    "BATHROOM",
    "KITCHEN",
    "BEDROOM",
    "LIVING_ROOM",
    "OTHER",
)

# Room classes that make a cluster of rooms look like a self-contained dwelling.
WET_ROOM_CLASSES = ("BATHROOM", "KITCHEN")
LIVING_CLASSES = ("LIVING_ROOM", "BEDROOM")
# Classes treated as shared circulation, never folded into a private unit.
COMMON_CLASSES = ("CORRIDOR", "STAIR")

CONFIDENCE_LEVELS = ("HIGH", "MEDIUM", "LOW")
GEOMETRY_STATUS = ("VALID", "WARNING", "ERROR")
PIPELINE_STATUS = (
    "COMPLETED",
    "NO_STRUCTURE",          # ran fine, found no usable walls/rooms
    "MODEL_NOT_AVAILABLE",   # segmentation backend could not run
    "INFERENCE_UNAVAILABLE",
    "FAILED",                # bad input
)

# Area reporting when the pixel->metre scale is unknown.
AREA_UNIT_PIXEL = "PIXEL_SQUARED"
AREA_UNIT_METRIC = "M2"
AREA_STATUS_OK = "SCALED"
AREA_STATUS_NO_SCALE = "SCALE_UNAVAILABLE"

# Coordinate reference kinds. A bare floor-plan image is NEVER assigned lat/lon.
CRS_LOCAL_PIXEL = "LOCAL_FLOORPLAN_PIXEL"     # x,y in pixels, origin top-left
CRS_LOCAL_METRE = "LOCAL_FLOORPLAN_METRE"     # x,y in metres, scale known
CRS_GEOREFERENCED = "GEOREFERENCED_VIA_BUILDING"  # only the Node layer sets this


@dataclass
class Settings:
    # ---- model selection -------------------------------------------------
    # "classical" (default, always available, no weights) or "semseg"
    # (segmentation-models-pytorch; needs torch + weights; falls back to
    # classical if unavailable — never crashes).
    model: str = os.environ.get("FLOORPLAN_MODEL", "classical")
    semseg_weights: str = os.environ.get("FLOORPLAN_SEMSEG_WEIGHTS", "")
    semseg_arch: str = os.environ.get("FLOORPLAN_SEMSEG_ARCH", "Unet")
    semseg_encoder: str = os.environ.get("FLOORPLAN_SEMSEG_ENCODER", "resnet34")

    # ---- image handling ------------------------------------------------
    # Floor plans carry fine features (door leaves, thin partitions). Keep a
    # generous working resolution and TILE instead of blindly downscaling.
    max_image_px: int = _i("FLOORPLAN_MAX_IMAGE_PX", 3200)   # per side before tiling
    min_image_px: int = _i("FLOORPLAN_MIN_IMAGE_PX", 64)     # reject smaller
    tile_px: int = _i("FLOORPLAN_TILE_PX", 1600)
    tile_overlap_px: int = _i("FLOORPLAN_TILE_OVERLAP_PX", 128)

    # ---- wall detection ----------------------------------------------
    # Wall ink is darker than paper. Cutoff on the normalised [0,1] grayscale.
    wall_dark_threshold: float = _f("FLOORPLAN_WALL_DARK_THRESHOLD", 0.45)
    wall_min_length_px: int = _i("FLOORPLAN_WALL_MIN_LENGTH_PX", 12)
    wall_close_px: int = _i("FLOORPLAN_WALL_CLOSE_PX", 2)   # bridge tiny gaps only
    wall_max_thickness_px: int = _i("FLOORPLAN_WALL_MAX_THICKNESS_PX", 40)

    # ---- room detection --------------------------------------------
    room_min_area_px: int = _i("FLOORPLAN_ROOM_MIN_AREA_PX", 600)
    room_min_area_m2: float = _f("FLOORPLAN_ROOM_MIN_AREA_M2", 1.5)
    tiny_polygon_area_px: int = _i("FLOORPLAN_TINY_POLYGON_AREA_PX", 120)
    simplify_tolerance_px: float = _f("FLOORPLAN_SIMPLIFY_TOL_PX", 1.5)
    # Seal typical doorway gaps before labelling rooms, then recover extent. A
    # doorway is ~half a metre to a metre; this is the pixel radius that closes it
    # so two rooms joined only by a door become distinct components.
    room_seal_px: int = _i("FLOORPLAN_ROOM_SEAL_PX", 16)
    # A room polygon narrower than this (min-rect short side) reads as circulation.
    corridor_max_width_px: int = _i("FLOORPLAN_CORRIDOR_MAX_WIDTH_PX", 60)
    corridor_min_aspect: float = _f("FLOORPLAN_CORRIDOR_MIN_ASPECT", 3.0)

    # ---- door / window detection -----------------------------------
    # Two rooms whose dilated masks meet within this band share an opening.
    door_adjacency_px: int = _i("FLOORPLAN_DOOR_ADJACENCY_PX", 6)

    # ---- geometry validation --------------------------------------
    duplicate_iou: float = _f("FLOORPLAN_DUPLICATE_IOU", 0.90)
    overlap_iou_flag: float = _f("FLOORPLAN_OVERLAP_IOU_FLAG", 0.15)
    max_rooms: int = _i("FLOORPLAN_MAX_ROOMS", 400)   # sanity cap -> excessive-tiny-polygons check

    # ---- confidence -> HIGH / MEDIUM / LOW (documented, no legal meaning) ----
    conf_high: float = _f("AI_CONF_HIGH", 0.80)
    conf_med: float = _f("AI_CONF_MED", 0.55)
    # The classical segmenter is a heuristic: cap the room-TYPE confidence it may
    # claim so heuristic labels are honestly flagged for review.
    classical_type_conf_cap: float = _f("FLOORPLAN_CLASSICAL_TYPE_CONF_CAP", 0.5)

    disclaimer: str = (
        "AI_DEMO / MODEL OUTPUT. Floor-plan geometry, room labels and "
        "apartment/unit boundaries produced by an automated model. NOT official "
        "Tamil Nadu cadastral, Chennai building-approval, ULPIN, ownership or "
        "legally authoritative apartment-boundary data. Research/demo pipeline; "
        "requires human review."
    )
    data_classification: str = "DEMO_RESEARCH_DATA"
    dataset: str = os.environ.get("FLOORPLAN_DATASET", "CubiCasa5K")


settings = Settings()
