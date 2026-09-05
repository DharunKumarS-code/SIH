"""
LAND STACK — AI microservice (FastAPI)

Plug-in inference gateway for the building-extraction / change-detection
pipeline (spec sections 24-26). Every response is CLEARLY LABELLED as demo /
simulated output — none of it is a validated real-world prediction. Real models
are added by implementing `app.models.base.InferenceModel` and registering them
in `app.pipelines.registry`.

Run:  uvicorn app.main:app --port 8000 --reload
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.buildings import pipeline_stages, run as run_building_extraction, settings as building_settings
from app.floorplans import (
    pipeline_stages as floorplan_pipeline_stages,
    run as run_floorplan_segmentation,
    settings as floorplan_settings,
)
from app.floorplans.classmap import mapping_report as floorplan_class_map
from app.floorplans.config import APP_CLASSES as FLOORPLAN_APP_CLASSES
from app.elevation import pipeline_stages as elevation_pipeline_stages, run_process as run_elevation_process, run_validate as run_elevation_validate, settings as elevation_settings
from app.gnss import pipeline_stages as gnss_pipeline_stages, run_transform as run_gnss_transform, settings as gnss_settings
from app.topology import analyze_polygon as topology_analyze_polygon, pair_metrics as topology_pair_metrics, settings as topology_settings
from app.pipelines.registry import FEATURES, run_feature

app = FastAPI(title="LAND STACK AI Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DISCLAIMER = (
    "Demo inference only. Not a validated prediction. Model outputs are "
    "simulated for prototype demonstration. Replace with a trained model via "
    "app.models + app.pipelines.registry."
)


class InferRequest(BaseModel):
    ulpin: str | None = None
    building_id: str | None = None
    floor: str | None = None
    floor_number: int | None = None
    units: int | None = None
    frm: str | None = None
    to: str | None = None


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "landstack-ai",
        "mode": "demo",
        "features": [f["key"] for f in FEATURES],
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/features")
def features() -> dict:
    return {"features": FEATURES, "disclaimer": DISCLAIMER}


@app.post("/infer/{feature}")
def infer(feature: str, req: InferRequest) -> dict:
    payload = req.model_dump(exclude_none=True)
    result = run_feature(feature, payload)
    result.update(
        {
            "feature": feature,
            "mode": "demo",
            "servedBy": "ai-service (FastAPI)",
            "disclaimer": DISCLAIMER,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    return result


# --------------------------------------------------------------------------
# Phase 3 — real building-footprint extraction from an uploaded image.
# Output is MODEL OUTPUT / AI_DEMO, never official cadastral / ULPIN data.
# --------------------------------------------------------------------------
@app.get("/buildings/config")
def buildings_config() -> dict:
    s = building_settings
    return {
        "model": s.model,
        "pipeline": pipeline_stages,
        "thresholds": {
            "buildingConfidenceThreshold": s.building_confidence_threshold,
            "confHigh": s.conf_high,
            "confMed": s.conf_med,
            "minBuildingAreaPx": s.min_building_area_px,
            "minBuildingAreaM2": s.min_building_area_m2,
            "duplicateIoU": s.duplicate_iou,
            "overlapIoUFlag": s.overlap_iou_flag,
        },
        "maxImagePx": s.max_image_px,
        "supportedInput": ["png", "jpg", "jpeg", "tif", "tiff"],
        "disclaimer": s.disclaimer,
    }


@app.post("/buildings/infer")
async def buildings_infer(
    image: UploadFile = File(...),
    locality: str | None = Form(default=None),
    job_id: str | None = Form(default=None),
) -> dict:
    data = await image.read()
    result = run_building_extraction(data, image.filename or "upload.png", {"locality": locality})
    result.update(
        {
            "servedBy": "ai-service (FastAPI)",
            "jobId": job_id,
            "locality": locality,
        }
    )
    return result


# --------------------------------------------------------------------------
# Phase 4 — AI floor-plan & apartment/unit segmentation from an uploaded image.
# Output is MODEL OUTPUT / AI_DEMO / DEMO_RESEARCH_DATA (dataset: CubiCasa5K),
# never official Tamil Nadu cadastral / Chennai building / ULPIN / ownership data.
# --------------------------------------------------------------------------
def _to_float(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


@app.get("/floorplans/config")
def floorplans_config() -> dict:
    s = floorplan_settings
    return {
        "model": s.model,
        "pipeline": floorplan_pipeline_stages,
        "appClasses": list(FLOORPLAN_APP_CLASSES),
        "classMap": floorplan_class_map(),
        "dataset": s.dataset,
        "dataClassification": s.data_classification,
        "thresholds": {
            "wallDarkThreshold": s.wall_dark_threshold,
            "wallMinLengthPx": s.wall_min_length_px,
            "roomMinAreaPx": s.room_min_area_px,
            "roomSealPx": s.room_seal_px,
            "corridorMaxWidthPx": s.corridor_max_width_px,
            "doorAdjacencyPx": s.door_adjacency_px,
            "duplicateIoU": s.duplicate_iou,
            "overlapIoUFlag": s.overlap_iou_flag,
            "confHigh": s.conf_high,
            "confMed": s.conf_med,
        },
        "maxImagePx": s.max_image_px,
        "supportedInput": ["png", "jpg", "jpeg", "tif", "tiff"],
        "coordinatePrinciple": (
            "A floor-plan image has no geographic coordinates. Geometry is kept "
            "in a LOCAL floor-plan reference; latitude/longitude is never invented."
        ),
        "disclaimer": s.disclaimer,
    }


@app.post("/floorplans/infer")
async def floorplans_infer(
    image: UploadFile = File(...),
    job_id: str | None = Form(default=None),
    building_id: str | None = Form(default=None),
    floor_id: str | None = Form(default=None),
    parcel_id: str | None = Form(default=None),
    scale_m_per_px: str | None = Form(default=None),
    floor_elevation_m: str | None = Form(default=None),
    floor_height_m: str | None = Form(default=None),
) -> dict:
    data = await image.read()
    result = run_floorplan_segmentation(
        data,
        image.filename or "floorplan.png",
        {
            "scale_m_per_px": _to_float(scale_m_per_px),
            "floor_elevation_m": _to_float(floor_elevation_m),
            "floor_height_m": _to_float(floor_height_m),
        },
    )
    result.update(
        {
            "servedBy": "ai-service (FastAPI)",
            "jobId": job_id,
            "buildingId": building_id,
            "floorId": floor_id,
            "parcelId": parcel_id,
        }
    )
    return result


# --------------------------------------------------------------------------
# Phase 5 — elevation / LiDAR / point-cloud / DEM / DSM integration.
# Output is MODEL OUTPUT / ELEVATION_DEMO / RESEARCH_DATA / TEST_FIXTURE —
# never OFFICIAL. See docs/17-lidar-dem-dsm-elevation.md.
# --------------------------------------------------------------------------
@app.get("/elevation/config")
def elevation_config() -> dict:
    s = elevation_settings
    return {
        "pipeline": elevation_pipeline_stages,
        "supportedInput": ["las", "laz", "tif", "tiff (DEM/DSM)"],
        "thresholds": {
            "footprintBufferM": s.footprint_buffer_m,
            "minValidSamples": s.min_valid_samples,
            "groundStat": s.ground_stat,
            "roofStat": s.roof_stat,
            "outlierLowPct": s.outlier_low_pct,
            "outlierHighPct": s.outlier_high_pct,
            "negativeHeightErrorM": s.negative_height_error_m,
            "maxPlausibleHeightM": s.max_plausible_height_m,
            "warnHeightM": s.warn_height_m,
            "confidenceHigh": s.confidence_high,
            "confidenceMedium": s.confidence_medium,
        },
        "gridResolutionM": s.grid_resolution_m,
        "maxPoints": s.max_points,
        "maxRasterPx": s.max_raster_px,
        "disclaimer": s.disclaimer,
    }


@app.post("/elevation/validate")
async def elevation_validate(
    file: UploadFile = File(...),
    dataset_type: str = Form(...),
    source_label: str | None = Form(default=None),
    dataset_name: str | None = Form(default=None),
) -> dict:
    data = await file.read()
    return run_elevation_validate(data, file.filename or "upload", dataset_type, {
        "source_label": source_label, "dataset_name": dataset_name,
    })


@app.post("/elevation/process")
async def elevation_process(
    dem: UploadFile | None = File(default=None),
    dsm: UploadFile | None = File(default=None),
    pointcloud: UploadFile | None = File(default=None),
    footprints: str = Form(default="[]"),
    buffer_m: str | None = Form(default=None),
    source_label: str | None = Form(default=None),
    dataset_name: str | None = Form(default=None),
    vertical_datum_dem: str | None = Form(default=None),
    vertical_datum_dsm: str | None = Form(default=None),
) -> dict:
    try:
        parsed_footprints = json.loads(footprints) if footprints else []
    except (TypeError, ValueError):
        return {
            "status": "FAILED", "error": "footprints must be a JSON array.",
            "errorKind": "INVALID_INPUT", "disclaimer": elevation_settings.disclaimer,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
    dem_bytes = await dem.read() if dem is not None else None
    dsm_bytes = await dsm.read() if dsm is not None else None
    pc_bytes = await pointcloud.read() if pointcloud is not None else None
    try:
        buf = float(buffer_m) if buffer_m not in (None, "") else None
    except ValueError:
        buf = None
    result = run_elevation_process(
        dem_bytes=dem_bytes, dsm_bytes=dsm_bytes, pointcloud_bytes=pc_bytes,
        footprints=parsed_footprints, buffer_m=buf,
        source_label=source_label, dataset_name=dataset_name,
        vertical_datum_dem=vertical_datum_dem, vertical_datum_dsm=vertical_datum_dsm,
    )
    result["servedBy"] = "ai-service (FastAPI)"
    return result


# --------------------------------------------------------------------------
# Phase 6 — GNSS/CORS high-precision spatial control. The ONLY step delegated
# to Python is CRS transformation (pyproj); parsing, validation, outlier
# detection, parcel association and boundary verification are deterministic
# JS in the Node backend. Output is never labelled survey-grade unless the
# caller's own supplied accuracy says so — this endpoint never fabricates it.
# --------------------------------------------------------------------------
class GnssPoint(BaseModel):
    x: float
    y: float


class GnssTransformRequest(BaseModel):
    points: list[GnssPoint]
    sourceCRS: str | None = None
    targetCRS: str | None = "EPSG:4326"


@app.get("/gnss/config")
def gnss_config() -> dict:
    return {
        "pipeline": gnss_pipeline_stages,
        "maxPointsPerRequest": gnss_settings.max_points_per_request,
        "disclaimer": gnss_settings.disclaimer,
    }


@app.post("/gnss/transform")
def gnss_transform(req: GnssTransformRequest) -> dict:
    result = run_gnss_transform(
        [p.model_dump() for p in req.points],
        req.sourceCRS,
        req.targetCRS,
    )
    result["servedBy"] = "ai-service (FastAPI)"
    return result


# --------------------------------------------------------------------------
# Phase 7 — intelligent 2D/3D topology validation engine. The ONLY step
# delegated to Python is exact planar polygon geometry (shapely): validity,
# self-intersection, area, pairwise overlap/IoU. Tolerances, severity,
# hierarchy/containment rules, 3D volume checks, spatial-index prefiltering,
# and result assembly are all deterministic JavaScript in the Node backend
# (backend/src/services/topology/). DETERMINISTIC_VALIDATION / RULE_ENGINE
# only — no ML model is used or implied here.
# --------------------------------------------------------------------------
class TopologyPolygon(BaseModel):
    id: str
    ring: list[list[float]]


class TopologyPolygonBatchRequest(BaseModel):
    polygons: list[TopologyPolygon]


class TopologyPolygonPair(BaseModel):
    idA: str
    idB: str
    ringA: list[list[float]]
    ringB: list[list[float]]


class TopologyPolygonPairsRequest(BaseModel):
    pairs: list[TopologyPolygonPair]


@app.get("/topology/config")
def topology_config() -> dict:
    return {
        "projectedCRS": topology_settings.projected_crs,
        "maxPolygonsPerRequest": topology_settings.max_polygons_per_request,
        "maxPairsPerRequest": topology_settings.max_pairs_per_request,
        "disclaimer": topology_settings.disclaimer,
    }


@app.post("/topology/analyze-polygons")
def topology_analyze_polygons(req: TopologyPolygonBatchRequest) -> dict:
    polygons = req.polygons[: topology_settings.max_polygons_per_request]
    results = [{"id": p.id, **topology_analyze_polygon(p.ring)} for p in polygons]
    return {"results": results, "disclaimer": topology_settings.disclaimer, "servedBy": "ai-service (FastAPI)"}


@app.post("/topology/polygon-pairs")
def topology_polygon_pairs(req: TopologyPolygonPairsRequest) -> dict:
    pairs = req.pairs[: topology_settings.max_pairs_per_request]
    results = [{"idA": p.idA, "idB": p.idB, **topology_pair_metrics(p.ringA, p.ringB)} for p in pairs]
    return {"results": results, "disclaimer": topology_settings.disclaimer, "servedBy": "ai-service (FastAPI)"}
