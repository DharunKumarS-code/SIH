# LAND STACK — Integrated GIS-Based Digital Public Infrastructure for Land Governance with 3D Property Intelligence

> **Prototype.** Land Records / Registration / Property Tax integrations are
> **DEMO / MOCK**. All spatial and record data is **synthetic DEMO DATA** using
> realistic Chennai coordinates (Sholinganallur / Adyar / Anna Nagar) — it
> represents **no real parcel, building, person, tax account, court case or
> government record**.
> Apartment identifiers are **Prototype 3D Property Identifiers**, never official
> ULPINs. No government system is scraped or bypassed; the app makes **no claim
> of live government connectivity**.

## 1. Problem

Land information in India is fragmented across departments — land records,
registration, planning, property tax, disputes, utilities — each with its own
identifier and system. A citizen or officer has no single, spatial, verifiable
view of a property. And the conventional cadastre stops at the **2D parcel**,
even though most urban property is now **apartments** stacked in multi-storey
buildings with no independent spatial identity.

## 2. Solution

A **parcel-centric Land Stack** that integrates fragmented datasets around a
common ULPIN, presented as an interactive **3D GIS**:

```
ULPIN (parcel)  →  Record of Rights · Registration · Encumbrance · Land Use ·
                   Master Plan · Building Permission · Property Tax · Disputes · Utilities
      └── 3D PROPERTY
            └── Building B01 ── Floor F02 ── Unit U201
```

## 3. Innovation

The conventional 2D parcel model is extended into a **3D property hierarchy** in
which **every apartment unit is independently identified, visualised in 3D,
selected, isolated and governed** with its own owner, documents and governance
record:

```
Parent Parcel ULPIN         TN-CHN-123456789
Prototype 3D Property ID     TN-CHN-123456789-B01-F02-U201
                             │                 │   │   └ Unit 201
                             │                 │   └ Floor 02
                             │                 └ Building 01
                             └ parent parcel ULPIN
```

## 4. Architecture

| Tier | Stack | Port |
| --- | --- | --- |
| Frontend | React 19 · Vite · React Router · Tailwind · **CesiumJS** (single geographic 3D viewer) · **Three.js** (lazy — detailed `/3d-explorer` tab only) · Recharts · Lucide · Axios | 5173 |
| Backend | Node · **Express** · Mongoose · JWT · Zod · Helmet · rate-limit | 4000 |
| AI service (optional) | Python · **FastAPI** (plug-in mock inference) | 8000 |
| Database (optional) | **MongoDB Atlas** — falls back to a seeded in-memory demo store | — |

```
Browser (React SPA + Cesium 3D)
   │  /api  (Vite proxy in dev)
Express API  ──►  storage facade  ──►  in-memory seeded demo store  ── OR ──  MongoDB Atlas
   │
   └─ interoperability adapters (LandRecords / Registration / Planning / PropertyTax / Disputes / Utilities — DEMO)
   └─ AI gateway  ──►  FastAPI ai-service   ── OR ──  local mock (mode: "demo")
```

Full detail in [`docs/`](docs/) (`01`–`12`).

## 5. Tech stack

See table above. JavaScript/JSX throughout (no TypeScript). ES modules
everywhere.

## 6. Installation

```bash
git clone <repo> && cd chennai-3d-cadastre-main

# install all three packages
npm run install:all          # = backend + frontend + root

# backend env
cp backend/.env.example backend/.env
#   leave MONGODB_URI blank to run on the seeded demo dataset,
#   or paste an Atlas connection string to use real persistence.

# frontend env (Cesium token already present in frontend/.env for the prototype;
# replace with your own from https://ion.cesium.com/tokens)
```

## 7. Environment variables

| Variable | Package | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | backend | `4000` | API port (spec default 5000; 4000 avoids a common Windows conflict) |
| `CORS_ORIGIN` | backend | `http://localhost:5173` | allowed browser origin(s) |
| `MONGODB_URI` | backend | *(blank)* | blank ⇒ demo store · set ⇒ MongoDB Atlas (seed mirrored on first boot) |
| `JWT_SECRET` | backend | dev fallback | **set a long random value in production** |
| `JWT_EXPIRES_IN` | backend | `8h` | token lifetime |
| `AI_SERVICE_URL` | backend | `http://localhost:8000` | unreachable ⇒ local mock inference |
| `SEED_ON_BOOT` | backend | `true` | mirror demo data into an *empty* Mongo (never overwrites existing collections — run `npm --prefix backend run seed:fresh` after a seed-shape change) |
| `VITE_CESIUM_ION_TOKEN` | frontend | *(in `.env`)* | **required** for terrain + imagery |
| `VITE_API_BASE` | frontend build | `''` | set for non-proxied production deploys |

