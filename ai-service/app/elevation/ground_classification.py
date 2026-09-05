"""Ground-point classification for DEM generation (spec section 7).

Two methods, in priority order:

  A) LAS_CLASSIFICATION_CODE_2 — the file already carries ASPRS classification
     codes and code 2 (ground) is present. This is the industry-standard signal
     and is used as-is; the professional classification process that produced
     it is NOT re-validated here.

  B) DETERMINISTIC_LOWEST_PER_CELL — a documented fallback heuristic for
     unclassified research/demo point clouds: within each DEM grid cell, the
     lowest-elevation point is taken as the ground proxy. This is a coarse
     approximation (ground is *usually*, not always, the locally lowest
     return — a below-ground outlier or a basement scan point would break it)
     and is explicitly never presented as equivalent to a professionally
     classified LiDAR ground product.
"""
from __future__ import annotations

GROUND_METHOD_CLASSIFICATION = "LAS_CLASSIFICATION_CODE_2"
GROUND_METHOD_FALLBACK = "DETERMINISTIC_LOWEST_PER_CELL"

METHOD_NOTES = {
    GROUND_METHOD_CLASSIFICATION: "Ground points taken from existing ASPRS LiDAR classification (code 2).",
    GROUND_METHOD_FALLBACK: (
        "No usable ground classification in the source data — used a deterministic "
        "lowest-point-per-cell heuristic. This is a coarse approximation, not a "
        "substitute for professionally classified LiDAR ground returns."
    ),
}


def choose_method(classification_available: bool) -> tuple:
    """Return (method, baseConfidence 0..1) — baseConfidence feeds the overall
    ground-classification confidence factor, it is not a calibrated probability.
    """
    if classification_available:
        return GROUND_METHOD_CLASSIFICATION, 0.9
    return GROUND_METHOD_FALLBACK, 0.5
