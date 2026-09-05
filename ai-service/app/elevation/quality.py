"""Building-height quality validation + confidence scoring (spec sections 11-12).

`evaluate` returns a rule-based VALID/WARNING/ERROR verdict with individual
issues (rule, status, message) — deterministic geometry/statistics checking,
not AI. `confidence` returns a HIGH/MEDIUM/LOW *quality/confidence score*: a
weighted heuristic over sample count, spatial coverage, statistical
consistency and CRS validity. It is explicitly NOT a calibrated probability.
"""
from __future__ import annotations

import numpy as np

from .config import settings

STATUS_RANK = {"VALID": 0, "WARNING": 1, "ERROR": 2}


def _worst(a, b):
    return b if STATUS_RANK[b] > STATUS_RANK[a] else a


def evaluate(
    *,
    ground_samples: np.ndarray,
    roof_samples_raw: np.ndarray,
    roof_samples_clipped: np.ndarray,
    ground_elev,
    roof_elev,
    height,
    crs_status: str,
    footprint_partial: bool = False,
    s=settings,
):
    issues = []
    status = "VALID"

    def add(rule, sev, message):
        nonlocal status
        issues.append({"rule": rule, "status": sev, "message": message, "measuredValue": None})
        status = _worst(status, sev)

    if ground_elev is None:
        add("DEM_MISSING", "ERROR", "No valid DEM (ground elevation) samples inside the building footprint + buffer.")
    if roof_elev is None:
        add("DSM_MISSING", "ERROR", "No valid DSM (surface elevation) samples inside the building footprint + buffer.")

    if ground_elev is not None and roof_elev is not None:
        if len(ground_samples) < s.min_valid_samples:
            add("INSUFFICIENT_DEM_SAMPLES", "WARNING", f"Only {len(ground_samples)} valid DEM samples (< {s.min_valid_samples} minimum) — ground elevation may be unreliable.")
        if len(roof_samples_clipped) < s.min_valid_samples:
            add("INSUFFICIENT_DSM_SAMPLES", "WARNING", f"Only {len(roof_samples_clipped)} valid DSM samples (< {s.min_valid_samples} minimum) — roof elevation may be unreliable.")

        if height < s.negative_height_error_m:
            add("NEGATIVE_HEIGHT", "ERROR", f"Height {height:.2f} m is strongly negative — check CRS, vertical datum and footprint registration before use.")
        elif height < 0:
            add("NEGATIVE_HEIGHT", "WARNING", f"Height {height:.2f} m is negative — may be sensor noise or a minor datum/registration offset rather than a data error.")
        elif height <= s.zero_height_tolerance_m:
            add("ZERO_HEIGHT", "WARNING", f"Height {height:.2f} m is near zero — the DSM barely exceeds the DEM over this footprint.")
        elif height > s.max_plausible_height_m:
            add("EXTREME_HEIGHT", "ERROR", f"Height {height:.2f} m exceeds the configured plausible maximum ({s.max_plausible_height_m} m).")
        elif height > s.warn_height_m:
            add("EXTREME_HEIGHT", "WARNING", f"Height {height:.2f} m is unusually tall for this dataset — verify before use ({s.warn_height_m} m warning threshold).")

        if roof_samples_raw is not None and len(roof_samples_raw) > 0:
            outlier_rate = 1.0 - (len(roof_samples_clipped) / len(roof_samples_raw))
            if outlier_rate > s.outlier_rate_warn:
                add("OUTLIER_RATE", "WARNING", f"{outlier_rate:.0%} of raw DSM samples were excluded as outliers (possible vegetation/vehicle contamination or a complex roof).")

    if footprint_partial:
        add("PARTIAL_FOOTPRINT_COVERAGE", "WARNING", "The building footprint is only partially covered by the elevation dataset.")

    if crs_status == "UNKNOWN":
        add("CRS_STATUS", "WARNING", "Horizontal CRS could not be confirmed for one or more datasets — treat results with caution.")
    elif crs_status == "MISMATCH":
        add("CRS_STATUS", "ERROR", "DEM/DSM CRS do not match and were not reconciled — height is not trustworthy.")

    return status, issues


def confidence(
    *,
    n_ground: int,
    n_roof: int,
    coverage_ratio: float,
    roof_samples: np.ndarray,
    height,
    crs_status: str,
    s=settings,
):
    """Weighted quality/confidence score in [0,1] -> HIGH/MEDIUM/LOW. Not a
    calibrated statistical probability."""
    target = max(1, s.min_valid_samples) * 3
    sample_score = min(1.0, (n_ground + n_roof) / (2 * target))
    coverage_score = max(0.0, min(1.0, coverage_ratio))

    if roof_samples is not None and len(roof_samples) >= 2 and height:
        spread = float(np.std(roof_samples))
        consistency_score = max(0.0, 1.0 - min(1.0, spread / max(1.0, abs(height))))
    else:
        consistency_score = 0.3

    crs_score = {"MATCHED": 1.0, "REPROJECTED": 0.85, "UNKNOWN": 0.5, "MISMATCH": 0.0}.get(crs_status, 0.3)

    w = s.confidence_weights
    score = (
        w["samples"] * sample_score
        + w["coverage"] * coverage_score
        + w["consistency"] * consistency_score
        + w["crs"] * crs_score
    )
    level = "HIGH" if score >= s.confidence_high else "MEDIUM" if score >= s.confidence_medium else "LOW"
    return level, round(float(score), 3)
