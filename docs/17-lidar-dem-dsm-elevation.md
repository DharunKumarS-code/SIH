# 17 — Elevation / LiDAR / Point Cloud / DEM / DSM Integration (Phase 5)

> **ELEVATION_DEMO / MODEL OUTPUT.** This is an **estimation pipeline**, not a
> survey. Building height, ground elevation and roof elevation are derived by
> subtracting a Digital Elevation Model (DEM, bare-earth) from a Digital
> Surface Model (DSM, top-of-surface) over demo/research or user-supplied
> elevation data. None of it is official, survey-certified or
> government-authoritative elevation data, and Phase 5 generates no official
> ULPIN. Every derived value carries explicit provenance
> (`ELEVATION_DEMO` / `RESEARCH_DATA` / `TEST_FIXTURE` / `USER_SUPPLIED`) and
> is never labelled `OFFICIAL`.

Additive to Phases 1–4. If the Python `ai-service` is unavailable, elevation
endpoints return `INFERENCE_UNAVAILABLE` and the rest of the app is unaffected.
Nothing here overwrites an existing building's height, floor elevation or unit
z-range automatically — a human reviewer must explicitly **accept** a result
before it is applied, and that acceptance is always reversible.

```
LAS/LAZ point cloud  ─┐
                       ├─▶ ground classification ─▶ DEM ─┐
DEM raster (direct) ──┘                                   ├─▶ DSM − DEM
DSM raster (direct) / point cloud (all points) ─▶ DSM ────┘      │
                                                                   ▼
                                          per-building robust height sampling
                                                   │
                                        quality validation + confidence
                                                   │
                                    buildingHeights (MongoDB, own collection)
                                                   │
                          explicit reviewer ACCEPT (reversible) ──▶ existing
                          Building.baseElevationM/heightM + Floor/Unit
                          baseHeight/topHeight (Phase 2 geometry3d model)
                                                   │
                              existing ONE Chennai-wide Cesium viewer
```

---

## 1. Architecture

| Layer | Tech | Role |
| --- | --- | --- |
| Frontend | React (`pages/ElevationLiDAR.jsx`) | upload, validate, process, results, accept/reject — never runs Python |
| Node API | Express (`controllers/aiElevationController.js`, `services/aiElevation/`) | file validation, job lifecycle, storage, RBAC, reversible height integration |
| AI service | Python 3.10 / FastAPI (`ai-service/app/elevation/`) | LAS/LAZ + GeoTIFF I/O, ground classification, DEM/DSM generation, robust height sampling, quality/confidence |
| Store | existing MongoDB Atlas (new collections `elevationDatasets`, `buildingHeights`; `aiJobs` reused with `kind: 'elevation'`) | **no migration, no PostGIS** |

Node calls the AI service over HTTP (`AI_SERVICE_URL`), the same pattern as
Phase 3/4. **Raw LAS/LAZ/GeoTIFF bytes are never persisted** — every request
re-sends the file(s) to the stateless ai-service; only derived metadata and
results are stored (spec constraint: no massive binary blobs in MongoDB
unless the architecture explicitly supports it — it doesn't). This is why the
UI workflow is "upload → validate (same file, step 1) → process (same file
again, step 2)" rather than "upload once, process a stored dataset later".

## 2. Supported inputs

| Format | Library | Notes |
| --- | --- | --- |
| LAS | `laspy` | chunked reading (`laspy.open().chunk_iterator()`) — points are never all resident in memory at once |
| LAZ | `laspy` + `lazrs` (or `laszip`) backend | if no LAZ backend is installed, LAZ uploads fail with a clear `INVALID_INPUT`, not a silent wrong read; plain LAS still works |
| DEM / DSM raster | `rasterio` (already a Phase 3 dependency) | GeoTIFF only; capped at `ELEV_MAX_RASTER_PX` px/side |

PDAL and QGIS are deliberately **not** used (spec constraint) — `laspy` +
`rasterio` + `numpy`/`scipy` + `shapely`/`pyproj` cover the pipeline without a
native PDAL toolchain or a QGIS Desktop/server dependency.

## 3. Dataset provenance

No authoritative Chennai LiDAR/DEM/DSM dataset was available for this
prototype (see docs/13 for the equivalent official-ULPIN investigation — the
same conclusion applies here: no public, freely-licensed, Chennai-specific
LiDAR/DEM/DSM product was found). Every dataset processed by this phase is
therefore labelled with one of:

