# 15 — AI Building-Footprint Extraction (Phase 3)

> **AI_DEMO / MODEL OUTPUT.** This pipeline produces **candidate** building
> geometry from an automated model. It is **not** official cadastral, survey,
> ULPIN, building-approval or ownership data, it never overwrites the existing
> demo buildings, and every result requires human review. AI building /
> job / candidate IDs are application-level identifiers — **never official
> ULPINs**. The Phase-1 parcel ULPIN provenance is unchanged: an AI building
> that matches a parcel carries that parcel's **existing** `ulpin` with
> `ulpinStatus: "DEMO_NOT_OFFICIAL"`.

Additive to Phases 1–2. If the Python `ai-service` is unavailable, the endpoint
returns `INFERENCE_UNAVAILABLE` and the rest of the app is unaffected.

```
Imagery ─▶ Python ai-service (/buildings/infer)
            preprocess ▶ segment ▶ mask ▶ polygonise ▶ validate ▶ georeference ▶ confidence
        ─▶ Node /api/ai/buildings/infer
            file validation ▶ job ▶ parcel association ▶ aiBuildings + aiJobs (MongoDB)
        ─▶ existing ONE Chennai-wide Cesium viewer   (layer: "AI-Derived Buildings", OFF by default)
```

---

## 1. AI/GIS service architecture

| Layer | Tech | Role |
| --- | --- | --- |
| Frontend | React (`pages/AiBuildingExtraction.jsx`) | upload, run, review, "View on Cesium" — **never runs Python** |
| Node API | Express (`controllers/aiBuildingController.js`, `services/aiBuildings/`) | file validation, job lifecycle, parcel association, storage, RBAC |
| AI service | Python 3.10 / FastAPI (`ai-service/app/buildings/`) | preprocessing, segmentation, mask, polygonisation, geometry validation, georeferencing |
| Store | existing MongoDB (new collections `aiBuildings`, `aiJobs`) | **no migration, no PostGIS** |

The AI service is decoupled: the Node backend calls it over HTTP
(`AI_SERVICE_URL`, default `http://localhost:8000`). Node never imports Python;
the frontend never talks to Python directly.

## 2. Python GIS stack (only what is needed)

`fastapi`, `uvicorn`, `pydantic`, `python-multipart` · `numpy`, `Pillow` (raster
decode) · `scikit-image` (segmentation morphology + `measure.label` /
`find_contours`) · `shapely` (polygonisation, `is_valid`, `make_valid` /
`buffer(0)` repair, spatial ops) · `rasterio` + `pyproj` (GeoTIFF affine
transform + CRS → WGS84; **optional at runtime** — without them every image is
treated as non-georeferenced) · `pytest`. **GDAL is not a separate dependency**
(rasterio ships its own). **QGIS is not a runtime dependency.** Optional upgrade
(not installed): `torch` + `segmentation-models-pytorch` for the U-Net.

## 3. Model selection

| | Default — `classical-cv` v1.0 | Optional — `unet-resnet34` |
| --- | --- | --- |
| What | adaptive local-contrast threshold (`skimage.filters.threshold_local`) + morphological opening/closing + small-object removal → building probability map | U-Net, ResNet-34 encoder (ImageNet), sigmoid mask (`segmentation-models-pytorch`) |
| Weights | none | `AI_UNET_WEIGHTS` (a `.pt` file you train/obtain) |
| Deps | numpy + scikit-image (already required) | `torch`, `segmentation-models-pytorch` (**not** in requirements.txt) |
| Enabled | always | only when `AI_MODEL=unet` **and** torch + weights are importable/present |
| Fallback | — | if torch/weights missing, the pipeline logs a note and uses `classical-cv` (never crashes) |
| Input | grayscale float32 `[0,1]`, tiled to `AI_TILE_PX` | same |
| Output | per-pixel probability `[0,1]` | per-pixel sigmoid `[0,1]` |
| If neither runs | pipeline returns `status: "MODEL_NOT_AVAILABLE"` | |

**Why the classical default:** it is deterministic, needs no GPU/weights, keeps
CI light, and gives a working inference path immediately — the spec's
"build the inference pipeline first; don't depend on training". The U-Net is the
documented accuracy upgrade.

