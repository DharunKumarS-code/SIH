# 10 — Deployment

## Local

```bash
# 1. Backend
cd backend
cp .env.example .env          # optionally set MONGODB_URI
npm install
npm run dev                   # http://localhost:4000

# 2. Frontend  (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api → :4000)

# 3. AI service (optional)
cd ai-service
python -m venv .venv && . .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# — or, from the repo root —
npm run install:all
npm run dev                   # runs backend + frontend together
```

## Production build

```bash
cd frontend && npm run build          # dist/  (static)
cd backend  && NODE_ENV=production npm start
```

Serve `frontend/dist` from any static host / CDN and point it at the backend by
setting `VITE_API_BASE=https://api.example.org` at build time (otherwise it uses
same-origin `/api`). Configure `CORS_ORIGIN` on the backend accordingly.

## Environment

| Variable | Where | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | backend | `4000` | API port |
| `CORS_ORIGIN` | backend | `http://localhost:5173` | comma-separated |
| `MONGODB_URI` | backend | *(blank)* | blank ⇒ seeded demo store; set ⇒ MongoDB Atlas |
| `JWT_SECRET` | backend | dev fallback | set a long random value in prod |
| `JWT_EXPIRES_IN` | backend | `8h` | |
| `AI_SERVICE_URL` | backend | `http://localhost:8000` | unreachable ⇒ local mock inference |
| `SEED_ON_BOOT` | backend | `true` | mirror demo data into an empty Mongo |
| `VITE_CESIUM_ION_TOKEN` | frontend | — | required for terrain + imagery |
| `VITE_API_BASE` | frontend build | `''` | override for non-proxied deploys |
| `VITE_3D_ASSETS_BASE_URL` | frontend build | `''` | override for the Coimbatore ODM/Scaniverse assets — see below |

## Coimbatore 3D assets (Cloudflare R2)

The Coimbatore 3D Property Explorer (`CoimbatorePropertyScene.jsx`) loads a real
ODM photogrammetry reconstruction (exterior) and a Scaniverse scan (interior)
from `frontend/public/models/coimbatore-demo/` — OBJ + MTL + 21 textures for
the exterior, plus one OBJ + MTL + texture for the interior, ~127 MB total.
This is the only large binary asset set in the repo, and it's excluded from
the app bundle in production: it's served from Cloudflare R2 instead, so the
Vercel deployment stays small and fast to build.

**`VITE_3D_ASSETS_BASE_URL`**

- **Local (`.env` unset or blank):** the loader falls back to the assets
  already present under `frontend/public/models/coimbatore-demo/` — no R2
  account or network access is needed to run the app locally.
- **Production:** set to the R2 bucket's custom-domain URL (no trailing
  slash), e.g. `VITE_3D_ASSETS_BASE_URL=https://assets.example.org`. The
  loader then fetches everything from
  `${VITE_3D_ASSETS_BASE_URL}/coimbatore-demo/...` instead of the local path.
  The actual production value is set in the deploy environment (Vercel
  project settings), never committed to source.

**Expected R2 folder structure** (uploaded at the bucket root, mirroring the
existing local layout under `coimbatore-demo/` exactly — filenames and
relative paths are unchanged, so the `.mtl` files keep referencing bare
texture filenames with no edits needed):

```
coimbatore-demo/
├── odm_textured_model_geo.obj
├── odm_textured_model_geo.mtl
├── odm_textured_model_geo_material0000_map_Kd.png
├── odm_textured_model_geo_material0001_map_Kd.png
├── ...                                              (21 textures total)
├── odm_textured_model_geo_material0020_map_Kd.png
└── interior/
    ├── Scaniverse_2026_09_14_180438.obj
    ├── Scaniverse_2026_09_14_180438.mtl
    └── Scaniverse_2026_09_14_180438.jpg
```

**Required R2 CORS policy** — browser `GET` only, scoped to the two origins
that actually need it (dev + the eventual Vercel production origin); no
write/delete methods are needed since the frontend only ever reads these
assets:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://<your-production-domain>.vercel.app"
    ],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `<your-production-domain>.vercel.app` with the real Vercel origin (or
custom domain) once it's known — this is applied on the R2 bucket, not in
source code, and updated independently of the app.

## Containerisation (sketch)

- `backend/`: `node:20-alpine`, `npm ci --omit=dev`, `CMD ["node","src/server.js"]`.
- `frontend/`: multi-stage — build with Node, serve `dist/` with nginx.
- `ai-service/`: `python:3.11-slim`, `pip install -r requirements.txt`,
  `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- MongoDB: Atlas, or `mongo:7` for local compose.

Health checks: `GET /health` (backend), `GET /` (frontend), `GET /health` (AI).
