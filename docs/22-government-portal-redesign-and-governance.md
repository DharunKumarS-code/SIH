# 22 — Government Portal Redesign & Governance Roll-up (Phase 10)

> **Additive & non-destructive.** Phase 10 is a **UI / UX redesign** to a
> government GIS / land-governance portal look, plus one **read-only governance
> roll-up** endpoint and page. No data model changes, no Cesium replacement, no
> Three.js, no dark theme. Phases 1–9 behaviour is unchanged — all backend,
> Python and E2E suites still pass.

---

## 1. Scope

| Area | Change |
| --- | --- |
| Design system | `frontend/tailwind.config.js` + `frontend/src/index.css` flipped to a **light** government palette (tokens below). Component classes (`.panel` `.card` `.btn*` `.input` `.nav-link*` `.kv-*` `.section-title`) rewritten light. |
| Shell | `TopBar.jsx` — government masthead ("Government · Land Governance Portal" / "PROPERTY 3D ULPIN" / "Chennai 3D Cadastre") + global search + area select + notifications + user/role. `SideNav.jsx` — **grouped** navigation. `nav.js` — `NAV_GROUPS`. |
| Pages | ~35 page/component `.jsx` files swept from dark utility classes to light equivalents. No page removed, no `data-testid` or `<h1>` text changed. |
| Cesium | `cesiumGrading.js` toned down to a restrained "official basemap" grade. **One** Chennai-wide viewer, unchanged. |
| Governance | New `GET /api/governance/overview` (read-only) + new `/governance` page. |
| Docs | This file; `09-ui-ux-guidelines.md` updated for the light theme. |

## 2. Government design system

Light palette. `frontend/src/index.css` `:root`:

```
--gov-bg            #f5f7fa   page background
--gov-surface       #ffffff   cards / panels
--gov-border        #e2e8f0   hairline borders
--gov-border-strong #cbd5e1   input borders, dividers
--gov-text          #1f2937   charcoal body text
--gov-text-muted    #64748b   slate metadata
--gov-primary       #1e5fa8   muted government blue
```

`tailwind.config.js` tokens: `primary #1e5fa8` (hover `#1a5495`), `cyan #0f766e`,
`gold #b7791f`, `ok #15803d`, `warn #b45309`, `danger #b91c1c`, `info #1e5fa8`,
`ink #1f2937`. The `navy-*` scale name is kept (to avoid churn) but every stop is
now a light neutral (`#f5f7fa` → `#d5dde8`). Shadows are single soft shadows
(`boxShadow.panel`, `boxShadow.card`) — no glow, no glassmorphism, no surface
gradients.

**Forbidden:** black / dark-navy full-page background, neon blue, purple
gradients, excessive gradients, glowing, glassmorphism, heavy shadows,
gaming / cyberpunk / consumer-SaaS styling, dark theme of any kind.

## 3. Grouped navigation — `frontend/src/lib/nav.js`

`NAV_GROUPS` renders as labelled sections, each item still filtered by
`role` / `perm` before its group is shown:

| Group | Items |
| --- | --- |
| **Land** | Dashboard · Land Parcels · ULPIN Search · Land Records · Registration · Building Permissions · Property Tax · Dispute Management |
| **3D Cadastre** | 3D Map · Buildings · Floors & Units · 3D Property Identifier |
| **Data & AI** | AI Studio · Building Extraction · Floor Plan Segmentation · Elevation / LiDAR · GNSS / CORS |
| **Validation** | Topology Validation |
| **Infrastructure** | Underground Infrastructure |
| **Governance** | Governance · Analytics · Reports · Citizen Services |
| **Admin** | Users & Roles · Settings & System Status |

`export const NAV = NAV_GROUPS.flatMap((g) => g.items)` keeps the old flat
consumers working.

## 4. Governance roll-up

### Endpoint — `GET /api/governance/overview`

`backend/src/controllers/governanceController.js` → `getGovernanceOverview`,
wired in `routes/index.js` as `r.get('/governance/overview', optionalAuth, …)`.

**Read-only.** It performs `count` / `find` against existing collections only —
it creates nothing, promotes nothing, and never claims official connectivity.
Response envelope (`{ ok, data }`):

```jsonc
{
  "generatedAt": "…",
  "isDemo": true,
  "disclaimer": "Governance overview. Read-only roll-up … No live government connectivity; Land Records / Registration / Property Tax integrations are DEMO / MOCK adapters. No authoritative data is created here.",
  "dataSources":  { "chennaiAvailability": "UNAVAILABLE", "registered": N, "sources": [ … Phase-1 investigation list … ], "summary": "…" },
  "holdings":     { "parcels": N, "buildings": N, "units": N, "undergroundInfrastructure": N, "proposed3DIdentifiers": N },
  "dataQuality":  { "topology": { …latest run summary… } | null, "infrastructure": { …latest run summary… } | null },
  "pendingReviews":     { "geometryProposals": N, "geometryProposalsTotal": N, "aiJobs": N, "total": N },
  "governanceRequests": { "total": N, "open": N, "byStatus": { … } },
  "documents":    { "total": N, "note": "Demo document cards only …" },
  "audit":        { "recent": [ …last 12 audit log entries… ] }
}
```

### Page — `/governance` (`frontend/src/pages/Governance.jsx`)

