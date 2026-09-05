# 18 — GNSS/CORS High-Precision Spatial Control (Phase 6)

> **GNSS/CORS DEMO / MODEL OUTPUT.** Control-point coordinates, elevations,
> deviations and validation results in this system are derived from uploaded,
> demonstration, research or survey datasets. They are **not** automatically
> official cadastral control points or government-authoritative survey data.
> GNSS/CORS accuracy is only reported when supported by actual supplied survey
> observations. Existing parcel geometry is never overwritten without
> explicit, authorized review. No official ULPIN or official 3D cadastral
> record is created by this phase.

## 1. Objective

Phase 6 adds a GNSS/CORS high-precision spatial-control workflow on top of the
existing Parcel → Building → Floor → Unit → 3D Volume stack (Phases 1–5):

```
GNSS/CORS observation file
    -> control points (parsed, sanitised)
    -> coordinate validation (deterministic rules)
    -> CRS / datum resolution (pass-through or pyproj transform)
    -> parcel association (existing parcels + ULPIN, spatial only)
    -> boundary verification (observed deviation vs. tolerance)
    -> 3D reference framework (building / floor / unit / volume, Phase 2)
    -> DEM/DSM elevation comparison (Phase 5, when available)
    -> reviewable spatial-control result (stored + shown in the ONE Cesium viewer)
```

The whole phase is additive: no Phase 1–5 route, service, model, or UI
component is changed in a way that alters its existing behaviour. GNSS/CORS
data lives in its own collections and its own opt-in Cesium layer.

## 2. Architecture

- **Frontend** — `frontend/src/pages/GNSSControlPoints.jsx` (`/gnss`, nav
  entry gated on `ai:run`) drives upload → validate → import → boundary
  verification → geometry-proposal review. The **existing, single**
  Chennai-wide `Cesium3DMap.jsx` viewer gained one more optional layer
  (`gnssControlPoints`, OFF by default) and one more selection mode
  (`gnss-point`), rendered through `PropertySidebar.jsx`. No new map,
  no per-locality viewer.
- **Backend** — `backend/src/services/gnss/*.js` (parsing, validation, CRS
  resolution client, outlier detection, parcel association, boundary
  verification, elevation-residual lookup, geometry-proposal workflow) behind
  `backend/src/controllers/gnssController.js` and the additive
  `/api/gnss/*` and `/api/gis/gnss-control-points` routes. Existing RBAC
  (`requireAuth`/`requirePermission`) is reused as-is.
- **AI/GIS service** — `ai-service/app/gnss/` adds exactly one capability:
  `pyproj`-backed CRS transformation (`POST /gnss/transform`,
  `GET /gnss/config`), reusing the same FastAPI process as Phases 3–5.
  Parsing, validation, outlier detection, parcel association and boundary
  verification are all deterministic JavaScript in the Node backend — Python
  is never on the critical path for anything except an explicit CRS
  transform, and its unavailability degrades gracefully rather than blocking
  the rest of the pipeline.

Everything else (parsing, rule-based validation, outlier detection, parcel
association, boundary math, review-proposal state machine) is deterministic —
no ML model is used or implied anywhere in Phase 6.

## 3. Data model

Every stored control point (`gnssControlPoints` collection) carries the core
contract from the spec, populated from the uploaded file:

`controlPointId`, `latitude`, `longitude`, `height`, `accuracy`,
`coordinateReferenceSystem`, `timestamp`, `source`, `surveyMethod`.

Optional metadata is stored **only when supplied** — it is never defaulted,
inferred or fabricated:

`horizontalAccuracy`, `verticalAccuracy`, `accuracyUnit`, `horizontalDatum`,
`verticalDatum`, `epoch`, `antennaHeight`, `observationDuration`,
`fixStatus`, `satelliteCount`, `pdop`, `correctionSource`,
`referenceStation`, `operator`, `surveySessionId`, `provenanceNote`,
`verificationStatus`.

Derived/bookkeeping fields added by the pipeline: `resolvedLatitude`/
`resolvedLongitude` (post-CRS-resolution WGS84), `crsStatus`,
`accuracyStatus`, `isSurveyGradeSource`, `validationStatus`/
`validationIssues`, `parcelStatus`/`parentParcelId`/`parentULPIN`/
`associationConfidence`/`parcelCandidates`/`nearestBoundaryM`, `jobId`,
`locality`, `isOfficial: false`, `isDemo: true`, `disclaimer`, `createdBy`,
`createdAt`.