| Label | Meaning |
| --- | --- |
| `ELEVATION_DEMO` | synthetic demo data generated for this prototype (default) |
| `RESEARCH_DATA` | a public research dataset, not Chennai-official |
| `TEST_FIXTURE` | deterministic fixtures used only by the automated test suite |
| `USER_SUPPLIED` | a file the user uploaded themselves — still not verified as official |

`isOfficial` is **hard-coded `false`** in `app/elevation/provenance.py` for
every one of these — no code path can flip it to official. If no dataset has
been processed for a building at all, the height endpoint reports
`dataAvailability: "UNAVAILABLE"` with a reason, never an invented number.

## 4. CRS / vertical datum handling (critical)

Before any DEM/DSM combination:

- **Horizontal CRS** is read from the GeoTIFF (`rasterio`) or the LAS
  VLRs/GeoKeys (`laspy.LasHeader.parse_crs()`, needs `pyproj`). Two rasters'
  CRS are compared with `pyproj.CRS.equals()` (`app/elevation/crs.py`) →
  `MATCHED` / `MISMATCH` / `UNKNOWN` (never assumed).
- **Vertical datum** cannot be reliably read off a plain GeoTIFF, so it is
  **caller-supplied metadata** (`verticalDatumDem` / `verticalDatumDsm` form
  fields). Two datums are only compared when *both* are supplied; otherwise
  the result is `UNKNOWN`, not assumed to match.
- **Units** are never assumed to be metres — a raster's CRS is checked
  (`crs.is_projected` + axis unit) before its resolution is reported in
  metres; a non-metric CRS is flagged in `notes`, not silently treated as
  metres.
- **No whole-raster reprojection happens.** Per-building sampling instead
  reprojects the always-WGS84 building footprint into *each* raster's own CRS
  independently (`raster_io.sample_footprint`) — this correctly handles a DEM
  and a DSM in two different CRSs without ever combining them in a shared
  grid, and every reprojection is logged in the result's `crsComparison`
  block (`horizontalCRS`, `verticalDatum`, `crsStatus`, `transformApplied`).
- If CRS is missing entirely, `crsStatus = "UNKNOWN"` and every downstream
  quality check treats that as a `WARNING` requiring review — never invented.

## 5. Point-cloud validation

`app/elevation/las_io.py::validate()` checks, from the LAS header alone
(no full read required): file signature (`LASF`), point count (zero → `ERROR`,
< 50 → `INSUFFICIENT_POINT_DENSITY` `WARNING`), coordinate-range sanity
(inverted/non-finite bounds → `ERROR`; > 5 km Z-range → `WARNING`), CRS
presence, and whether ASPRS classification codes are usable. A malformed or
truncated file raises `LasError`, which the Node layer maps to HTTP 400
(`errorKind: INVALID_INPUT`) — never a 500 or a stack trace.

## 6. Ground classification

Two methods, in priority order (`app/elevation/ground_classification.py`):

1. **`LAS_CLASSIFICATION_CODE_2`** — the file already carries ASPRS
   classification and code 2 (ground) is present. Used as-is; the
   professional classification process that produced it is not re-validated.
2. **`DETERMINISTIC_LOWEST_PER_CELL`** — a documented fallback heuristic for
   unclassified research/demo point clouds: the lowest-elevation point in
   each DEM grid cell is taken as the ground proxy. This is explicitly a
   coarse approximation, **never** presented as equivalent to a
   professionally classified LiDAR ground product.

The chosen method, and a base confidence contribution, are recorded on every
result (`groundClassificationMethod`).

## 7. DEM / DSM generation

`app/elevation/grid.py` streams the point cloud **once** via
`las_io.chunk_iterator()` and accumulates directly into two fixed-size output
grids with `numpy.minimum.at` (DEM, ground-only, min-per-cell) and
`numpy.maximum.at` (DSM, all points, max-per-cell) — memory use is
O(grid cells + chunk size) regardless of point-cloud size, up to
`ELEV_MAX_POINTS`. Resolution defaults to 1 m (`ELEV_GRID_RESOLUTION_M`),
auto-coarsened (with a logged note) if the grid would exceed
`ELEV_MAX_GRID_CELLS`. **Empty cells are left as explicit NoData (`NaN`)** —
large coverage gaps are never filled with invented values.

When a DEM and/or DSM raster is supplied directly instead of a point cloud,
they are used as-is (`raster_io.open_raster`).

