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

## Containerisation (sketch)

- `backend/`: `node:20-alpine`, `npm ci --omit=dev`, `CMD ["node","src/server.js"]`.
- `frontend/`: multi-stage — build with Node, serve `dist/` with nginx.
- `ai-service/`: `python:3.11-slim`, `pip install -r requirements.txt`,
  `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- MongoDB: Atlas, or `mongo:7` for local compose.

Health checks: `GET /health` (backend), `GET /` (frontend), `GET /health` (AI).