Six summary `Stat` cards then tabbed sections
(`data-testid="governance-tab-<id>"` / `governance-panel-<tab>`):
**Data Sources** (table of the Phase-1 source registry) · **Data Quality**
(latest topology + infrastructure run summaries) · **Pending Reviews** ·
**Governance Requests** · **Documents** · **Audit Trail** (recent entries).
Every section cross-links to the page that owns the underlying workflow; none of
them can mutate state.

### Tests

`backend/tests/governance.test.js` — the roll-up returns a DEMO envelope with
numeric holdings and never sets `authoritative:true` / `official:true`.
`tests/e2e/landstack.spec.js` route-smoke covers `/governance`.

## 5. Detailed 3D Building Explorer (new tab, Three.js)

A focused, single-building visualisation that opens in a **new browser tab** from
a unit record. It is **not** a second Chennai viewer — the Chennai-wide
geographic context stays in the single CesiumJS viewer on `/map`.

### Route & deep link

`frontend/src/App.jsx` registers `/3d-explorer` **outside** `RequireAuth` /
`AppShell` (its own government-style chrome). The page is lazy-loaded, and the
Three.js code is a further `React.lazy` chunk
(`components/explorer/BuildingScene.jsx`), so Three.js never enters the main
bundle or the Cesium route — `vite build` emits it as a separate
`BuildingScene-*.js` chunk.

```
/3d-explorer?area=sholinganallur&ulpin=TN-CHN-123456789&buildingId=B01&floorId=F02&unitId=U201
```

`buildingId` / `floorId` / `unitId` accept either a short segment (`B01`) or an
already-qualified id; the page normalises them to the backend ids
(`TN-CHN-123456789-B01-F02-U201`). Missing `floorId` defaults to the top floor.

### Data — existing backend only

| Panel | Source |
| --- | --- |
| Building massing + floors | `GET /api/buildings/:buildingId` (`building.volume`, `floors[].volume`, `approval`) |
| Units on the active floor | `GET /api/floors/:floorId` (`units[].volume`, `gridCol/gridRow`) |
| Unit detail / governance / geometry status | `GET /api/units/:propertyId` (`hierarchy`, `volume`, `validation`, `governance`) |

No new endpoint, no second data source, nothing fabricated. The RBAC token in
`localStorage` is shared across tabs, so sensitive unit fields stay gated exactly
as in the main app.

### Three.js scene — `components/explorer/BuildingScene.jsx`

Prototype 3D volumes (`{xmin..ymax}` degrees, `{zmin,zmax}` metres) are converted
to a local metre frame centred on the building and drawn as:
a translucent building shell · stacked floor slabs (active floor raised opacity +
navy edge) · apartment boxes on the active floor (grid-laid from `gridCol/gridRow`
when a unit has no own footprint; selected unit in restrained amber). `OrbitControls`
for orbit/zoom; click-picking selects a floor slab or a unit box. Light palette
only (`#f5f7fa` ground, slate massing, one amber accent) — the dark design of the
uploaded `3dmodels.zip` reference is **not** copied. The renderer, geometries and
materials are disposed on unmount.

### Layout

TOP masthead + breadcrumb (`Chennai › Area › ULPIN › Building › Floor › Unit`) +
"Prototype · Not an Official ULPIN" + **Return to 3D map** / **Close explorer**
(the latter only when `window.opener` exists). LEFT floor list + unit grid.
CENTER the Three.js canvas. RIGHT identity / hierarchy / unit or building detail /
3D volume information / geometry status (Phase 9) / provenance & status
(`DEMO` · `PROTOTYPE / AI_DERIVED` · `UNVERIFIED`) / governance (`DEMO / MOCK`).
BOTTOM legend + a "synthetic DEMO geometry" provenance line. Flex/grid only.

### Entry points

`components/layout/PropertySidebar.jsx` (unit footer) — **Open 3D Building
Explorer** (`data-testid="open-3d-explorer"`, `target="_blank"`).
`pages/FloorUnitExplorer.jsx` — a per-building **Open 3D Building Explorer** link.

### Tests

`tests/e2e/explorer3d.spec.js` — drilling to `U201` and clicking the button
opens a new tab whose URL carries the deep link; the explorer renders the scene
canvas, the honest prototype labelling, floor/unit navigation and the volume /
provenance panel with no page errors; closing it leaves exactly one Cesium
viewer alive and unchanged. A second case deep-links straight to `/3d-explorer`
with no prior navigation and asserts the standalone chrome (no portal nav).

## 6. What Phase 10 does **not** do

- No official 3D ULPIN standard is fabricated (Phase 9 wording is retained
  verbatim — "Proposed 3D Property Identifier" / "3D Cadastral Reference ID").
- No government API is fabricated. Land Records / Registration / Property Tax
  remain DEMO / MOCK adapters, labelled as such.
- No official ownership is asserted; rights stay conceptual.
- No authoritative data is overwritten — the roll-up is read-only.
- No test is weakened; no second Cesium viewer is created.
- Three.js is used **only** in the standalone `/3d-explorer` tab, as a lazy
  chunk — it is never imported into the Chennai `/map` CesiumJS viewer, and
  `vite build` keeps it in its own `BuildingScene-*.js` file.
- The explorer adds no endpoint and no data source; it re-reads the existing
  `/api/buildings`, `/api/floors`, `/api/units` responses.
- The combined building/floor/unit identifier is still only a "Proposed 3D
  Property Identifier" / "3D Cadastral Reference ID" — never an official ULPIN.
