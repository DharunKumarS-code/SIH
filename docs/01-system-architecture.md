# 01 — System Architecture

## Purpose

LAND STACK is a **parcel-centric Land Stack extended into a 3D property
intelligence system**: land parcels, buildings, floors and individual apartment
units can be independently identified, visualised in 3D and governed through one
interoperable record.

## Components

```
                         ┌─────────────────────────────┐
                         │  Browser (React SPA)        │
                         │  - App shell (top/left/     │
                         │    center 3D/right/bottom)  │
                         │  - CesiumJS 3D scene        │
                         │  - Recharts dashboards      │
                         └───────────────┬─────────────┘
                            HTTPS / JSON │  (Vite dev proxy → :4000)
                         ┌───────────────▼─────────────┐
                         │  API server (Node/Express)  │
                         │  - Auth (JWT) + RBAC        │
                         │  - REST: parcels/buildings/ │
                         │    floors/units/governance/ │
                         │    gis/dashboard/…          │
                         │  - Interoperability adapters│
                         │  - Audit trail              │
                         └───┬───────────────┬─────────┘
             storage facade  │               │  HTTP (optional)
                 ┌───────────▼──┐     ┌──────▼─────────────┐
                 │  In-memory   │     │  AI service        │
                 │  seeded demo │ or  │  (FastAPI, Python) │
                 │  store       │     │  building extract /│
                 │  ── OR ──    │     │  change detection  │
                 │  MongoDB     │     │  (mock, plug-in)   │
                 │  Atlas       │     └────────────────────┘
                 └──────────────┘
```

## Runtime tiers

| Tier | Tech | Port | Notes |
| --- | --- | --- | --- |
| Frontend | React 19 + Vite + React Router + Tailwind + CesiumJS + Recharts | 5173 | SPA; dev server proxies `/api` to the backend |
| Backend | Node 20+ / Express 4, Mongoose 8, JWT, Zod, Helmet, rate-limit | 4000 | Stateless; storage facade |
| AI service | Python 3.10+ / FastAPI | 8000 | Optional; backend falls back to a local mock |
| Database | MongoDB Atlas (optional) | — | Seed mirrored on first boot; runs on demo store without it |

## Storage facade (`backend/src/store/`)

`db.collection(name)` returns an identical interface whether backed by the
in-memory seeded dataset or Mongoose models. On boot the backend:

1. builds the deterministic Chennai OMR demo dataset (`data/seed.js`);
2. if `MONGODB_URI` is set and reachable, connects and mirrors any empty
   collection into Atlas, then routes reads/writes to Mongoose;
3. otherwise serves the in-memory dataset and reports
   `"Database connection unavailable – using demo dataset"` via
   `GET /api/system/status`.

## Key domain flow

```
ULPIN (parcel, official)  →  Building B01  →  Floor F02  →  Unit U201
TN-CHN-123456789          →  …-B01        →  …-F02       →  …-B01-F02-U201
                                                            (Prototype 3D Property Identifier)
```

Each apartment unit is a **separate Cesium entity** with its own geometry,
height band, owner, status and governance links — independently selectable,
isolatable and reportable.