Secrets live only in `.env` files (git-ignored). `.env.example` documents every key.

## 8. Running the project

```bash
# both dev servers together (from repo root)
npm run dev
#   backend  → http://localhost:4000
#   frontend → http://localhost:5173   ← open this

# or separately
npm run dev:backend
npm run dev:frontend

# optional AI microservice
cd ai-service
python -m venv .venv && . .venv/Scripts/activate      # Windows
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Open **http://localhost:5173** and sign in with a demo account (also listed on
the login page and at `GET /api/system/demo-credentials`):

| Role | Username | Password |
| --- | --- | --- |
| Citizen | `citizen01` | `Citizen@123` |
| Land Officer | `land01` | `Officer@123` |
| Survey Officer | `survey01` | `Officer@123` |
| Planning Officer | `planning01` | `Officer@123` |
| Revenue Officer | `revenue01` | `Officer@123` |
| Administrator | `admin01` | `Admin@123` |

### Demo scenario

Dashboard → **Run the scenario**, or: ULPIN Search → `TN-CHN-123456789` →
**Explore in 3D** → Building **B01** → Floor **F02** → Unit **U201** →
right sidebar shows `TN-CHN-123456789-B01-F02-U201` with owner, documents and
governance → **Isolate Unit** → rotate → **Exit Isolation** → **Reset view**.

## 9. Production build

```bash
npm run build                       # frontend/dist  (static)
cd backend && NODE_ENV=production npm start
```

Host `frontend/dist` on any static host; build with
`VITE_API_BASE=https://your-api` and set the backend `CORS_ORIGIN` to match.

## 10. API documentation

Base `http://localhost:4000/api`. Envelope `{ ok, data, meta? }` /
`{ ok:false, error }`. Full reference: [`docs/02-api-specification.md`](docs/02-api-specification.md).
Highlights:

```
POST /auth/login · GET /auth/me
GET  /parcels · GET /parcels/:ulpin · POST /parcels/:ulpin/verify
GET  /buildings/:id · GET /buildings/:id/floors · GET /floors/:floorId
GET  /units · GET /units/:propertyId · POST /units/:propertyId/verify
GET  /ror|registration|encumbrance|property-tax/:ulpin · GET /building-approval/:buildingId
GET  /interop/:ulpin  (aggregate)  · GET /interop/:ulpin/:department
GET  /gis/localities  (area registry + counts + city-overview camera)
GET  /gis/parcels|buildings|units|common-areas|layer/:layer   (all accept ?locality=)
GET  /dashboard/stats · GET /analytics · GET /search?q= · GET /system/status
POST /ai/:feature · GET /ai/status
GET/POST /services (citizen workflow) · GET /audit · GET /users
GET  /infrastructure · GET /infrastructure/:id · GET /infrastructure/:id/relations|elevation
POST /infrastructure/upload|import|validate|collisions · GET /gis/underground-infrastructure   (Phase 8)
GET  /3d-identifiers · GET /3d-identifiers/:id · GET /3d-identifiers/:id/hierarchy|geometry|versions
POST /3d-identifiers · POST /3d-identifiers/validate · GET /ulpins/:ulpin/3d-identifiers        (Phase 9)
```

## 11. 3D architecture

> **CesiumJS is the single geographic 3D viewer.** Three.js appears **only** in
> the standalone `/3d-explorer` tab (Phase 10) as a lazy-loaded chunk for a
> focused single-building massing view — it is never imported into the Chennai
> map. New tab ≠ new Chennai viewer.

- **One Chennai-wide `Cesium.Viewer` / one scene.** Sholinganallur, Adyar and
  Anna Nagar are localities *inside* it — the area selector (map panel + TopBar)
  flies the **same** camera between them, it never swaps maps or reloads the app.
- **Progressive / demand-based loading.** City zoom shows only lightweight
  locality boundaries; picking an area (or zooming in) demand-loads that
  locality's parcels + building shells once; opening a building lazy-loads its
  units. Detail for other localities is hidden until you go there. Camera-height
  bands (`LOD` in `Cesium3DMap.jsx`) gate city → area → building/unit detail.
