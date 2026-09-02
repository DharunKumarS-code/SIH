# 11 — Scalability

## Backend

- **Stateless API** — horizontally scalable behind a load balancer; JWT auth
  needs no server session.
- **Storage facade** decouples controllers from persistence. Today: in-memory
  demo store or a single MongoDB. Path to scale:
  - Mongo replica set / Atlas auto-scaling; add compound indexes on
    `{ ulpin }`, `{ buildingId, floorNumber }`, `{ propertyId }` (already seeded
    as single-field indexes in `store/mongo.js`).
  - Add a **2dsphere** index on `geometry` for spatial queries when moving
    beyond one demo parcel.
  - Read-heavy endpoints (`/gis/*`, `/dashboard/stats`, `/analytics`) are pure
    functions of the dataset → cache in Redis / CDN with short TTL.
- **Interoperability adapters** call downstream systems concurrently
  (`Promise.all`); add per-adapter circuit breakers + response caching for real
  integrations.

## Frontend / 3D

- **Per-unit entities are lazy-loaded per building** and cached; only the
  in-view building's units exist as geometry.
- `scene.requestRenderMode` keeps the GPU idle when nothing changes.
- To scale to many parcels / a full ward:
  - serve buildings as **3D Tiles** instead of per-request GeoJSON;
  - cluster/aggregate at low zoom, stream unit detail at high zoom;
  - move unit geometry to instanced primitives or a tileset with per-feature
    batch ids (selection still keyed by `propertyId`).

## Data volume (illustrative)

| Entity | Demo | Ward-scale target | Mechanism |
| --- | --- | --- | --- |
| Parcels | 12 | 10k–50k | Mongo + spatial index + tiling |
| Buildings | 5 | 20k+ | 3D Tiles |
| Units | ~1.2k | 500k+ | tileset + lazy detail + server pagination |

## AI service

Stateless FastAPI workers; scale with `uvicorn --workers` / a process manager /
Kubernetes HPA. Heavy models run async with a job queue (out of prototype scope).