## 8. Building height — DSM − DEM, robustly

For each building footprint (`app/elevation/height.py::compute_building_height`):

1. **Ground (DEM)** is sampled from an **annulus just outside the footprint**
   (`ELEV_GROUND_ANNULUS_BUFFER_M`, default 3 m), not from inside it — the
   ground directly under a building is normally occluded in the source data.
   If the annulus has no valid coverage, it falls back to sampling inside the
   footprint + a small buffer, flagged with a `GROUND_SAMPLE_FALLBACK`
   `WARNING`.
2. **Roof (DSM)** is sampled from the footprint interior + a small buffer
   (`ELEV_FOOTPRINT_BUFFER_M`, default 1 m).
3. Both sample sets are **outlier-clipped** to the
   `[ELEV_OUTLIER_LOW_PCT, ELEV_OUTLIER_HIGH_PCT]` percentile band (default
   2–98%) before any statistic is computed, so a handful of contaminated
   pixels (vegetation, a parked vehicle, a chimney) cannot dominate the
   result.
4. A documented statistic (default **median** for both ground and roof;
   `p10`/`p90`/`trimmed_mean` also available) produces `groundElevationM` and
   `roofElevationM`. `roofElevationMinM` / `MedianM` / `MaxM` are also
   reported (spec section 17: roofs are not always flat).
5. `buildingHeightM = roofElevationM − groundElevationM`
   (`heightMethod: "DSM_MINUS_DEM"`).

## 9. Quality validation (`app/elevation/quality.py::evaluate`)

Deterministic rule-based checks, each `VALID` / `WARNING` / `ERROR` with a
`rule` slug and message — not AI:

| Rule | Trigger | Severity |
| --- | --- | --- |
| `DEM_MISSING` / `DSM_MISSING` | no valid samples found | `ERROR` |
| `INSUFFICIENT_DEM/DSM_SAMPLES` | fewer than `ELEV_MIN_VALID_SAMPLES` | `WARNING` |
| `NEGATIVE_HEIGHT` | height < 0 | `ERROR` if below `ELEV_NEG_HEIGHT_ERROR_M` (default −2 m), else `WARNING` (small negative — sensor noise / minor registration offset) |
| `ZERO_HEIGHT` | \|height\| ≤ `ELEV_ZERO_HEIGHT_TOL_M` | `WARNING` |
| `EXTREME_HEIGHT` | above `ELEV_WARN_HEIGHT_M` (120 m) / `ELEV_MAX_PLAUSIBLE_HEIGHT_M` (250 m) | `WARNING` / `ERROR` |
| `OUTLIER_RATE` | > `ELEV_OUTLIER_RATE_WARN` (35%) of raw DSM samples were clipped | `WARNING` (possible vegetation/vehicle contamination) |
| `PARTIAL_FOOTPRINT_COVERAGE` | sampled-region coverage below `ELEV_SAMPLE_COVERAGE_WARN` (40%) | `WARNING` |
| `CRS_STATUS` | `UNKNOWN` / `MISMATCH` | `WARNING` / `ERROR` |

All thresholds are environment-variable-configurable, never hard-coded through
the codebase.

## 10. Confidence (quality/confidence score, not a calibrated probability)

`app/elevation/quality.py::confidence` computes a weighted `[0,1]` score from
four factors (default weights: samples 30%, coverage 25%, consistency 25%,
CRS validity 20%) → `HIGH` (≥ 0.75) / `MEDIUM` (≥ 0.45) / `LOW`. The API and
UI both label this a **quality/confidence score**, explicitly not a
statistically calibrated probability.

## 11. Provenance vs. the existing demo height (Phase 2)

Phase 2 seeds every building with a synthetic `heightM`/`baseElevationM`. A
new elevation-derived result is **never** applied automatically:

- `POST /api/elevation/process` only ever writes to the new `buildingHeights`
  collection — the existing `buildings` document is untouched.
- `GET /api/elevation/buildings/:id/height` reports the elevation result
  alongside `existingHeightM` / `existingHeightSource` (`DEMO_ESTIMATED`, or
  the previously accepted `elevationSource`), so a reviewer can compare them.
