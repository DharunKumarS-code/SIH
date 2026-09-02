# LAND STACK — Integrated GIS-Based Digital Public Infrastructure for Land Governance with 3D Property Intelligence

> **Prototype.** Land Records / Registration / Property Tax integrations are
> **DEMO / MOCK**. All spatial and record data is **synthetic DEMO DATA** using
> realistic Chennai (OMR / Sholinganallur) coordinates — it represents **no real
> parcel, building, person, tax account, court case or government record**.
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
| Frontend | React 19 · Vite · React Router · Tailwind · **CesiumJS** · Recharts · Lucide · Axios | 5173 |
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
| `SEED_ON_BOOT` | backend | `true` | mirror demo data into an empty Mongo |
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
GET  /gis/parcels|buildings|units|common-areas · GET /gis/layer/:layer
GET  /dashboard/stats · GET /analytics · GET /search?q= · GET /system/status
POST /ai/:feature · GET /ai/status
GET/POST /services (citizen workflow) · GET /audit · GET /users
```

## 11. 3D architecture

- One `Cesium.Viewer`; OSM buildings are **not** used — buildings and units are
  rendered from the API as extruded GeoJSON.
- **Building shell** = one extruded footprint; hidden when you drill in.
- **Every apartment unit is a separate Cesium entity** keyed by its Prototype
  3D Property ID, with its own footprint cell and `baseHeight`/`topHeight`.
- Units are **lazy-loaded per building** and cached; `scene.requestRenderMode`
  keeps the scene idle between changes.
- Selection: click / explorer / search → highlight (gold), dim siblings, keep
  context; **Isolate** hides everything else; **Reset** returns to overview.
- Restrained cinematic colour grading (`frontend/src/lib/cesiumGrading.js`).

Detail: [`docs/05-3d-property-model.md`](docs/05-3d-property-model.md).

## 12. Database schema

Collections: `users`, `parcels`, `ulpins`, `owners`, `buildings`, `floors`,
`propertyUnits`, `commonAreas`, `registrations`, `encumbrances`,
`buildingApprovals`, `propertyTax`, `landUse`, `masterPlans`, `utilities`,
`environment`, `boundaries`, `roads`, `disputes`, `documents`,
`serviceRequests`, `notifications`, `auditLogs`.
Canonical shapes: [`docs/03-data-schema.md`](docs/03-data-schema.md) and
`backend/src/data/seed.js`.

## 13. Testing

```bash
npm run test:backend      # Node test runner + fetch — API / auth / RBAC / hierarchy / interop / GIS
npm run test:e2e          # Playwright — full demo scenario, routes, RBAC, responsive, honesty
npm test                  # both
```

The e2e suite starts the backend and frontend automatically (Playwright
`webServer`). First run: `npx playwright install chromium`.

## 14. Project structure

```
frontend/     React SPA (components/ pages/ context/ lib/ 3d map)
backend/      Express API (controllers/ routes/ services/ middleware/ store/ data/ tests/)
ai-service/   FastAPI mock inference gateway (app/ pipelines/ models/)
docs/         01–12 technical documentation
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
| MongoDB | optional; demo store used when `MONGODB_URI` is unset |

## 16. License / usage

Prototype for demonstration (SIH-level). Not for production or legal use.