`backend/src/services/gnss/parse.js` enforces a **fixed field allowlist**
(`CORE_FIELDS` + `METADATA_FIELDS`) when sanitising an uploaded row — any
other key in the source file (including `__proto__`/`constructor`/
`prototype`) is dropped before the row reaches validation or storage.

## 4. Provenance

`source` is normalised to one of: `REAL_SURVEY`, `CORS_SURVEY`,
`UPLOADED_SURVEY`, `DEMO`, `RESEARCH`, `UNVERIFIED`, `TEST_FIXTURE` (an
unrecognised value falls back to `UNVERIFIED`, never to something more
official). `isSurveyGradeSource` reflects only whether the *source label*
names a genuine survey channel (`REAL_SURVEY`/`CORS_SURVEY`/
`UPLOADED_SURVEY`) — **it is a label, not proof of accuracy.**

There is no code path anywhere in Phase 6 that promotes a point's provenance
or `verificationStatus` (`UNVERIFIED` → `ACCEPTED`/`REJECTED`, set via
`POST /api/gnss/review`) to an "official" status — every stored point keeps
`isOfficial: false` and `isDemo: true` unconditionally.

Three accuracy-shaped concepts are kept explicitly distinct, everywhere in the
API and the UI, per the spec:

| Field | Meaning | Source |
|---|---|---|
| `accuracy` / `reportedAccuracy` | The accuracy value **as supplied** by the dataset | Uploaded file only — `accuracyStatus: 'REPORTED'` when present, `'UNAVAILABLE'` (or `'NOT_SURVEY_VALIDATED'` for `DEMO`/`TEST_FIXTURE` sources) when absent. Never inferred from `source`/`surveyMethod`. |
| `computedResidual` (boundary deviation `distanceM`, elevation `elevationResidualM`) | A number **our own validation math produced** by comparing the point to something else (a parcel boundary, a DEM/DSM height) | `boundary.js` / `elevation.js` |
| `validationTolerance` (`GNSS_CONFIG.boundaryToleranceM`, `outlierMadK`, …) | The threshold **we** apply to decide VALID/WARNING/REVIEW_REQUIRED | `backend/src/services/gnss/config.js`, env-overridable |

A computed residual is never relabelled as a "survey accuracy", and a
reported accuracy is never used to override a computed residual's
interpretation.

## 5. CRS / datum handling

- A control point with no `coordinateReferenceSystem`, or an unparsable one,
  is `crsStatus: 'UNKNOWN'` — its coordinates are used as-is for WGS84 display
  **only if left blank was actually meant as WGS84 by convention**; the
  pipeline never silently assumes WGS84 for a projected CRS. `CRS_UNKNOWN` is
  raised as a `WARNING`, not an error, so the batch can still be reviewed.
- `EPSG:4326`/`WGS84`/`WGS 84`/`4326` are recognised as geographic and used
  directly (`crsStatus: 'MATCHED'`).
- Any other declared CRS is sent, once per distinct CRS in the batch, to the
  ai-service's `POST /gnss/transform` (`pyproj.Transformer`, `always_xy`).
  A successful transform sets `crsStatus: 'REPROJECTED'` and replaces
  `resolvedLatitude`/`resolvedLongitude`; a CRS that fails to parse is
  `UNKNOWN`; a transform that raises, times out, or an unreachable ai-service
  all report `TRANSFORMATION_UNAVAILABLE` with a `TRANSFORMATION_FAILURE`
  validation issue — **the point's `resolvedLatitude`/`resolvedLongitude` are
  left `null`, never a guessed coordinate**, so it cannot be silently placed
  on the map or associated with a parcel.
- Every transform response/record carries `sourceCRS`, `targetCRS`, whether a
  transform was actually applied, and a human-readable `note` — see
  `ai-service/app/gnss/pipeline.py` and `crs.py`.

## 6. Input formats

CSV, JSON (`[...]` or `{ "controlPoints": [...] }`), and GeoJSON
(`FeatureCollection` of `Point` features, with `longitude`/`latitude`/
`height` filled from the geometry coordinates when the properties don't
already supply them) are all supported by
`backend/src/services/gnss/parse.js`. An optional `fieldMap` (`{ targetField:
sourceColumnName }`) lets a differently-named source column map onto the
core contract; unknown/unsafe target or source names are dropped rather than
applied. Malformed input (bad JSON, wrong GeoJSON shape, empty file,
unsupported format) is rejected as a `400` with a clear message, never a
500 or a partially-parsed result.

## 7. Validation