- `PATCH /api/elevation/buildings/:id/review { action: "ACCEPT" }` (requires
  `change-detection:review`, and is refused if `qualityStatus === "ERROR"`)
  is the **only** path that changes the building. It is a uniform affine
  rescale of z (`backend/src/services/aiElevation/heightIntegration.js`):

  ```
  scale = newHeight / oldHeight
  z'    = newGroundElevation + (z − oldBaseElevation) × scale
  ```

  applied to the building's `baseElevationM`/`heightM` **and** every one of
  its floors' and units' `baseHeight`/`topHeight` — preserving floor
  ordering, floor-thickness ratios and unit containment exactly (only the
  vertical scale/offset changes; x/y never do). The pre-override values are
  backed up once, on first application, into an `elevationOriginal` field on
  each doc.
- `POST /api/elevation/buildings/:id/revert` restores that exact backup on
  every affected doc and clears `elevationOverrideActive`. Nothing is ever
  deleted, and accept/revert can be repeated freely.

This is why sections 14–16 of the spec ("improve building extrusion / floor
elevation / unit z-ranges") are satisfied **without a second volume model**:
`geometry3d/volume.js`'s existing `buildingVolume()` / `floorVolume()` /
`unitVolume()` already read `baseElevationM`/`heightM`/`baseHeight`/`topHeight`
generically, so once accepted, the existing Phase 2 volume assembly and the
existing `GET /api/gis/buildings` (which now also exposes
`elevationOverrideActive` / `elevationSource` / `elevationConfidenceLevel`)
pick the new geometry up with no further changes.

## 12. Irregular roofs

`buildingHeightM` uses one documented statistic (default median), but the
result also carries `roofElevationMinM` / `MedianM` / `MaxM` so a flat,
pitched, stepped or otherwise irregular roof's actual spread is visible
rather than hidden behind a single number.

## 13. API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/elevation/config` | pipeline stages + thresholds (passthrough from ai-service) |
| POST | `/api/elevation/upload` | multipart `file` + `datasetType` (DEM\|DSM\|POINTCLOUD) — validate only, `requirePermission('ai:run')` |
| POST | `/api/elevation/process` | multipart `dem`/`dsm`/`pointcloud` + `buildingIds` or `locality` — full pipeline, `ai:run` |
| GET | `/api/elevation/datasets` / `/:id` / `/:id/status` | validated-dataset metadata (never raw bytes) |
| GET | `/api/elevation/coverage` | per-locality dataset counts |
| GET | `/api/elevation/buildings/:buildingId/height` | latest result, or `UNAVAILABLE` + reason |
| GET | `/api/elevation/buildings/:buildingId/quality` | quality issues + confidence |
| PATCH | `/api/elevation/buildings/:buildingId/review` | `{ action: "ACCEPT" \| "REJECT" }`, `change-detection:review` |
| POST | `/api/elevation/buildings/:buildingId/revert` | undo an ACCEPT, `change-detection:review` |

Existing endpoints (`/api/ai/jobs`, `/api/buildings/:id`, `/api/gis/buildings`,
…) are unchanged in shape — elevation jobs simply appear in `/api/ai/jobs`
with `kind: "elevation"` (the same reuse pattern Phase 4 uses for
`kind: "floorplan"`).

## 14. Database

MongoDB Atlas only — no PostGIS migration. Two new collections, following the
existing permissive-schema (`strict: false`) + natural-key-index convention:

- `elevationDatasets` — validated-dataset metadata + provenance (never raw
  LAS/LAZ/GeoTIFF bytes).
- `buildingHeights` — one document per (building, processing job): ground /
  roof / height, method, sample counts, quality issues, confidence,
  provenance, review status.

`aiJobs` is reused with `kind: "elevation"`.

## 15. Cesium integration

**No second viewer.** The existing single Chennai-wide Cesium viewer
(`components/map/Cesium3DMap.jsx`) is reused unchanged except:

- `GET /api/gis/buildings` now also returns `elevationOverrideActive` /
  `elevationSource` / `elevationConfidenceLevel` / `elevationQualityStatus`.
  Because an accepted override already rewrites the building's own
  `heightM`/`baseElevationM`, the *existing* extrusion code
  (`height`/`extrudedHeight` from `f.properties.heightM`) picks up the
  improved height automatically — no new rendering path was added.
- An optional, OFF-by-default **"Height Quality"** layer
  (`layers.elevationHeightQuality`, `LayerManager.jsx` → "Elevation / LiDAR"
  group) recolours a building shell by `elevationConfidenceLevel`
  (green/gold/red) only when that building has an accepted override; every
  other building keeps its normal shell colour. Toggling it never touches
  LOD, progressive loading, picking or isolation.
- Raw point clouds are **never** rendered — city-level view shows no point
  cloud, area-level shows nothing extra, and per-building elevation
  diagnostics are the `ElevationLiDAR` page's results table + the sidebar's
  "Elevation-Derived Height" panel, not a 3D point splat.
- `PropertySidebar.jsx` adds a `BuildingElevationPanel`, shown under the
  building/floor placeholder: Building Height / Ground / Roof / Source /
  Confidence / Quality, or an explicit "Unavailable" + reason.

Cesium World Terrain (already configured, unrelated to this dataset) is left
as-is; there is no tile-serving path in this prototype to publish the DEM as
Cesium terrain, so that remains documented as a limitation rather than
half-built.

## 16. Performance

- LAS/LAZ: chunked reads (`ELEV_CHUNK_POINTS`, default 500k), capped at
  `ELEV_MAX_POINTS` (20M).
- Rasters: capped at `ELEV_MAX_RASTER_PX` (8192) px/side.
- DEM/DSM grids: streamed accumulation (`numpy` ufunc `.at`), never holding
  the full point cloud, auto-coarsened resolution if the cell count would be
  excessive.
- Per-building sampling only reads the pixels inside the footprint + a small
  buffer (`raster_io.sample_footprint`'s bounded pixel window) — never the
  whole raster.
- The reversible height-integration writes (`heightIntegration.js`) issue one
  Mongo round-trip per floor/unit **concurrently** (`Promise.all`), not
  sequentially — a ~10-floor, ~80-unit building's accept/revert completes in
  a few seconds against Atlas instead of a minute.
- Raw point-cloud/raster bytes are never stored, so there is no derived-data
  cache invalidation problem to manage.

## 17. Limitations (explicit)

- DSM − DEM is an **estimated** surface/building-height method, not a survey.
- Vegetation, vehicles and other temporary objects can raise DSM cells and
  bias a roof estimate (mitigated, not eliminated, by outlier clipping).
- Roof geometry can be complex (pitched, stepped, irregular) — one statistic
  cannot capture all of it; min/median/max are reported alongside it.
- Ground-classification quality varies: real ASPRS-classified LiDAR is far
  more reliable than the `DETERMINISTIC_LOWEST_PER_CELL` fallback used for
  unclassified research/demo clouds.
- A CRS or vertical-datum mismatch invalidates a height calculation — this is
  detected and surfaced (`ERROR`/`WARNING`), never silently ignored.
- Missing data stays `NoData`/`UNAVAILABLE` — it is never invented.
- No authoritative Chennai LiDAR/DEM/DSM dataset exists in this prototype;
  every dataset processed is demo/research/test/user-supplied, never
  `OFFICIAL`.
- Building height derived from demo data is **not survey-certified**.
- AI-derived floor/unit geometry (Phase 3/4) remains demo/research data —
  Phase 5 does not change its provenance.
- Phase 5 generates **no** official ULPIN.

## 18. Test strategy

- **Python** (`ai-service/tests/test_elevation_*.py`, 40+ cases): LAS/LAZ
  loading, point validation, CRS extraction, ground classification (both
  methods), DEM/DSM generation, raster alignment, DSM−DEM, robust height
  sampling, outlier filtering, confidence/quality scoring, NoData handling,
  CRS mismatch, malformed input — deterministic, offline, against small
  synthetic fixtures (`ai-service/scripts/make_elevation_fixtures.py`,
  `ai-service/tests/fixtures/elevation/`; a known 20 m building height on a
  flat ground plane is asserted exactly).
- **Backend** (`backend/tests/api.test.js`, `phase5:` cases): upload
  validation, RBAC (`ai:run`, `change-detection:review`), the full
  process pipeline against real seeded buildings, graceful
  `INFERENCE_UNAVAILABLE`/`UNAVAILABLE` degradation, the accept/revert
  round-trip (asserted against the real Phase 2 seed data — building, every
  floor and every unit), and existing-API compatibility.
- **E2E** (`tests/e2e/landstack.spec.js`, `Phase 5 —` describe block):
  `/elevation` route smoke, upload → validate → process → results table,
  the building-height sidebar panel's graceful "Unavailable" state, and the
  height-quality layer toggle not disturbing the existing single viewer/LOD.
- No large real-world datasets are committed — only small deterministic
  fixtures (a handful of KB each).
