# LAND STACK — AI Service (FastAPI)

Plug-in inference gateway for the building-extraction / change-detection
pipeline (spec §24–26). **All output is clearly labelled demo / simulated —
none of it is a validated real-world prediction.**

The Node backend calls this service when `AI_SERVICE_URL` is reachable; if it is
not running, the backend serves an equivalent local mock so the AI Studio page
always works.

## Run

```bash
cd ai-service
python -m venv .venv && . .venv/Scripts/activate      # Windows
#   source .venv/bin/activate                         # macOS / Linux
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness + feature list |
| GET | `/features` | feature catalogue + disclaimer |
| POST | `/infer/{feature}` | run one feature — `building-footprint`, `change-detection`, `floorplan-segmentation`, `height-estimation`, `risk-detection` |

## Adding a real model

1. Implement `app.models.base.InferenceModel`.
2. Register it for its feature key in `app/pipelines/registry.py` (`run_feature`).
3. No frontend/backend changes needed — the envelope is unchanged.
