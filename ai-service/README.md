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
| **GET** | **`/elevation/config`** | **Phase 5** — pipeline stages + thresholds + disclaimer |
| **POST** | **`/elevation/validate`** | **Phase 5** — multipart `file` + `dataset_type` → DEM/DSM/point-cloud metadata validation |
| **POST** | **`/elevation/process`** | **Phase 5** — multipart `dem`/`dsm`/`pointcloud` + `footprints` → per-building height + quality + confidence |
| **GET** | **`/gnss/config`** | **Phase 6** — pipeline stages + max points per request + disclaimer |
| **POST** | **`/gnss/transform`** | **Phase 6** — `{ points, sourceCRS, targetCRS }` → `pyproj`-backed CRS transform; a missing/unparsable CRS returns `UNKNOWN` and never fabricates a coordinate |

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

## Phase 4 — floor-plan & apartment/unit segmentation

`GET /floorplans/config` (thresholds, class map, disclaimer) · `POST
/floorplans/infer` (multipart `image` + optional `building_id`, `floor_id`,
`parcel_id`, `scale_m_per_px`, `floor_elevation_m`, `floor_height_m`, `job_id`).

```
Floor plan image -> preprocess -> segment (wall probability) -> wall mask
  -> rooms (interior free space, doorways sealed then recovered) -> topology
  (door/opening graph) -> apartment/unit inference (room clusters, never "every
  room is a unit") -> validation -> LOCAL 3D unit volume (metres if a scale is
  given, else pixels; z only if a floor elevation/height is supplied)
```

A floor-plan image has **no geographic coordinates** — output stays in a LOCAL
floor-plan reference (`crs: LOCAL_FLOORPLAN_PIXEL` or `_METRE`) unless the
caller supplies a real `building_id` (and the Node layer fits the plan onto
that building's footprint — see `docs/16-ai-floor-plan-segmentation.md`).
Dataset: **CubiCasa5K** (`dataClassification: "DEMO_RESEARCH_DATA"`, never
official Tamil Nadu cadastral / ULPIN data). Default model: the always-available
`classical-cv` wall-response segmenter (`app/floorplans/segmentation.py`); an
optional trained semantic head is `FLOORPLAN_MODEL=semseg` +
`FLOORPLAN_SEMSEG_WEIGHTS` (config: `configs/floorplan_segmentation.yaml`,
eval: `scripts/evaluate_floorplans.py`).

## Phase 5 — elevation / LiDAR / point-cloud / DEM / DSM

`GET /elevation/config` (thresholds, pipeline stages, disclaimer) ·
`POST /elevation/validate` (multipart `file` + `dataset_type` = `DEM`\|`DSM`\|
`POINTCLOUD` → header/metadata validation only) ·
`POST /elevation/process` (multipart `dem`/`dsm`/`pointcloud` + `footprints`
(JSON array of `{buildingId, polygon}`, WGS84) + `buffer_m` → per-building
ground/roof/height + quality + confidence).

```
LAS/LAZ (laspy, chunked) or DEM/DSM GeoTIFF (rasterio)
  -> ground classification (LAS class code 2, or a documented lowest-per-cell
     fallback) -> DEM (min-per-cell) / DSM (max-per-cell) -> per-building
     DSM-DEM sampling (annulus for ground, outlier-clipped, robust statistic)
  -> quality validation (VALID/WARNING/ERROR) + confidence (HIGH/MEDIUM/LOW)
```

Every result is `ELEVATION_DEMO` / `RESEARCH_DATA` / `TEST_FIXTURE` /
`USER_SUPPLIED` (never `OFFICIAL`, `isOfficial: false` always). No PDAL, no
QGIS. LAZ needs an optional backend (`lazrs` or `laszip`) — plain LAS always
works. See `docs/17-lidar-dem-dsm-elevation.md`; fixtures:
`scripts/make_elevation_fixtures.py`.

## Phase 6 — GNSS/CORS high-precision spatial control

`GET /gnss/config` (thresholds, pipeline stages, disclaimer) ·
`POST /gnss/transform` (`{ points: [{x,y}], sourceCRS, targetCRS }` →
`pyproj.Transformer`-backed reprojection). This is the **only** step Phase 6
delegates to Python — parsing, validation, outlier detection, parcel
association and boundary verification are deterministic JavaScript in the
Node backend (`backend/src/services/gnss/`). A missing/unparsable CRS
returns `status: "UNKNOWN"` and every coordinate stays `null` — never a
guessed transform; an unreachable/erroring transform reports
`TRANSFORMATION_UNAVAILABLE`/`MISMATCH` the same way. See
`docs/18-gnss-cors-spatial-control.md`; unit tests:
`tests/test_gnss_api.py`, `tests/test_gnss_crs.py`.

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
