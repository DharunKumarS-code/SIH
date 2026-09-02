# Chennai 3D Cadastre / 3D ULPIN Platform

An interactive 3D digital-twin prototype for property / cadastre visualisation over
Chennai, built with **React + Vite + CesiumJS**. It renders the city in 3D
(satellite imagery, world terrain, OpenStreetMap 3D buildings), lets you pick a
building and inspect a **Unified Property Record**, focus / orbit the building in
360°, search demo parcels, toggle map layers and view a demo cadastre dashboard.

> **Prototype — SIH26011.** All property, ULPIN, survey, tax and registration data
> shown in the property panel, search, parcels layer and dashboard is
> **DEMO / synthetic data**. It is deterministically generated from OpenStreetMap
> building ids and does **not** represent official government records.

## Setup

```bash
npm install
cp .env.example .env      # then edit .env
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_CESIUM_ION_TOKEN` | yes | Cesium ion access token for world terrain, base imagery and the OSM 3D Buildings tileset. Get one free at <https://ion.cesium.com/tokens>. |

`.env` is git-ignored. If the token is missing the app renders an inline error
state with a **Retry** button instead of a blank screen.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server on <http://localhost:5180> (fixed port). |
| `npm run build` | Production build to `dist/`. |
| `npm run preview` | Serve the production build on <http://localhost:4180>. |
| `npm run lint` | ESLint. |
| `npm test` | Run the Playwright browser test suite (starts the dev server if needed). |
| `npm run test:headed` | Same, with a visible browser. |
| `npm run test:report` | Open the last HTML test report. |

First test run only: `npx playwright install chromium`.

## 3D architecture

* **One** `Cesium.Viewer` is created in a single `useEffect` in `src/App.jsx` and
  destroyed on unmount. It is re-created only when the **Retry** button bumps an
  init nonce.
* **One** OSM 3D Buildings tileset (`Cesium.createOsmBuildingsAsync()`) is added to
  `scene.primitives` once. Layer toggles only flip `tileset.show` /
  `viewer.terrainProvider` / `imageryLayer.show` — nothing is re-created on camera
  moves, selection, focus or 360°. Density is tuned via
  `maximumScreenSpaceError = 12`, `dynamicScreenSpaceError` and
  `preloadWhenHidden` (no extreme values).
* **Camera:** initial view flies to Chennai (`80.2707, 13.0827`, longitude first)
  at ~2.2 km with a −32° pitch for an angled 3D perspective. Cesium's native
  `screenSpaceCameraController` is left enabled (real wheel-zoom, drag-rotate,
  tilt); it is disabled **only** during a 360° orbit and restored on exit.
* **Picking:** left-click runs `scene.pick`; if the hit is a
  `Cesium3DTileFeature` a validated world-space target is computed from
  `scene.pickPosition` (with an ellipsoid fallback) and stored in a ref. Every
  value passed to a camera function is checked to be a finite, non-zero
  `Cartesian3`.
* **Focus Building:** `camera.flyToBoundingSphere` around the validated target.
* **360° orbit:** exactly one `scene.preRender` listener (kept in a ref). Each
  frame it advances a heading accumulator and calls
  `camera.lookAt(center, HeadingPitchRange)`. Pause removes the listener and keeps
  the saved state; Exit removes the listener, calls
  `camera.lookAtTransform(Matrix4.IDENTITY)` and restores the pre-orbit camera.
  Any exception in the tick triggers a safe stop instead of breaking the render
  loop (this is the fix for the previous white-screen bug).

## ULPIN vs Unit PIN (demo model)

```
ULPIN (land parcel)  ─►  Parcel  ─►  Building  ─►  Floor  ─►  Unit (Unit PIN)
DEMO-ULPIN-000123        PCL-CHN-0123  BLD-CHN-045   Floor 2   UNIT-BLD045-F02-0202
```

* **ULPIN** identifies the **land parcel** — here a clearly-labelled
  `DEMO-ULPIN-######` placeholder, **not** an official ULPIN.
* **Unit PIN** identifies an individual apartment / unit within a building and is a
  separate identifier from the parcel ULPIN.
* Demo records also carry a synthetic **DEMO Verification Score** and a demo
  conflict analysis (e.g. land-record vs tax-record area mismatch).

## Project layout

```
src/
  App.jsx                     Viewer lifecycle, camera, picking, 360°, layers
  components/
    BuildingInfoPanel.jsx     Unified Property Record panel (hierarchy, docs, verification)
    Building360Controls.jsx   Pause / Resume / Exit 360°
    DashboardPanel.jsx        Demo KPI cards + land-use chart
    SearchBox.jsx             Demo parcel search
    ErrorBoundary.jsx         App-level crash guard
  utils/
    cesiumBuildingUtils.js    Extract OSM building attributes from a tile feature
    demoPropertyData.js       Deterministic DEMO records, parcels, search index, stats
tests/
  cadastre.spec.js            Playwright suite
  helpers.js                  Fixtures + Cesium readiness helpers
```