`backend/src/services/gnss/validate.js` runs a fixed, deterministic rule set
per point and per batch, each yielding `VALID`/`WARNING`/`ERROR` plus a
`rule` slug and message: `INVALID_LATITUDE`, `INVALID_LONGITUDE`,
`MISSING_COORDINATE`, `INVALID_HEIGHT`, `DUPLICATE_CONTROL_POINT_ID`,
`DUPLICATE_COORDINATE`, `CRS_UNKNOWN`, `TRANSFORMATION_FAILURE` (CRS
mismatch/transform failure), `OUTLIER_COORDINATE`, `HEIGHT_OUTLIER`,
`MISSING_TIMESTAMP`/`INVALID_TIMESTAMP`, `ACCURACY_UNAVAILABLE`/
`IMPOSSIBLE_ACCURACY`. Parcel-side rules (`OUTSIDE_PARCEL`, `MULTI_PARCEL`,
`BOUNDARY_DEVIATION`, `REVIEW_REQUIRED`) are reported alongside as
`parcelStatus` (§9). A batch's `overallStatus` is the worst of its points'
`validationStatus`; the import button is disabled client-side while any point
is `ERROR`.

## 8. Outlier detection

`backend/src/services/gnss/outliers.js` uses **median + median absolute
deviation (MAD)** — robust statistics, not a normal-distribution assumption,
so the outliers being searched for don't distort the baseline. Spatial
outliers are flagged from each point's robust z-score on its
nearest-neighbour distance (`outlierMadK`, default 3.5, only large *positive*
z — being unusually close to a neighbour is a duplicate concern, not an
outlier one); height outliers use the same robust z-score directly on
`height`. Outlier detection only runs once a batch has at least
`minPointsForOutlierDetection` (default 4) points with usable coordinates.
Every flag is reported as `OUTLIER_COORDINATE`/`HEIGHT_OUTLIER` — described
as a statistical deviation from neighbouring points, never as "this
measurement is inaccurate."

## 9. Parcel association

`backend/src/services/gnss/associate.js` tests a resolved point against
every parcel polygon in the target locality (existing `parcels` collection,
ray-casting point-in-ring + nearest-boundary-segment distance,
`geomUtils.js`):

- **`MULTI_PARCEL`** — inside two or more (overlapping) parcels.
- **`MATCHED`** — inside exactly one parcel, clear of its boundary by more
  than `boundaryToleranceM` (default 1 m). `associationConfidence` is a
  simple, documented 0–1 heuristic (distance-to-boundary normalised by the
  candidate radius) — **not** a calibrated statistical probability.
- **`REVIEW_REQUIRED`** — inside a parcel but within tolerance of its
  boundary, or just outside every parcel but within tolerance of one — never
  arbitrarily resolved to matched/outside.
- **`OUTSIDE_PARCEL`** — not inside, and not near, any parcel.

A control point never creates, changes, or infers a ULPIN — `parentULPIN` is
only ever copied from the matched parcel's own existing `ulpin` field, which
the UI displays as a reference (§13 `13-official-ulpin-data-investigation.md`
governs whether that ULPIN itself is official).

## 10. Boundary verification

`backend/src/services/gnss/boundary.js` computes, per control point, the
perpendicular distance from the point to the nearest segment of the parcel's
*existing* boundary ring, and classifies it `WITHIN_TOLERANCE` /
`REVIEW_REQUIRED` / `OUTSIDE_TOLERANCE` against `boundaryToleranceM`.
`verifyParcelBoundary` aggregates a set of points into
count/mean/median/max/RMSE deviation statistics and an overall
`verificationStatus`. This is available both automatically (per stored point,
`nearestBoundaryM`) and on demand (`POST /api/gnss/boundary-analysis`,
`GET /api/gnss/parcels/:ulpin/boundary-verification`) — and it **never
writes to `parcels.geometry`**; the result is explicitly labelled "OBSERVED
DEVIATION ... not an official cadastral correction."

## 11. Geometry review workflow

If control points suggest a boundary discrepancy, an authorized user
(`parcel:boundary-review`) can record a `geometryReviewProposals` document
(`POST /api/gnss/proposals`) carrying `originalGeometry` (copied from the
parcel at proposal time), `proposedGeometry`, the `controlPoints` used,
`deviations`, a `reason`, and `reviewStatus: 'PENDING_REVIEW'`. **Only**
`PATCH /api/gnss/proposals/:id/review` with `action: 'ACCEPT'`, gated on
`change-detection:review`, ever writes to `parcels.geometry` — and it does so
via the existing audit trail (`recordAudit`, `PARCEL_GEOMETRY_PROPOSAL_ACCEPTED`).
A `REJECT` leaves the parcel untouched. The frontend's "Geometry review
proposals" panel (`/gnss`, section 5) lists proposals for a chosen ULPIN and
exposes Accept/Reject to reviewers; a lightweight, separate
`POST /api/gnss/review` additionally lets a reviewer mark an individual
control point `ACCEPTED`/`REJECTED` (its own `verificationStatus`) without
touching parcel geometry at all.