- OSM buildings are **not** used — buildings and units are rendered from the API
  as extruded GeoJSON. **Building shell** = one extruded footprint, hidden when
  you drill in. **Every apartment unit is a separate Cesium entity** keyed by its
  Prototype 3D Property ID, with its own footprint cell and
  `baseHeight`/`topHeight`. `scene.requestRenderMode` keeps the scene idle
  between changes.
- Selection: click / explorer / search → highlight (gold), dim siblings, keep
  context; **Isolate** hides everything else; **Reset** returns to the active
  area's overview; **Chennai overview** pulls back to the whole city.
- Restrained cinematic colour grading (`frontend/src/lib/cesiumGrading.js`).
- **Prototype 3D volumes** — every floor and unit has a computed bounded volume
  (`xmin..zmax`, deterministic `volumeId`) plus deterministic geometric
  validation (`VALID / WARNING / ERROR`). Selecting a floor draws its translucent
  volume slab; the unit sidebar shows the bounds, height, estimated volume and
  geometry status. All volume geometry is synthetic **DEMO / PROTOTYPE** — never
  an official ULPIN or cadastral record. See
  [`docs/14-prototype-3d-volume-model.md`](docs/14-prototype-3d-volume-model.md).
- **AI building extraction (Phase 3)** — a Python `ai-service` turns an uploaded
  aerial/satellite/GeoTIFF into candidate building polygons (preprocess →
  segmentation → mask → polygonise → GIS validation → parcel association). Results
  appear as an optional, **default-OFF** "AI-Derived Buildings" layer in the same
  Chennai-wide viewer, with an AI sidebar and an Accept/Reject/Needs-Correction
  review workflow. Output is always `source: "AI_DEMO"` /
  `ulpinStatus: "DEMO_NOT_OFFICIAL"` — a decision-support candidate, never
  official cadastral / survey / ownership data — and it never overwrites the
  demo buildings. If the AI service is down the endpoint returns
  `INFERENCE_UNAVAILABLE` and the rest of the app is unaffected. See
  [`docs/15-ai-building-extraction.md`](docs/15-ai-building-extraction.md).
- **AI floor-plan & apartment/unit segmentation (Phase 4)** — the same
  `ai-service` also turns an uploaded floor-plan image into walls, rooms
  (heuristically typed), doors/openings, a room topology graph, and AI-inferred
  **apartment/unit boundaries** (never "every room is a unit"). A floor plan has
  no coordinates of its own; supplying an existing `buildingId`/`floorId` fits
  it onto that building's footprint and reuses the **Phase-2** volume model for
  a 3D unit box — otherwise geometry stays in a local floor-plan coordinate
  system. Results appear as an optional, **default-OFF** "AI Floor Plans /
  Property Units" layer in the same Chennai-wide viewer, with an AI sidebar and
  the same Accept/Reject/Needs-Correction review workflow. Output is always
  `source: "AI_DEMO"` / `dataClassification: "DEMO_RESEARCH_DATA"` (dataset:
  **CubiCasa5K**) / `ulpinStatus: "DEMO_NOT_OFFICIAL"` — never official
  cadastral / survey / ownership data — and it never touches the demo
  `floors`/`propertyUnits`. If the AI service is down the endpoint returns
  `INFERENCE_UNAVAILABLE` and the rest of the app is unaffected. See
  [`docs/16-ai-floor-plan-segmentation.md`](docs/16-ai-floor-plan-segmentation.md).
- **Elevation / LiDAR / DEM / DSM (Phase 5)** — the same `ai-service` also
  turns an uploaded LAS/LAZ point cloud or DEM/DSM GeoTIFF into ground
  classification, a DEM, a DSM, and per-building ground/roof/height estimates
  (robust, outlier-clipped DSM-minus-DEM sampling) with deterministic quality
  validation and a confidence score. A result is **never** applied to a
  building automatically — a reviewer must explicitly **Accept** it
  (`change-detection:review`), which reversibly rescales that building's
  `heightM`/`baseElevationM` **and** every one of its floors'/units'
  `baseHeight`/`topHeight` in place (reusing the Phase-2 volume model, no
  second one) and can be reverted at any time. Output is always
  `source: "ELEVATION_DEMO"` / `RESEARCH_DATA` / `TEST_FIXTURE` /
  `USER_SUPPLIED` (`isOfficial: false`) — never official, survey-certified
  elevation data. If the AI service is down the endpoint returns
  `INFERENCE_UNAVAILABLE` and the rest of the app is unaffected. See
  [`docs/17-lidar-dem-dsm-elevation.md`](docs/17-lidar-dem-dsm-elevation.md).
