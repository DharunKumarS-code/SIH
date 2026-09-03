# LAND STACK — AI Service (FastAPI)

Inference gateway for the LAND STACK AI pipeline. **All output is clearly
labelled AI_DEMO / MODEL OUTPUT — never a validated real-world prediction and
never official cadastral / ULPIN / survey / ownership data.**

The Node backend calls this service when `AI_SERVICE_URL` is reachable. If it is
not running:
- the legacy `/api/ai/*` studio features fall back to a local Node mock;
- `POST /api/ai/buildings/infer` returns `status: "INFERENCE_UNAVAILABLE"` and
  the rest of the app is unaffected.

## Run

```bash
cd ai-service
python -m venv .venv && . .venv/Scripts/activate      # Windows
#   source .venv/bin/activate                         # macOS / Linux
pip install -r requirements.txt
python scripts/make_fixtures.py                        # test fixtures (once)
uvicorn app.main:app --port 8000 --reload
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness + feature list |
| GET | `/features` | legacy feature catalogue + disclaimer |
| POST | `/infer/{feature}` | legacy simulated features (`building-footprint`, `change-detection`, …) |
| **GET** | **`/buildings/config`** | active extraction thresholds + model info + disclaimer |
| **POST** | **`/buildings/infer`** | **Phase 3** — multipart `image` (+ `locality`, `job_id`) → real image→polygon building extraction |

### `POST /buildings/infer` output (abridged)

```json
{
  "status": "COMPLETED",                 // | NO_BUILDINGS | MODEL_NOT_AVAILABLE | FAILED
  "source": "AI_DEMO",
  "model": "classical-cv", "modelVersion": "1.0",
  "georeferenced": true, "geoStatus": "GEOREFERENCED", "crs": "EPSG:32644",
  "thresholds": { "buildingConfidenceThreshold": 0.5, "confHigh": 0.8, "confMed": 0.55 },
  "buildings": [{
    "localId": 1,
    "polygon": { "type": "Polygon", "coordinates": [[[80.2270, 12.9005], ...]] },  // WGS84, or null for non-georef
    "pixelPolygon": [[x, y], ...],
    "confidence": 0.86, "confidenceLevel": "HIGH",
    "geometryStatus": "VALID", "geometryIssues": [],
    "areaM2": 820.1, "height": null, "heightStatus": "UNAVAILABLE",
    "reviewRequired": false
  }],
  "summary": { "total": 4, "high": 4, "medium": 0, "low": 0, "invalidGeometry": 0, "reviewRequired": 0 },
  "disclaimer": "AI_DEMO / MODEL OUTPUT ..."
}
```

Plain PNG/JPG → `geoStatus: "NON_GEOREFERENCED_AI_DEMO"`, `polygon: null` (pixel
geometry only — no invented coordinates).

## Model

| | default | optional |
| --- | --- | --- |
| `AI_MODEL` | `classical` (adaptive threshold + morphology; numpy + scikit-image) | `unet` (segmentation-models-pytorch, ResNet-34) |
| weights | — | `AI_UNET_WEIGHTS=/path/to.pt`; needs `pip install torch segmentation-models-pytorch` |
| if unavailable | — | logs a note and falls back to `classical` |

Training config: `configs/unet.yaml`. Evaluation: `python scripts/evaluate.py
--images DIR --masks DIR` (IoU / Precision / Recall / F1 / Dice). Dataset:
**SpaceNet Building Footprint** — see `docs/15-ai-building-extraction.md` for
suitability and **Chennai domain-shift limitations**.

## Tests

```bash
python -m pytest tests -q
```

## Adding a real model / feature

1. Implement a segmenter with `available()` + `probability(gray)` in
   `app/buildings/segmentation.py` and wire it in `get_segmenter()`.
2. Or implement `app.models.base.InferenceModel` and register it in
   `app/pipelines/registry.py` for the legacy features.
3. No frontend/backend changes — the response envelope is unchanged.
