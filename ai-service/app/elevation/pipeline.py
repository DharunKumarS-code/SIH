"""Elevation / LiDAR / DEM / DSM pipeline orchestrator (Phase 5).

    point cloud / DEM / DSM bytes
      -> validate (header / raster metadata, CRS, elevation range)
      -> ground classification (LAS class codes, or a documented fallback)
      -> DEM generation (ground, min-per-cell grid)
      -> surface classification -> DSM generation (all points, max-per-cell grid)
      -> per-building DSM - DEM sampling (robust stats, outlier-clipped)
      -> quality validation + confidence scoring
      -> building height candidates + summary

Every result is MODEL OUTPUT / estimated (never OFFICIAL). Malformed input
returns FAILED / errorKind INVALID_INPUT (Node maps this to HTTP 400); any
other internal failure returns FAILED without a stack trace.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import grid, height, las_io, provenance, raster_io
from .config import settings
from .crs import combined_status, compare_horizontal_crs, compare_vertical_datum

pipeline_stages = [
    "Point cloud / DEM / DSM input",
    "Validation",
    "Ground classification",
    "DEM generation",
    "Surface classification",
    "DSM generation",
    "DSM − DEM height estimate",
    "Building height sampling",
    "Quality & confidence",
    "Building height results",
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _raster_meta(info):
    if info is None:
        return None
    return {
        "crs": info.crs,
        "widthPx": info.width,
        "heightPx": info.height,
        "resolutionM": list(info.resolution_m) if info.resolution_m else None,
        "crsUnitsAreMetres": info.crs_units_are_metres,
        "bounds": list(info.bounds),
        "nodata": info.nodata,
        "minElevationM": info.min_elev,
        "maxElevationM": info.max_elev,
        "notes": info.notes,
    }


def run_validate(data: bytes, filename: str, dataset_type: str, form: dict | None = None) -> dict:
    form = form or {}
    started = _now()
    dataset_type = (dataset_type or "").strip().upper()
    prov = provenance.build(form.get("source_label"), form.get("dataset_name") or filename)

    try:
        if dataset_type == "POINTCLOUD":
            info, status = las_io.validate(data)
            meta = {
                "pointCount": info.pointCount,
                "bounds": info.bounds,
                "crs": info.crs,
                "crsStatus": info.crsStatus,
                "versionMajor": info.versionMajor,
                "versionMinor": info.versionMinor,
                "pointFormatId": info.pointFormatId,
                "classificationAvailable": info.classificationAvailable,
                "classificationCodesPresent": info.classificationCodesPresent,
                "notes": info.notes,
            }
            issues = info.issues
        elif dataset_type in ("DEM", "DSM"):
            r = raster_io.open_raster(data, dataset_type)
            meta = _raster_meta(r)
            issues = []
            status = "WARNING" if r.notes else "VALID"
        else:
            return {
                "status": "FAILED",
                "error": f'Unknown datasetType "{dataset_type}" (expected DEM, DSM or POINTCLOUD).',
                "errorKind": "INVALID_INPUT",
                "disclaimer": settings.disclaimer,
                "generatedAt": started,
            }
    except (las_io.LasError, raster_io.RasterError) as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "errorKind": "INVALID_INPUT",
            "disclaimer": settings.disclaimer,
            "generatedAt": started,
        }

    return {
        "status": "INVALID" if status == "ERROR" else "VALIDATED",
        "validationStatus": status,
        "datasetType": dataset_type,
        "metadata": meta,
        "issues": issues,
        "provenance": prov,
        "disclaimer": settings.disclaimer,
        "generatedAt": started,
    }


def run_process(
    *,
    dem_bytes: bytes | None = None,
    dsm_bytes: bytes | None = None,
    pointcloud_bytes: bytes | None = None,
    footprints: list | None = None,
    buffer_m: float | None = None,
    source_label: str | None = None,
    dataset_name: str | None = None,
    vertical_datum_dem: str | None = None,
    vertical_datum_dsm: str | None = None,
) -> dict:
    started = _now()
    footprints = footprints or []
    prov = provenance.build(source_label, dataset_name)
    notes: list = []
    ground_method = None
    ground_confidence = None

    try:
        if pointcloud_bytes and not (dem_bytes and dsm_bytes):
            las_info, las_status = las_io.validate(pointcloud_bytes)
            if las_status == "ERROR":
                return {
                    "status": "FAILED",
                    "error": "; ".join(i["message"] for i in las_info.issues) or "Invalid point cloud.",
                    "errorKind": "INVALID_INPUT",
                    "disclaimer": settings.disclaimer,
                    "generatedAt": started,
                }
            g = grid.build_dem_dsm_from_las(pointcloud_bytes, las_info)
            dem_info, dsm_info = g["dem"], g["dsm"]
            ground_method = g["groundClassificationMethod"]
            ground_confidence = g["groundClassificationConfidence"]
            notes.extend(g["notes"])
        else:
            dem_info = raster_io.open_raster(dem_bytes, "DEM") if dem_bytes else None
            dsm_info = raster_io.open_raster(dsm_bytes, "DSM") if dsm_bytes else None
    except (las_io.LasError, raster_io.RasterError) as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "errorKind": "INVALID_INPUT",
            "disclaimer": settings.disclaimer,
            "generatedAt": started,
        }

    if dem_info is None:
        notes.append("No DEM available — building heights cannot be computed (dataAvailability UNAVAILABLE).")
    if dsm_info is None:
        notes.append("No DSM available — building heights cannot be computed (dataAvailability UNAVAILABLE).")

    h_status, h_note = compare_horizontal_crs(dem_info.crs if dem_info else None, dsm_info.crs if dsm_info else None)
    v_status, v_note = compare_vertical_datum(vertical_datum_dem, vertical_datum_dsm)
    crs_status = combined_status(h_status, v_status)

    results = []
    for f in footprints:
        bid = f.get("buildingId")
        ring = (f.get("polygon") or {}).get("coordinates", [[]])[0]
        if not bid or len(ring) < 3:
            continue
        r = height.compute_building_height(bid, ring, dem_info, dsm_info, buffer_m)
        r["dataSource"] = "LIDAR_DERIVED" if pointcloud_bytes and not (dem_bytes and dsm_bytes) else "DEM_DSM_DERIVED"
        r["groundClassificationMethod"] = ground_method
        results.append(r)

    summary = {
        "total": len(results),
        "valid": sum(1 for r in results if r["qualityStatus"] == "VALID"),
        "warning": sum(1 for r in results if r["qualityStatus"] == "WARNING"),
        "error": sum(1 for r in results if r["qualityStatus"] == "ERROR"),
        "high": sum(1 for r in results if r["confidenceLevel"] == "HIGH"),
        "medium": sum(1 for r in results if r["confidenceLevel"] == "MEDIUM"),
        "low": sum(1 for r in results if r["confidenceLevel"] == "LOW"),
    }

    return {
        "status": "COMPLETED",
        "pipeline": pipeline_stages,
        "provenance": prov,
        "datasets": {"dem": _raster_meta(dem_info), "dsm": _raster_meta(dsm_info)},
        "crsComparison": {
            "horizontalCRS": {"dem": dem_info.crs if dem_info else None, "dsm": dsm_info.crs if dsm_info else None, "status": h_status, "note": h_note},
            "verticalDatum": {"dem": vertical_datum_dem, "dsm": vertical_datum_dsm, "status": v_status, "note": v_note},
            "crsStatus": crs_status,
            "transformApplied": False,
        },
        "groundClassificationMethod": ground_method,
        "groundClassificationConfidence": ground_confidence,
        "buildings": results,
        "summary": summary,
        "notes": notes,
        "source": prov["source"],
        "disclaimer": settings.disclaimer,
        "generatedAt": started,
    }
