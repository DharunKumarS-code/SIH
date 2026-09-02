# 12 — AI / ML Pipeline

> **Every AI output in this prototype is simulated demo output.** It is not a
> validated real-world prediction. Responses carry `mode: "demo"` and a
> disclaimer. The design goal is a **plug-in architecture** so real models drop
> in without frontend/backend changes.

## Gateway

```
Frontend  ──POST /api/ai/:feature──►  Backend aiService.js
                                        │  AI_SERVICE_URL reachable?
                                        ├─ yes → proxy to FastAPI  ai-service/
                                        └─ no  → local mock (same envelope, mode:"demo")
```

`GET /api/ai/status` reports `connected` vs `demo`.

## Features (spec §24)

| Key | Feature | Input | Output |
| --- | --- | --- | --- |
| `building-footprint` | Building Footprint Detection | satellite / drone tile | polygons + confidence, matched to records |
| `change-detection` | Change Detection | two-date imagery | New Construction / Expansion / Demolition / No Significant Change + review flag |
| `floorplan-segmentation` | Floor Plan Segmentation | scanned plan | rooms / units / common areas + areas |
| `height-estimation` | Building Height Estimation | imagery + shadow / DSM | height (m) + floor count |
| `risk-detection` | Property Risk Detection | records + spatial context | risk flags + composite score |

## Building extraction pipeline (spec §25)

```
Satellite / Drone Image → Preprocessing → Building Segmentation → Building Footprint
→ Height Estimation → 3D Building Generation → Floor Estimation → Property Unit Mapping
```

## Change-detection workflow (spec §26)

```
Previous imagery → Current imagery → AI comparison → Detected building change
→ Officer review → Update property record
```

Detected changes surface as map points and as notifications
(`kind: "Construction Change Detected"`), routed to the Survey Officer.

## Adding a real model

1. Implement `ai-service/app/models/base.py:InferenceModel`.
2. Register it for its feature key in `ai-service/app/pipelines/registry.py`
   (`run_feature`).
3. The envelope (`feature`, `mode`, `disclaimer`, payload) is unchanged, so the
   AI Studio page and the backend proxy keep working. Set `mode` to something
   other than `"demo"` once outputs are validated.

## Datasets / models (future)

Open building footprints (Microsoft/Google), Sentinel-2 / drone orthophotos,
DSM/DEM for height, segmentation models (U-Net / Mask R-CNN / SAM-derived),
siamese change-detection networks. None are bundled.
