"""Per-building height estimation: robust DSM-minus-DEM sampling (spec section 10).

For each building footprint (a WGS84 GeoJSON polygon ring), DEM and DSM cell
values are independently sampled inside the footprint + a small buffer (each
raster is reprojected-from-WGS84 on its own, so DEM and DSM may even be in
different — but each individually known — CRSs; see crs.py for why a joint
DEM/DSM reprojection is not required for this per-building path). Robust
statistics (percentile-clipped outlier removal, then a documented statistic —
median by default) are used so a handful of contaminated pixels (vegetation,
a parked vehicle, a chimney) do not dominate the result.
"""
from __future__ import annotations

import numpy as np

from . import quality
from .config import settings
from .crs import combined_status
from .raster_io import sample_footprint

STAT_FUNCS = {
    "median": lambda a: float(np.median(a)),
    "p10": lambda a: float(np.percentile(a, 10)),
    "p90": lambda a: float(np.percentile(a, 90)),
    "trimmed_mean": lambda a: float(np.mean(np.sort(a)[max(1, len(a) // 10): -max(1, len(a) // 10)]) if len(a) >= 10 else np.mean(a)),
}


def _clip_outliers(samples: np.ndarray, s=settings):
    if samples.size == 0:
        return samples
    lo, hi = np.percentile(samples, [s.outlier_low_pct, s.outlier_high_pct])
    return samples[(samples >= lo) & (samples <= hi)]


def _stat(samples: np.ndarray, name: str) -> float | None:
    if samples is None or samples.size == 0:
        return None
    fn = STAT_FUNCS.get(name, STAT_FUNCS["median"])
    return round(fn(samples), 3)


def compute_building_height(building_id: str, ring_lonlat: list, dem_info, dsm_info, buffer_m=None, s=settings):
    buffer_m = s.footprint_buffer_m if buffer_m is None else buffer_m
    ground_note = None

    # Ground elevation: sample the annulus just OUTSIDE the footprint first —
    # the ground directly under a building is normally occluded in the source
    # data. Fall back to the union (footprint + buffer) only if the annulus
    # has no valid coverage, flagged with a note (lower confidence).
    if dem_info:
        dem_res = sample_footprint(dem_info, ring_lonlat, s.ground_annulus_buffer_m, mode="annulus")
        if dem_res["samples"].size == 0:
            fallback = sample_footprint(dem_info, ring_lonlat, buffer_m, mode="union")
            if fallback["samples"].size > 0:
                dem_res = fallback
                ground_note = "Ground elevation sampled from inside the footprint (no clear ground visible in the surrounding annulus)."
    else:
        dem_res = {"samples": np.array([]), "candidateCells": 0, "crsStatus": "UNKNOWN"}
    dsm_res = sample_footprint(dsm_info, ring_lonlat, buffer_m, mode="union") if dsm_info else {"samples": np.array([]), "candidateCells": 0, "crsStatus": "UNKNOWN"}

    ground_samples = dem_res["samples"]
    roof_samples_raw = dsm_res["samples"]
    roof_samples = _clip_outliers(roof_samples_raw, s)
    ground_samples_clipped = _clip_outliers(ground_samples, s)

    ground_elev = _stat(ground_samples_clipped, s.ground_stat)
    roof_median = _stat(roof_samples, "median")
    roof_min = round(float(np.min(roof_samples)), 3) if roof_samples.size else None
    roof_max = round(float(np.max(roof_samples)), 3) if roof_samples.size else None
    roof_elev = _stat(roof_samples, s.roof_stat)

    height = round(roof_elev - ground_elev, 3) if (ground_elev is not None and roof_elev is not None) else None

    crs_status = combined_status(dem_res["crsStatus"], dsm_res["crsStatus"])

    # Coverage is computed separately per raster (their sampled regions have
    # different shapes — annulus for DEM, union for DSM — so a single shared
    # denominator would not be a fair ratio for either).
    dem_coverage = len(ground_samples) / dem_res["candidateCells"] if dem_res["candidateCells"] else 0.0
    dsm_coverage = len(roof_samples_raw) / dsm_res["candidateCells"] if dsm_res["candidateCells"] else 0.0
    coverage_ratio = min(dem_coverage, dsm_coverage)
    candidate_cells = max(dem_res["candidateCells"], dsm_res["candidateCells"], 1)
    footprint_partial = 0 < coverage_ratio < s.sample_coverage_warn

    if height is None:
        qstatus, issues = quality.evaluate(
            ground_samples=ground_samples_clipped, roof_samples_raw=roof_samples_raw, roof_samples_clipped=roof_samples,
            ground_elev=ground_elev, roof_elev=roof_elev, height=0.0, crs_status=crs_status, footprint_partial=footprint_partial, s=s,
        )
        clevel, cscore = "LOW", 0.0
    else:
        qstatus, issues = quality.evaluate(
            ground_samples=ground_samples_clipped, roof_samples_raw=roof_samples_raw, roof_samples_clipped=roof_samples,
            ground_elev=ground_elev, roof_elev=roof_elev, height=height, crs_status=crs_status, footprint_partial=footprint_partial, s=s,
        )
        clevel, cscore = quality.confidence(
            n_ground=len(ground_samples_clipped), n_roof=len(roof_samples), coverage_ratio=coverage_ratio,
            roof_samples=roof_samples, height=height, crs_status=crs_status, s=s,
        )

    if ground_note:
        issues = issues + [{"rule": "GROUND_SAMPLE_FALLBACK", "status": "WARNING", "message": ground_note, "measuredValue": None}]
        if qstatus == "VALID":
            qstatus = "WARNING"

    return {
        "buildingId": building_id,
        "groundElevationM": ground_elev,
        "roofElevationM": roof_elev,
        "roofElevationMinM": roof_min,
        "roofElevationMedianM": roof_median,
        "roofElevationMaxM": roof_max,
        "buildingHeightM": height,
        "heightMethod": "DSM_MINUS_DEM",
        "heightStatistic": f"ground={s.ground_stat}, roof={s.roof_stat}, outlier-clipped [{s.outlier_low_pct}-{s.outlier_high_pct}] pct",
        "sampleCounts": {
            "demSamples": int(len(ground_samples_clipped)),
            "dsmSamplesRaw": int(len(roof_samples_raw)),
            "dsmSamplesUsed": int(len(roof_samples)),
            "candidateCells": int(candidate_cells),
        },
        "coverageRatio": round(float(coverage_ratio), 3),
        "footprintBufferM": buffer_m,
        "crsStatus": crs_status,
        "qualityStatus": qstatus,
        "qualityIssues": issues,
        "confidenceLevel": clevel,
        "confidenceScore": cscore,
    }
