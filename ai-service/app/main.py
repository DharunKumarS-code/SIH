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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