## 12. 3D reference framework & elevation comparison

Control points connect into the existing Phase 2 hierarchy only through their
resolved `parentParcelId`/`parentULPIN`, and — for the elevation comparison —
the nearest Phase 3 building footprint within that parcel
(`elevation.js::nearestBuilding`, a documented nearest-centroid heuristic, not
an authoritative building match). `GET /api/gnss/control-points/:id/elevation-residual`
compares the point's own supplied `height` against the latest Phase 5
`buildingHeights.groundElevationM` for that building (falling back to the
building's `baseElevationM` demo estimate, labelled `DEMO_ESTIMATED`, if no
DEM/DSM result exists yet):

- `dataAvailability: 'UNAVAILABLE'` — no supplied height, or no DEM/DSM/demo
  elevation to compare against — is returned rather than a fabricated number.
- `elevationResidualM` is the plain observed difference; it is not, by
  itself, evidence that either side is wrong.
- `verticalDatumStatus` is `'MATCHED'` only when **both** the control point
  and the building-height record declare a vertical datum and they agree
  case-insensitively; otherwise `'MISMATCH'` or `'UNKNOWN'` — the UI
  explicitly notes when a mismatch/unknown datum limits comparability.

## 13. Cesium integration

There remains **exactly one** Chennai-wide Cesium viewer
(`frontend/src/components/map/Cesium3DMap.jsx`). GNSS/CORS control points are
one more optional entity layer inside it (`groupsRef.current.gnssControlPoints`),
listed in `LayerManager.jsx` as "GNSS / CORS Control" → "GNSS/CORS Control
Points", **OFF by default**. `ensureGnssControlPoints(areaId)` is idempotent
and fetches `GET /api/gis/gnss-control-points?locality=...` — a point is only
placed on the globe when it resolved a usable WGS84 coordinate (`crsStatus`
`MATCHED`/`REPROJECTED`/`UNKNOWN`-with-raw-coords); a `TRANSFORMATION_UNAVAILABLE`
point is omitted rather than guessed onto the map. Points render as small
markers coloured by `validationStatus` (valid/warning/error) and a distinct
selection colour; the layer respects the existing area selection, progressive
loading/LOD, camera navigation, picking and isolation state — no separate
initialisation path, no second viewer instance, and Sholinganallur, Adyar and
Anna Nagar are all served from the same layer.