### Training / evaluation (documented — the app does NOT train on startup)

- Config: [`ai-service/configs/unet.yaml`](../ai-service/configs/unet.yaml)
  (arch, dataset, split, optimiser, loss `Dice+BCE`, augmentations, early-stop).
- Eval: `python ai-service/scripts/evaluate.py --images DIR --masks DIR` →
  **IoU / Precision / Recall / F1 / Dice**.
- **DATASET EVALUATION ≠ CHENNAI DEPLOYMENT VALIDATION.** Good SpaceNet numbers
  do not imply Chennai accuracy — Chennai must be validated separately against
  Chennai-labelled data.

## 4. Dataset

| Field | Value |
| --- | --- |
| Name | **SpaceNet Building Footprint (SpaceNet-2)** |
| Source | SpaceNet / AWS Open Data (`spacenet.ai`), CC BY-SA 4.0 |
| Purpose | training + evaluation of the segmentation model |
| Image type | RGB PanSharpen satellite tiles (WorldView-3), 650×650 |
| Label format | per-tile building polygons as GeoJSON → rasterised to a binary mask |
| Resolution | ~0.3 m GSD |
| Coverage | Las Vegas, Paris, Shanghai, Khartoum (AOI_2–5) |
| Why suitable | large, well-curated, polygon labels, dense-urban rooftops, standard benchmark; pretrained weights & recipes widely available |
| **Chennai limitations** | domain shift — **dense low-rise apartments, tropical vegetation & heavy shadows, rooftop water tanks / structures, narrow lanes, informal construction, different sensor & GSD.** SpaceNet is **not** Chennai ground truth. Dataset-derived results are labelled **AI DEMO / MODEL OUTPUT** and must never be presented as Chennai government / TN cadastral / official ULPIN / survey data. |

**Not bundled** (large). The repo ships only a small synthetic georeferenced
fixture (`ai-service/tests/fixtures/sholinganallur_demo.tif`, generated by
`scripts/make_fixtures.py`) for tests — also clearly synthetic/AI_DEMO.

## 5. Coordinate handling

- **GeoTIFF with a CRS + transform** → `rasterio` affine + `pyproj` → polygon
  vertices in **WGS-84 lon/lat degrees** (the app's CRS, consumed directly by
  Cesium and by parcel association). `crs`, `transform`, `bounds`,
  `resolutionM` are preserved on the job.
- **Plain PNG / JPG (or TIFF without georef)** → polygons stay in **pixel
  space**; result flagged `NON_GEOREFERENCED_AI_DEMO`; `polygon` is `null`.
  **No geographic coordinates are ever invented.** These are shown in the AI
  page only — not placed on the map, not parcel-associated.

## 6. Inference pipeline (`ai-service/app/buildings/pipeline.py`)

1. **preprocess** — sniff format; reject unsupported / corrupt / empty; cap to
   `AI_MAX_IMAGE_PX` per side (ceil-step downsample); tile to `AI_TILE_PX` with
   `AI_TILE_OVERLAP_PX` (window read for large GeoTIFFs — no unbounded array);
   normalise to grayscale float32 `[0,1]` (2–98 percentile stretch).
2. **segment** — chosen segmenter per tile; probabilities stitched (mean over
   overlaps).
3. **threshold** at `BUILDING_CONFIDENCE_THRESHOLD` (default `0.50`) → binary
   building mask.
4. **polygonise** (`polygonize.py`) — `measure.label` connected components →
   `find_contours` → `shapely.Polygon` → `simplify(AI_SIMPLIFY_TOL_PX)` →
   repair (`buffer(0)` then `make_valid`, keep the largest valid part).
   Per-component `confidence` = mean probability inside the blob.
5. **validate** (`validation.py`) — see §7.
6. **georeference** (`georef.py`) — see §5.
7. **confidence level** (`confidence.py`) — see §8.

## 7. Geometry validation (deterministic — NOT AI)

Per candidate → `geometryStatus ∈ {VALID, WARNING, ERROR}` + `geometryIssues[]`:

| Check | Outcome |
| --- | --- |
| geometry exists | missing → `ERROR` (kept, never silently dropped) |
| `shapely.is_valid` / not self-intersecting | invalid → repair; repaired → `WARNING`; unrepairable → `ERROR` |
| non-zero area | zero/degenerate → `ERROR` |
| duplicate (IoU ≥ `AI_DUPLICATE_IOU`, default `0.90`, vs an earlier candidate) | `WARNING` + `duplicateOf` |
| excessive overlap (`AI_OVERLAP_IOU_FLAG` ≤ IoU < duplicate) | `WARNING` + `overlaps[]` |
| centroid within image bounds | outside → `WARNING` |
| CRS known (georeferenced input) | attached from the raster; pixel-only input flagged `NON_GEOREFERENCED_AI_DEMO` |
| minimum area | `< AI_MIN_BUILDING_AREA_PX` dropped pre-polygon; `< AI_MIN_BUILDING_AREA_M2` (georef) → `WARNING` |

## 8. Confidence thresholds (configurable, documented — no government meaning)

| Level | Rule (env-overridable) |
| --- | --- |
| `HIGH` | `confidence >= AI_CONF_HIGH` (default `0.80`) |
| `MEDIUM` | `AI_CONF_MED` (`0.55`) `<= confidence < AI_CONF_HIGH` |
| `LOW` | `confidence < AI_CONF_MED` |

`reviewRequired = (LOW) OR (geometryStatus != VALID) OR (parcelStatus ∈
{MULTI_PARCEL, REVIEW_REQUIRED})`. `LOW` / review-required buildings are flagged
**"Requires Review"** in the UI. These levels are a triage aid only — they do
**not** represent certification or survey accuracy.

## 9. Parcel association (`backend/src/services/aiBuildings/associate.js`)

WGS-84 polygons only. The demo parcels are axis-aligned rectangles (`geo.js
rectRing`), so the building polygon is **clipped to each parcel rectangle**
(Sutherland–Hodgman) for an exact intersection area; `geo.js` `ringAreaM2` /
`bbox` are reused, plus a ray-cast `pointInRing`.

