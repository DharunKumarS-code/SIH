# 09 — UI / UX Guidelines

## Layout (spec §35)

```
┌───────────────────────── TopBar: brand · global search · location · notifications · user ─────────────────────────┐
│ SideNav │                                   Routed content                                                        │
│ (main   │   ┌── 3D Map route ─────────────────────────────────────────────────────────────────────────────────┐   │
│  nav +  │   │  LayerManager (left)     CesiumJS 3D scene            PropertySidebar (right, unit detail)       │   │
│  system │   │  Camera strip (top-centre)                                                                       │   │
│  status)│   │  ExplorerDock (bottom): Building Blocks · Floors · Floor Plan                                     │   │
│         │   └─────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Colour system (spec §37) — `frontend/tailwind.config.js`

| Token | Hex | Use |
| --- | --- | --- |
| `navy-950 … navy-600` | `#070c16`→`#26395c` | surfaces / background |
| `primary` | `#2f6feb` | primary actions, active nav |
| `cyan` | `#38c9d6` | accent, monospace ids |
| `gold` | `#f2b807` | **3D selection highlight**, DEMO tags |
| `ok` `#3fbf7f` · `warn` `#f0a726` · `danger` `#e4566e` · `info` `#4784f5` | status |

Status badges: Verified/Registered/Approved/Paid → green · Pending/Due → amber ·
Rejected/Disputed/Open → red · Under Review → blue · DEMO → neutral gold.

The 3D scene uses a restrained cinematic colour grade
(`frontend/src/lib/cesiumGrading.js`): natural daylight, mild contrast, richer
vegetation, controlled highlights, subtle vignette — never neon.

## Accessibility (spec §39)

- Semantic landmarks (`header`, `nav`, `main`, `aside`), `aria-label` on icon
  buttons, `role`/`tabIndex` on the SVG floor-plan cells with Enter/Space.
- Visible focus rings (`focus-visible:ring-primary`).
- Contrast: text on `navy-900` meets AA for body text.
- Keyboard: all nav and controls are real `<button>` / `<a>` elements.

## Responsive (spec §38)

- `< lg`: SideNav collapses to an off-canvas drawer (hamburger in TopBar).
- 3D map panels are absolutely positioned and scroll internally; the page body
  never scrolls horizontally (verified by e2e at 390 px width).
- Dashboard / tables reflow to 1–2 columns.

## Anti-patterns avoided (spec §59)

No lorem ipsum, no non-functional buttons, no infinite loaders (every fetch has
loading + error + empty states), no childish gradients, minimal animation.
