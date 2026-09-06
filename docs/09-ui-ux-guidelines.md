# 09 — UI / UX Guidelines

> **Phase 10 redesign.** The interface is a **government GIS / land-governance
> portal** — light mode, restrained palette, structured header, grouped
> navigation, thin borders, subtle shadows. It is deliberately *not* a
> dark/gaming/consumer-SaaS UI. There is no dark theme. Cesium remains the only
> 3D engine (no Three.js).

## Layout (spec §35)

```
┌── TopBar: Government · Land Governance Portal │ PROPERTY 3D ULPIN · Chennai 3D Cadastre │ global search · area · notifications · user/role ──┐
│ SideNav │                                        Routed content                                                                            │
│ grouped │   ┌── 3D Map route ──────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  nav:   │   │  LayerManager / area nav (left)     ONE Chennai-wide CesiumJS scene        PropertySidebar (right, property + governance)  │   │
│  LAND   │   │  Camera / map controls (top)                                                                                              │   │
│  3D CAD │   │  ExplorerDock (bottom): Building Blocks · Floors · Floor Plan · legend / status                                            │   │
│  DATA&AI│   └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
│  VALID. │                                                                                                                                  │
│  INFRA  │                                                                                                                                  │
│  GOVERN.│                                                                                                                                  │
│  ADMIN  │                                                                                                                                  │
│  +system│                                                                                                                                  │
│  status │                                                                                                                                  │
└─────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Navigation is grouped (`frontend/src/lib/nav.js` → `NAV_GROUPS`): **Land**,
**3D Cadastre**, **Data & AI**, **Validation**, **Infrastructure**,
**Governance**, **Admin**. Groups render with a small uppercase header; items are
filtered by role / permission before a group is shown.

## Colour system (spec §37) — `frontend/tailwind.config.js` + `frontend/src/index.css`

Light government palette. CSS custom properties in `:root` (`index.css`):
`--gov-bg #f5f7fa` · `--gov-surface #ffffff` · `--gov-border #e2e8f0` ·
`--gov-border-strong #cbd5e1` · `--gov-text #1f2937` · `--gov-text-muted #64748b`
· `--gov-primary #1e5fa8`.

| Token | Hex | Use |
| --- | --- | --- |
| `navy-950 … navy-600` | `#f5f7fa`→`#d5dde8` | page background / light surfaces / borders (kept as a name for minimal churn; the scale is now light) |
| `primary` | `#1e5fa8` (`hover #1a5495`) | primary actions, active nav, links |
| `cyan` | `#0f766e` | accent, monospace ids |
| `gold` | `#b7791f` | **3D selection highlight**, DEMO tags (rendered as `amber-700` in UI) |
| `ok` `#15803d` · `warn` `#b45309` · `danger` `#b91c1c` · `info` `#1e5fa8` | status only |
| `ink` | `#1f2937` | charcoal body text |

`boxShadow.panel` / `boxShadow.card` are single soft shadows — no glow, no
glassmorphism, no gradients on surfaces.

Status badges: Verified/Registered/Approved/Paid → green · Pending/Due → amber ·
Rejected/Disputed/Open → red · Under Review → blue · **DEMO / RESEARCH / AI
OUTPUT / REVIEW REQUIRED** → neutral amber. Only records that are genuinely
authoritative may carry **OFFICIAL / AUTHORIZED / VERIFIED**; demo data must not
be visually indistinguishable from official data.

The 3D scene uses a restrained "official basemap" colour grade
(`frontend/src/lib/cesiumGrading.js`): natural daylight, mild contrast, subtle
vignette — never neon, never cinematic.

## Spacing & overlap (spec §38)

- Consistent spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 px.
- **No element may overlap another.** Layout uses CSS Grid / Flexbox and
  responsive containers; absolute positioning is limited to the map floating
  panels, which scroll internally and never collide.
- Cards: consistent padding, clear header, aligned metadata; title / badge /
  value / action never collide. Long identifiers (ULPIN, `3DPR:…`, survey /
  volume ids) wrap or truncate with `break-all` / ellipsis and a copy affordance.
- Tables: aligned, compact, `overflow-x: auto` wrapper, `break-word` cells.
- Forms: Label → Input → Helper text → Validation message, consistent gaps.

## Accessibility (spec §39)

- Semantic landmarks (`header`, `nav`, `main`, `aside`), `aria-label` on icon
  buttons, `role`/`tabIndex` on the SVG floor-plan cells with Enter/Space.
- Visible focus rings (`focus-visible:ring-primary`).
- Contrast: charcoal text on `#f5f7fa` / white meets AA for body text.
- Keyboard: all nav and controls are real `<button>` / `<a>` elements.

## Responsive (spec §38)

Verified at 1920×1080, 1600×900, 1440×900, 1366×768, 1280×720, 1024, tablet.

- `< lg`: SideNav collapses to an off-canvas drawer (hamburger in TopBar);
  cards stack; tables scroll; map controls wrap.
- 3D map panels are absolutely positioned and scroll internally; the page body
  never scrolls horizontally (verified by e2e at 390 px width).
- Dashboard / tables reflow to 1–2 columns.

## Typography (spec §40)

Clean professional sans-serif. 12–13 px metadata · 14–16 px content ·
16–20 px section headings · 22–28 px page headings. Not everything is large.

## Animation

Subtle only: 150–250 ms hover, smooth panel transitions, Cesium camera
transitions, subtle selection highlight. No bouncing / glowing / spinning UI /
large page transitions.

## Anti-patterns avoided (spec §59)

No lorem ipsum, no non-functional buttons, no infinite loaders (every fetch has
loading + error + empty states), no childish gradients, minimal animation.