Selecting a point (`selection.mode === 'gnss-point'`) opens the existing
`PropertySidebar`, which shows: control-point ID, coordinates + height, CRS
+ CRS status, timestamp, source, survey method, reported accuracy (or an
explicit "not available" if it wasn't supplied) with its `accuracyStatus`,
validation status + issues, parcel association (parcel, ULPIN if any,
confidence, nearest-boundary distance), the DEM/DSM elevation residual
(§12) when available, and a review action for users with
`change-detection:review`.

## 14. APIs

All additive, under `/api/gnss/*` (and one GIS layer endpoint):

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/gis/gnss-control-points` | optional | GeoJSON for the Cesium layer |
| GET | `/gnss/config` | optional | Pipeline stages, thresholds, disclaimer |
| POST | `/gnss/control-points/validate` | `ai:run` | Parse + validate a file, no persistence |
| POST | `/gnss/control-points/import` | `ai:run` | Parse, validate, resolve CRS, associate, persist |
| GET | `/gnss/control-points` | optional | List (filterable by locality/ulpin/parcel/status/source) |
| GET | `/gnss/control-points/:id` | optional | One control point |
| GET | `/gnss/control-points/:id/validation` | optional | Validation-only view |
| GET | `/gnss/control-points/:id/elevation-residual` | optional | DEM/DSM comparison |
| POST | `/gnss/review` | `change-detection:review` | Accept/reject one control point |
| GET | `/gnss/parcels/:ulpin/control-points` | optional | Points associated with a parcel |
| GET | `/gnss/parcels/:ulpin/boundary-verification` | optional | Stored-point boundary verification |
| POST | `/gnss/boundary-analysis` | `ai:run` | On-demand boundary verification + stored result |
| POST | `/gnss/transform` | `ai:run` | Thin pyproj CRS-transform passthrough |
| POST | `/gnss/proposals` | `parcel:boundary-review` | Create a geometry review proposal |
| GET | `/gnss/proposals`, `/gnss/proposals/:id` | optional | List / read proposals |
| PATCH | `/gnss/proposals/:id/review` | `change-detection:review` | Accept (writes `parcels.geometry`) or reject |

Every response includes the GNSS/CORS disclaimer and `isOfficial: false`
where a record is returned.

## 15. Security / RBAC

No new roles or permissions were introduced — Phase 6 reuses `ai:run`
(upload/validate/import/transform/boundary-analysis),
`change-detection:review` (control-point and geometry-proposal review, same
permission Phases 3–5 already use for AI-result review), and
`parcel:boundary-review` (creating a geometry proposal) from the existing
RBAC matrix (`backend/src/config/rbac.js` — held by `Survey Officer` and
`Administrator`). Unauthenticated/under-permissioned requests receive the
existing `401`/`403` envelope; a citizen role sees no GNSS nav entry and gets
`403` if it calls a gated endpoint directly.

## 16. Testing

- **Python** (`ai-service/tests/test_gnss_api.py`, `test_gnss_crs.py`) —
  CRS parsing, geographic/projected detection, WGS84↔UTM round-trip,
  unknown/missing-CRS "never guessed" behaviour, and the FastAPI
  `/gnss/config`/`/gnss/transform` endpoints. Part of the full
  `ai-service` suite (109 tests, all passing).
- **Backend** (`backend/tests/gnss.test.js`, 25 tests against synthetic
  fixtures in `backend/tests/fixtures/gnss/`) — upload/validate/import,
  invalid coordinates, duplicate IDs/coordinates, spatial/height outliers,
  CRS unknown/mismatch/transform, accuracy reported/missing/impossible,
  timestamp missing/invalid, parcel MATCHED/MULTI_PARCEL/REVIEW_REQUIRED,
  boundary verification (within/outside tolerance) without mutating parcel
  geometry, the geometry-proposal accept/reject permission boundary and
  its parcel-geometry write path, elevation-residual availability +
  vertical-datum matching, and a compatibility check against existing
  parcel/building endpoints. Part of the full backend suite (77 tests, all
  passing).
- **Playwright** (`tests/e2e/landstack.spec.js`, "Phase 6" describe block)
  — upload → validate → import → select a point in the one Cesium viewer →
  sidebar sections; missing-CRS/duplicate-ID detection in the upload
  preview; boundary-verification run + parcel unaffected; and the
  GNSS/CORS layer OFF-by-default / toggle / single-viewer check, mirroring
  the Phase 5 pattern.
- All fixtures are explicitly synthetic (`TEST_FIXTURE`/`DEMO` sources,
  coordinates near the existing Sholinganallur demo centre) — never
  presented as real Chennai GNSS/CORS survey data.

## 17. Limitations (explicit)

- No official Chennai GNSS/CORS dataset is fabricated or bundled; every
  control point in this system originates from an uploaded file or a
  synthetic test fixture.
- Demo/uploaded coordinates are not government-authoritative survey data,
  regardless of how confidently a `source` label names a survey channel.
- Accuracy is reported only when the source file supplied a number;
  `accuracyStatus` makes the absence explicit rather than defaulting to a
  number.
- A computed boundary deviation or DEM/DSM residual is not, by itself, a
  survey-accuracy figure, and does not by itself mean either side (the
  control point or the existing geometry/model) is wrong — see §4/§12.
- A missing or unparsable CRS is never guessed; the point's resolved
  coordinates stay `null` and it is excluded from the map/parcel
  association until reviewed.
- A missing vertical datum on either side of an elevation comparison keeps
  `verticalDatumStatus` at `UNKNOWN`, which limits how far the residual can
  be trusted.
- Boundary deviation, however large, never triggers an automatic parcel
  geometry change — only an explicit, authorized `ACCEPT` on a
  `geometryReviewProposals` document does, and that action is fully
  audited.
- No official 3D ULPIN or new authoritative cadastral record is created by
  any part of this phase — `parentULPIN` only ever references an existing
  parcel's own ULPIN.

## 18. Not done in this phase

Phase 6 does not include an in-UI geometry-editing/proposal-generation tool
(drawing a corrected boundary from control points) — creating a proposal's
`proposedGeometry` today happens by an authorized caller supplying it
directly to `POST /api/gnss/proposals`; the frontend surfaces listing and
accept/reject of existing proposals. Building an automatic
boundary-correction algorithm was out of scope, and deliberately so: it would
risk generating a "suggested" geometry that reads as more authoritative than
a handful of control points actually support. Phase 7 is intentionally not
started.