- **GNSS/CORS high-precision spatial control (Phase 6)** — upload CSV/JSON/GeoJSON
  control points, and the backend deterministically validates them (invalid
  coordinates, duplicates, robust MAD-based spatial/height outliers, missing
  timestamp/accuracy), resolves their CRS (WGS84 pass-through, or a
  `pyproj`-backed transform via the `ai-service` for a projected CRS — never
  guessed when the CRS is missing/unknown), associates them with an existing
  parcel (MATCHED/MULTI_PARCEL/OUTSIDE_PARCEL/REVIEW_REQUIRED, referencing
  that parcel's own ULPIN — never a new one), and verifies them against the
  parcel's existing boundary (observed deviation vs. a configured tolerance).
  A suggested boundary correction is only ever applied via an explicit,
  reviewer-**Accept**ed `geometryReviewProposals` document
  (`change-detection:review`/`parcel:boundary-review`) — it is never
  automatic. Reported accuracy is shown only when the uploaded dataset
  supplied it; a computed boundary/DEM-DSM residual is always kept distinct
  from reported accuracy and from the validation tolerance used to judge it.
  Control points appear as an optional, **default-OFF** "GNSS / CORS Control"
  layer in the same Chennai-wide viewer. Output is always `isOfficial: false`
  / `isDemo: true` — never official cadastral control points or
  government-authoritative survey data. See
  [`docs/18-gnss-cors-spatial-control.md`](docs/18-gnss-cors-spatial-control.md).
- **Intelligent 2D/3D topology validation (Phase 7)** — a deterministic
  RULE_ENGINE checks geometry and hierarchy relationships across
  Parcel → Building → Floor → Unit → 3D Volume: self-intersection, invalid
  polygons, overlaps, gaps, empty/degenerate geometry, invalid Z/height/
  volume, incorrect floor stacking, unexpected 3D-volume intersection,
  duplicate entities, disconnection, and parent-child containment. Exact
  planar polygon geometry (validity/self-intersection/overlap) is delegated
  to `shapely` in the `ai-service`; every other check — tolerances,
  severity, hierarchy, 3D volume math, spatial-index prefiltering (bbox
  sweep, never a naive O(n²) full-geometry scan) — is deterministic
  JavaScript reusing Phase 2's own AABB math and Phase 6's ring helpers. A
  finding **never** modifies stored geometry; `suggestedFix` is guidance for
  a separate, explicit review action. Results appear on `/topology`, with a
  **Focus** action that reuses the existing selection/flyTo wiring in the
  same Chennai-wide Cesium viewer — no new layer or viewer is added. No ML
  model is used or implied. See
  [`docs/19-intelligent-topology-validation.md`](docs/19-intelligent-topology-validation.md).
- **Underground 3D infrastructure mapping (Phase 8)** — an optional,
  **default-OFF** "Underground Infrastructure" layer in the **same** Chennai-wide
  viewer renders water / sewer / stormwater / electrical / telecom / gas
  pipelines, tunnels, metro, utility ducts, manholes and chambers at **true
  Z/depth** — linear assets as depth-placed polylines, manholes as cylinders,
  chambers as bounded 3D volumes. Every object carries explicit provenance
  (`OFFICIAL` / `AUTHORIZED` / `REAL_SURVEY` / `UPLOADED_SURVEY` / `DEMO` /
  `RESEARCH` / `UNVERIFIED` / `UNAVAILABLE`) that is **never auto-promoted**;
  depth/elevation is stored only when the source supplies it (a real record
  with no Z keeps `null` and `verticalStatus: UNKNOWN` — never invented);
  `verticalDatum` is never assumed; a missing CRS stays `UNKNOWN` (a projected
  CRS is transformed via the Phase-6 `pyproj` client, never guessed). A 2D
  crossing is **not** automatically a 3D collision — the engine reports the
  measured vertical separation and only flags `INF_3D_COLLISION` when the
  vertical bands actually overlap. Spatial relationship, `ownerAuthority` and
  `legalOwnership` are separate concepts — **spatial intersection never
  establishes ownership** (`legalOwnership: NOT_PROVIDED` unless authoritative).
  Validation reuses and extends the Phase-7 result model; no new Python is
  added. All shipped data is synthetic **DEMO** — no real Chennai government
  utility infrastructure. New page `/underground`; ingests GeoJSON / CSV / JSON.
  See [`docs/20-underground-infrastructure.md`](docs/20-underground-infrastructure.md).
- **Proposed 3D Property Identifier (Phase 9)** — a **RESEARCH / PROTOTYPE**
  machine-readable reference (`3DPR:<parcelKey>:B01:F02:U201:V0201:v2`) that
  links a parcel's **Official ULPIN** with Building → Floor → Unit → 3D Volume →
  Geometry Version. It is deterministic (a documented 7-token canonical form,
  `:` reserved, parsed backend-side), it reuses the Phase-2 volume model and
  Phase-5/6/7/8 references, and it carries **geometry version history**
  (`v1 → v2` supersession chains, immutable finalized versions, one `ACTIVE` per
  unit, full audit trail). It is **NOT** an Official ULPIN and **NOT** a
  government-approved 3D ULPIN standard — every record is `status: PROPOSED` /
  `isOfficial: false`, the Official ULPIN keeps its own provenance and is never
  overwritten, a missing Official ULPIN shows **"NOT AVAILABLE"** (never
  fabricated), and rights / ownership / restrictions / encumbrances are
  conceptual placeholders (`NOT_ESTABLISHED` / `NOT_PROVIDED`) — spatial
  intersection never implies ownership. New page `/identifier`; **no new Cesium
  viewer** — focus reuses the existing unit selection. See
  [`docs/21-proposed-3d-property-identifier.md`](docs/21-proposed-3d-property-identifier.md).
- **Government-portal redesign + Governance roll-up + Detailed 3D Building
  Explorer (Phase 10)** — the whole UI moved to a light government land-portal
  design system (white/off-white surfaces, muted navy/teal, restrained
  amber/red for status only; no dark theme). A new read-only `/governance` page
  rolls up data sources, data quality, pending reviews, service requests,
  documents and the audit trail from existing collections
  (`GET /api/governance/overview`) — it creates nothing and never claims live
  government connectivity. A new **Detailed 3D Building Explorer** opens in a
  **new browser tab** from a unit record
  (`/3d-explorer?area=…&ulpin=…&buildingId=B01&floorId=F02&unitId=U201`): a
  focused **Three.js** massing view of one building (stacked floor slabs +
  apartments on the active floor), fed only by the existing
  `/api/buildings` · `/api/floors` · `/api/units` responses. **Three.js is
  loaded only in that lazy chunk — it is never added to the Chennai CesiumJS
  viewer**, which stays the single geographic 3D viewer. The combined identifier
  is still labelled "Proposed 3D Property Identifier / Not an Official ULPIN".
  See [`docs/22-government-portal-redesign-and-governance.md`](docs/22-government-portal-redesign-and-governance.md).

Detail: [`docs/05-3d-property-model.md`](docs/05-3d-property-model.md).

## 12. Database schema

Collections: `users`, `parcels`, `ulpins`, `owners`, `buildings`, `floors`,
`propertyUnits`, `commonAreas`, `registrations`, `encumbrances`,
`buildingApprovals`, `propertyTax`, `landUse`, `masterPlans`, `utilities`,
`environment`, `boundaries`, `roads`, `disputes`, `documents`,
`serviceRequests`, `notifications`, `auditLogs`, (Phase 3, additive)
`aiBuildings` · `aiJobs` — AI-extracted candidate buildings + inference jobs,
kept entirely separate from the demo `buildings` — and (Phase 4, additive)
`aiFloorPlans` · `aiRooms` · `aiFloorUnits` — AI floor-plan segmentation output,
kept entirely separate from the demo `floors`/`propertyUnits` — and
(Phase 5, additive) `elevationDatasets` · `buildingHeights` — validated
elevation-dataset metadata + per-building height/quality/confidence results
(raw LAS/LAZ/GeoTIFF bytes are never stored); `aiJobs` is reused with
`kind: "elevation"` — and (Phase 6, additive) `gnssControlPoints` ·
`boundaryVerification` · `geometryReviewProposals` — GNSS/CORS control
points, stored boundary-verification results, and reviewable parcel-geometry
correction proposals, all kept separate from `parcels` until an authorized
reviewer explicitly accepts a proposal — and (Phase 7, additive)
`topologyValidationResults` — one document per validation run (findings +
summary), never touching `parcels`/`buildings`/`floors`/`propertyUnits` — and
(Phase 8, additive) `undergroundInfrastructure` · `infrastructureValidationResults`
· `infrastructureJobs` — underground utility / tunnel / metro / duct / manhole /
chamber geometry with a true Z depth model + explicit provenance, deterministic
validation runs, and upload jobs, all kept entirely separate from
`parcels`/`buildings`/`floors`/`propertyUnits` — and (Phase 9, additive)
`proposed3DPropertyIdentifiers` · `geometryVersions` — a research/prototype
cross-hierarchy reference (`status: PROPOSED`, never an Official ULPIN) plus
immutable geometry version history, holding only pointers into the existing
collections.
Canonical shapes: [`docs/03-data-schema.md`](docs/03-data-schema.md),
[`docs/15-ai-building-extraction.md`](docs/15-ai-building-extraction.md),
[`docs/16-ai-floor-plan-segmentation.md`](docs/16-ai-floor-plan-segmentation.md),
[`docs/17-lidar-dem-dsm-elevation.md`](docs/17-lidar-dem-dsm-elevation.md),
[`docs/18-gnss-cors-spatial-control.md`](docs/18-gnss-cors-spatial-control.md),
[`docs/19-intelligent-topology-validation.md`](docs/19-intelligent-topology-validation.md)
and `backend/src/data/seed.js`.

### Land-data provenance (real ULPIN vs demo)

Every parcel carries an explicit **OFFICIAL / DEMO / UNVERIFIED / UNAVAILABLE**
label. A provider chain (`backend/src/services/landData/`) tries a
`GovernmentDataProvider` (real, authoritative — plugged in via `GOV_LAND_API_URL`)
before a `DemoDataProvider` (synthetic). Phase 1's investigation found **no
publicly/legally accessible official ULPIN parcel source for Chennai** (all require
Aadhaar OTP / CAPTCHA / registered login), so **every parcel today is DEMO** and is
labelled as such in the parcel sidebar, global search, and Settings → *Land Data
Sources & Provenance*. Full write-up:
[`docs/13-official-ulpin-data-investigation.md`](docs/13-official-ulpin-data-investigation.md).

## 13. Testing

```bash
npm run test:backend      # Node test runner + fetch — API / auth / RBAC / hierarchy / interop / GIS / AI
npm run test:ai           # pytest — AI pipeline: preprocessing / segmentation / polygonise / validate / georef
npm run test:e2e          # Playwright — full demo scenario, routes, RBAC, responsive, honesty, AI extraction, 3D Building Explorer
npm test                  # all three
```

The e2e suite starts the backend and frontend automatically (Playwright
`webServer`). First run: `npx playwright install chromium`. `tests/e2e/explorer3d.spec.js`
covers the Phase 10 new-tab Three.js explorer (deep link, scene render, floor/unit
navigation, and that closing it leaves exactly one Cesium viewer intact).

Backend tests connect to the Atlas cluster in `backend/.env` when set; if the
cluster is unreachable the store falls back to the seeded in-memory dataset and
the suite still passes.

## 14. Project structure

```
frontend/     React SPA (components/ pages/ context/ lib/ · Cesium 3D map · components/explorer/ Three.js building scene)
backend/      Express API (controllers/ routes/ services/ middleware/ store/ data/ tests/)
ai-service/   FastAPI mock inference gateway (app/ pipelines/ models/)
docs/         01–22 technical documentation
tests/e2e/    Playwright end-to-end suite
```

## 15. What is real vs demo

| Category | Status |
| --- | --- |
| Map base imagery & terrain | **Real** (Cesium ion / Bing / Cesium World Terrain) |
| Parcels, buildings, floors, units, owners, governance records | **DEMO DATA** — synthetic, realistic Chennai coordinates |
| ULPIN `TN-CHN-123456789` | prototype parcel identifier |
| `…-B01-F02-U201` | **Prototype 3D Property Identifier** — not an official ULPIN |
| Land Records / Registration / Planning / Property Tax / Dispute / Utility APIs | **DEMO / MOCK INTEGRATION** adapters |
| AI features | **Simulated** (`mode: "demo"`) — plug-in architecture for real models |
| `/3d-explorer` Three.js building view | **PROTOTYPE** massing of the Phase-2 synthetic volume model — not a surveyed cadastral volume; opens in a new tab, reuses `/api/buildings`·`/api/floors`·`/api/units` |
| MongoDB | optional; demo store used when `MONGODB_URI` is unset |

## 16. License / usage

Prototype for demonstration (SIH-level). Not for production or legal use.
