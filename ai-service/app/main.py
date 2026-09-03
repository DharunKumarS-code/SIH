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

from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.buildings import pipeline_stages, run as run_building_extraction, settings as building_settings
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