| `parcelStatus` | Rule |
| --- | --- |
| `MATCHED` | centroid inside one parcel **and** overlap ≥ **70 %** of the building area → `parentParcelId` + `parentULPIN` (the parcel's **existing** ULPIN) |
| `MULTI_PARCEL` | ≥ 2 parcels each covering ≥ **15 %** → **no single pick**; `parcelCandidates[]` exposed; `parentULPIN: null` |
| `REVIEW_REQUIRED` | centroid inside a parcel but overlap < 70 % → `parentParcelId` set, `parentULPIN: null` |
| `OUTSIDE_PARCEL` | no parcel contains the centroid and no meaningful overlap |

`ulpinStatus` is always `DEMO_NOT_OFFICIAL`. No official ULPIN is ever generated.

## 10. 3D / Cesium integration

- **ONE** existing Chennai-wide `Cesium.Viewer` — no second viewer, no separate
  AI map, no per-locality map.
- New layer **"AI-Derived Buildings"** (`LayerManager`, group *AI Extraction*,
  `DemoTag`). `DEFAULT_LAYERS.aiBuildings = false` — **OFF by default**, so it
  never affects the existing map / LOD until a user turns it on.
- `Cesium3DMap.ensureAiBuildings(areaId)` — lazy per area, idempotent (guarded by
  `aiBuildingId`), re-run on every `flyToArea` so a fresh extraction appears
  without a page reload. Extruded translucent-orange polygons
  (`properties.kind: 'ai-building'`), amber if review-required.
- **Height** — AI buildings have no surveyed height (`heightStatus:
  "UNAVAILABLE"`). They are extruded with a fixed `ESTIMATED_AI_HEIGHT_M = 24`
  flagged `estimated: true`. The sidebar states this is ESTIMATED / DEMO, **not**
  survey / LiDAR / GNSS-derived.
- Uses the existing camera, area navigation, LOD, entity-visibility, picking and
  isolation. Picking an `ai-building` → `selectAiBuilding()` → the existing
  `PropertySidebar` renders an **`AiBuildingCard`** (Building ID, Source
  `AI_DEMO`, Model, Model Version, Confidence, Confidence Level, Geometry Status,
  Parent Parcel, Parent ULPIN + `DEMO_NOT_OFFICIAL`, Height *Not available*,
  Timestamp, Review Status + Accept/Reject/Needs-Correction).

## 11. Review workflow

`reviewStatus ∈ {REVIEW_REQUIRED, ACCEPTED, REJECTED, NEEDS_CORRECTION}` via
`PATCH /api/ai/buildings/:id/review` (`change-detection:review` permission).
Writes an `AI_BUILDING_REVIEWED` audit row. **A review confers no official,
verified or ownership status** — it is a prototype decision-support flag.

## 12. API (additive; existing routes unchanged)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/ai/buildings/infer` | `ai:run` | multipart `image` (+ `locality`) → run extraction; **200** with `status ∈ {COMPLETED, NO_BUILDINGS, INFERENCE_UNAVAILABLE}`; **400** for bad uploads; never 500 |
| GET | `/api/ai/buildings` | public | `?parcel=&job=&locality=&reviewStatus=&confidenceLevel=` |
| GET | `/api/ai/buildings/:id` | public | one AI building + full metadata |
| PATCH | `/api/ai/buildings/:id/review` | `change-detection:review` | set `reviewStatus` |
| GET | `/api/ai/jobs` · `/api/ai/jobs/:id` | public | job list / status + summary |
| GET | `/api/gis/ai-buildings` | public | `?locality=` — GeoJSON FeatureCollection of **georeferenced** AI buildings for the Cesium layer |
| GET | `/api/ai/status` | public | existing — now also `buildingExtraction { endpoint, aiServiceConfigured, supportedInput, source: "AI_DEMO" }` |

FastAPI (`ai-service`): `POST /buildings/infer` (multipart), `GET
/buildings/config` (active thresholds + disclaimer). Existing `/health`,
`/features`, `/infer/{feature}` unchanged.

## 13. MongoDB

Two **new** collections — no change to any existing collection or the seed:

- **`aiBuildings`** — `{ aiBuildingId, jobId, geometry|null, pixelPolygon,
  georeferenced, geoStatus, source:"AI_DEMO", model, modelVersion, timestamp,
  confidence, confidenceLevel, geometryStatus, geometryIssues[], areaM2, areaPx,
  parcelStatus, parentParcelId, parentULPIN, ulpinStatus:"DEMO_NOT_OFFICIAL",
  parcelCandidates[], height:null, heightStatus:"UNAVAILABLE", reviewRequired,
  reviewStatus, locality, isDemo:true }`
- **`aiJobs`** — `{ jobId, status (PROCESSING|COMPLETED|NO_BUILDINGS|FAILED),
  imageName, imageBytes, locality, requestedBy, createdAt, completedAt, model,
  summary, notes[], error }`

## 14. How to run

```bash
# once
pip install -r ai-service/requirements.txt          # numpy, scikit-image, shapely, rasterio, pyproj, …
python ai-service/scripts/make_fixtures.py           # test fixtures (synthetic AI_DEMO raster)

# dev
npm run dev:ai        # uvicorn app.main:app --port 8000   (ai-service/)
npm run dev           # backend :4000 + frontend :5173  (backend/.env AI_SERVICE_URL=http://localhost:8000)

# tests
npm run test:ai       # pytest ai-service/tests
npm run test:backend  # node --test
npm run test:e2e      # playwright (its webServer starts the ai-service too)
```

Config (all optional, all documented in `.env.example`): `AI_SERVICE_URL`,
`AI_MODEL` (`classical`|`unet`), `AI_UNET_WEIGHTS`,
`BUILDING_CONFIDENCE_THRESHOLD`, `AI_CONF_HIGH`, `AI_CONF_MED`,
`AI_MAX_IMAGE_PX`, `AI_MAX_UPLOAD_MB`, `AI_INFER_TIMEOUT_MS`.

## 15. Limitations / future phases

- Segmentation quality: the classical default is a heuristic; the U-Net path
  needs trained weights. Neither is validated for Chennai.
- Only the demo (rectangular) parcels are supported by the exact-clip
  association; a real polygon-intersection library would generalise it.
- Height is unavailable — a fixed ESTIMATED/DEMO extrusion only.
- Out of scope (later phases): floor-plan segmentation, LiDAR / DEM-DSM,
  GNSS/CORS, PostGIS, QGIS automation, volumetric legal rights, official 3D
  ULPIN standardisation.
