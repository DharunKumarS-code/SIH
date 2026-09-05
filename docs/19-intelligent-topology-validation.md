# 19 — Intelligent 2D/3D Topology Validation Engine (Phase 7)

> **RULE_ENGINE / DETERMINISTIC_VALIDATION output.** Findings are produced by
> explainable, deterministic geometry rules — never AI/ML — against the
> existing prototype/DEMO parcel, building, floor, unit and 3D-volume
> geometry. A finding never modifies stored geometry; any `suggestedFix` is
> guidance for a separate, explicit review action. Underlying provenance
> (DEMO/OFFICIAL/AI_DEMO/ELEVATION_DEMO/etc.) is preserved and never upgraded
> by a validation result.

## 1. Objective

Phase 7 adds a validation engine that checks geometry and spatial
relationships across the complete hierarchy:

```
Parcel -> Building -> Floor -> Unit -> 3D Volume
```

It identifies invalid geometry, self-intersections, gaps, overlaps,
hierarchy violations, invalid elevation, incorrect stacking, invalid/
intersecting 3D volumes, disconnected geometry and duplicate entities/
geometry — and produces deterministic, explainable, extensible findings. It
is additive: no Phase 1–6 route, service, model, collection or UI component
changes behaviour.

## 2. Architecture

- **Frontend** — `frontend/src/pages/TopologyValidation.jsx` (`/topology`,
  nav entry gated on `topology:read`). Reuses the **existing, single**
  Chennai-wide `Cesium3DMap.jsx` viewer and `SelectionContext` entirely —
  Phase 7 adds **no new Cesium layer or entity type**. "Focus" on a finding
  simply calls the same `selectParcel`/`selectBuilding`/`selectFloor`/
  `selectUnit` functions every other page already uses (search, GNSS, AI
  results, …), then navigates to `/map`; the existing selection → flyTo →
  `PropertySidebar` wiring does the rest.
- **Backend** — `backend/src/services/topology/` (orchestration, tolerances,
  severity/status, result schema, spatial-index prefiltering, six rule
  modules) behind `backend/src/controllers/topologyController.js` and the
  additive `/api/topology/*` routes. Reuses Phase 2's
  `geometry3d/volume.js` AABB math (`volumeFromFootprint`, `toMetreBox`,
  `boxContains`, `boxOverlapM2`, `volumeMetrics`, `deriveVolumeId`) and Phase
  6's `gnss/geomUtils.js` ring helpers (`outerRing`, `distanceToRingM`)
  directly, rather than a second, competing geometry implementation.
- **AI/GIS service** — `ai-service/app/topology/` adds exactly one
  capability: `shapely`-backed exact 2D polygon geometry on planar
  (UTM-projected) coordinates — validity, self-intersection, area, pairwise
  overlap/IoU (`GET /topology/config`, `POST /topology/analyze-polygons`,
  `POST /topology/polygon-pairs`), reusing the same FastAPI process as
  Phases 3–6. Every other check (tolerances, hierarchy/containment, 3D
  volume math, spatial-index prefiltering, result assembly) is deterministic
  JavaScript in the Node backend — Python is never on the critical path for
  anything except an explicit polygon check, and its unavailability degrades
  gracefully (`GEOMETRY_ENGINE_UNAVAILABLE`) rather than guessing a result.

No ML model is used or implied anywhere in Phase 7 — see §22.

## 3. Validation hierarchy

The engine loads a scope (a locality, a single parcel, or one
building/floor/unit's owning parcel) from the existing `parcels`/
`buildings`/`floors`/`propertyUnits` collections, runs every rule module
against it, and assembles one **validation run**:

```
Mongo (parcels/buildings/floors/propertyUnits)
  -> geometry engine (shapely, ai-service) for intrinsic polygon validity/area
     and pairwise overlap/IoU on bbox-prefiltered candidates
  -> deterministic rule modules (parcel/building/floor/unit/volume)
  -> findings[] + entity/rule summary (result.js)
  -> topologyValidationResults (Mongo, additive)
```

## 4. Rule-to-module cross-reference

Some spec-listed rule names describe the **same** underlying check as a more
specific one used elsewhere (the spec itself reuses names like
`PARENT_CONTAINMENT` loosely across its Building/Unit/3D/Hierarchy
sections). Rather than emit duplicate findings for one real defect, the
engine emits **one** finding under a canonical id and lists every other spec
name as `aliases` on that finding (`ruleMatches()` in `severity.js` matches
either) — so every literal rule name from the spec is still filterable, with
no duplicate/contradictory findings for the same geometry:

| Canonical rule id | Module | Aliases |
|---|---|---|
| `BUILDING_OUTSIDE_PARCEL` | buildingRules | `BUILDING_NOT_IN_PARCEL` |
| `UNIT_OUTSIDE_BUILDING` | unitRules | `UNIT_NOT_IN_BUILDING` |
| `UNIT_OUTSIDE_FLOOR` | unitRules | `UNIT_NOT_IN_FLOOR`, `PARENT_CONTAINMENT` (unit/floor) |
| `FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE` | floorRules | `PARENT_CONTAINMENT` (floor/building) |
| `UNIT_DISCONNECTED` | volumeRules | `DISCONNECTED_GEOMETRY` (unit) |
| `UNIT_VERTICAL_OVERLAP` | volumeRules | `VOLUME_INTERSECTION` (unit/unit pair) |
| `INCORRECT_STACKING` | floorRules | `Z_CONTINUITY` |

`FLOOR_NOT_IN_BUILDING` has no alias and is genuinely its own check
(§8) — but is structurally guaranteed VALID under the current data model
(see that section).

## 5. Parcel rules (`rules/parcelRules.js`)

Intrinsic (`validateParcelGeometry`): **EMPTY_GEOMETRY** (null geometry),
**SELF_INTERSECTION** (`isSimple === false` from the geometry engine),
**INVALID_POLYGON** (`isValid === false` — includes a too-short/unprojectable
ring, which is never mistaken for self-intersection since `isSimple` reports
`null`, not `false`, in that case), **INVALID_AREA** (declared `areaSqm` vs
geometry-derived area, > `areaMismatchFactor` apart).

Pairwise (`validateParcelOverlaps`, `validateParcelGaps`, candidate pairs
from `spatialIndex.js`): **OVERLAPPING_PARCELS** (planar overlap area beyond
`overlapAreaTolM2`), **DUPLICATE_PARCEL_GEOMETRY** (IoU ≥
`duplicateIouThreshold`), **GAPS** — classified **ERROR** (a tiny,
non-zero gap that reads as a topology defect), **WARNING** (a larger but
still suspiciously close gap), or **no finding at all** (INFO-equivalent:
farther than `gapCandidateRadiusM`, plausibly an intentional road/setback).
Not every gap is an error — see §10 for the exact bands.

## 6. Building rules (`rules/buildingRules.js`)

Intrinsic (`validateBuildingGeometry`): **EMPTY_BUILDING_GEOMETRY**,
**SELF_INTERSECTING_BUILDING**, **INVALID_BUILDING_FOOTPRINT**,
**INVALID_BUILDING_AREA** — buildings carry no independently declared
footprint area in this data model, so this is a plausibility floor on the
geometry-derived area itself (below `minAreaM2`), not a declared-vs-geometry
mismatch the way parcels' `INVALID_AREA` is.

Hierarchy (`validateBuildingParcelContainment`, reusing Phase 2's own
`boxContains`/`toMetreBox` — the identical computation
`geometry3d/validate.js` already performs for its `BUILDING_INSIDE_PARCEL`
check): **BUILDING_OUTSIDE_PARCEL** when the building's footprint coverage
inside its parcel is below 50% (completely or significantly outside);
**BUILDING_CROSSES_PARCEL_BOUNDARY** when it is mostly inside but overshoots
by more than `horizontalToleranceM`.

Pairwise (`validateBuildingOverlaps`): **BUILDING_OVERLAP**,
**DUPLICATE_BUILDING** — same overlap-area/IoU logic as parcels, run across
every building pair in scope (not only buildings sharing a parcel, since a
genuine duplicate/overlap defect could be a cross-parcel data-entry error).

## 7. Floor rules (`rules/floorRules.js`)

Floors have **no independent footprint geometry** in this data model — a
floor's horizontal extent is always its parent building's own footprint
(Phase 2's `floorVolume(f, building)`). So:

- **INVALID_FLOOR_GEOMETRY** — the parent building has no usable geometry to
  derive a volume from at all.
- **INVALID_FLOOR_ELEVATION** — missing `baseHeight`/`topHeight`,
  `baseHeight >= topHeight`, a negative base, or a storey height outside
  Phase 2's own `MIN_STOREY_M`–`MAX_STOREY_M` plausible band.
- **FLOOR_OUTSIDE_BUILDING_VERTICAL_RANGE** (alias `PARENT_CONTAINMENT`) —
  the floor's own z-band exceeds the building's declared
  `baseElevationM`–`baseElevationM+heightM` envelope by more than
  `verticalToleranceM`.
- **INCORRECT_STACKING** (alias `Z_CONTINUITY`) — floor number order
  doesn't match vertical order ("floor 2 sits below floor 1"), or an
  unexplained vertical gap between adjacent floors beyond
  `stackingGapWarnM`/`stackingGapErrorM`.
- **FLOOR_OVERLAP** — adjacent floors' z-bands genuinely overlap (a negative
  gap beyond `Z_TOLERANCE_M`) — a physically distinct condition from
  "incorrect order", computed from the same adjacent-pair comparison.
- **DUPLICATE_FLOOR** — two floor documents share a `floorNumber` within one
  building.
- **FLOOR_NOT_IN_BUILDING** — horizontal containment check, implemented for
  completeness/future-proofing; under the current data model a floor's
  horizontal extent *is* its building's, so this is structurally guaranteed
  VALID unless a floor ever gains an independent `geometry` override.

## 8. Unit rules (`rules/unitRules.js`)

Reuses Phase 2's AABB math directly (the identical computation
`geometry3d/validate.js` already performs for `UNIT_INSIDE_BUILDING`/
`UNIT_NO_OVERLAP`, re-expressed under the Phase 7 finding schema):

- **UNIT_OVERLAP** — units on the same floor of the same building overlap
  horizontally beyond `overlapAreaTolM2`.
- **UNIT_OUTSIDE_BUILDING** (alias `UNIT_NOT_IN_BUILDING`) — horizontal
  footprint containment against the parent building.
- **UNIT_OUTSIDE_FLOOR** (aliases `UNIT_NOT_IN_FLOOR`, `PARENT_CONTAINMENT`)
  — the unit's own `baseHeight`/`topHeight` band exceeds its parent floor's
  declared band by more than `Z_TOLERANCE_M` — a genuinely new check (not
  covered by Phase 2), since a unit's *horizontal* extent already equals the
  floor's by construction.
- **DUPLICATE_UNIT** — two units on the same floor with near-identical
  bounds (IoU ≥ `duplicateIouThreshold` and matching bbox edges).
- **INVALID_UNIT_AREA** — declared `builtUpAreaSqft`/`carpetAreaSqft` vs
  geometry-derived footprint area, beyond `unitAreaMismatchFactor` (see the
  limitations note in §17 on why this tolerance is much looser than
  parcels').

`INVALID_UNIT_VOLUME`/`INVALID_Z_RANGE`/`UNIT_VERTICAL_OVERLAP`/
`UNIT_DISCONNECTED` are intrinsically 3D-volume concepts and are produced by
`volumeRules.js` instead (§9), which runs the same per-volume/pairwise
checks uniformly across buildings, floors **and** units.

## 9. 3D volume rules (`rules/volumeRules.js`)

`assembleVolumes()` builds one Phase 2 volume descriptor per
building/floor/unit (reusing `volumeFromFootprint`/`deriveVolumeId`
directly), each carrying `entityType: 'VOLUME'` for these generic checks
(the domain rule modules above additionally report the *same* underlying
entity under its own `entityType` for their own checks, so a UI filter by
entity finds the right rows either way):

- **INVALID_X_RANGE** / **INVALID_Y_RANGE** / **INVALID_Z_RANGE** —
  `xmin >= xmax`, `ymin >= ymax`, `zmin >= zmax`.
- **INVALID_HEIGHT** — a computed height outside `minHeightM`–`maxHeightM`.
- **ZERO_OR_NEGATIVE_VOLUME** — `footprintM2 × heightM` at or below
  `minVolumeM3` (a degenerate/near-zero-area footprint), checked only once
  the Z-range itself is valid, to avoid double-reporting the same root cause
  as `INVALID_Z_RANGE`.
- **VOLUME_INTERSECTION** (or **UNIT_VERTICAL_OVERLAP** when both sides are
  units) — two volumes whose footprints **and** z-ranges both overlap where
  they are not expected to. Ancestor/descendant pairs (a unit inside its own
  building or floor, a floor inside its own building) are explicitly
  excluded via `isExpectedContainmentPair()` — those are containment
  relationships checked elsewhere, never an "unexpected intersection" (see
  the regression note in §16).
- **DUPLICATE_VOLUME** — two volumes of the *same* entity type with
  near-identical XYZ bounds.
- **UNIT_DISCONNECTED** (alias `DISCONNECTED_GEOMETRY`) — a unit whose
  footprint has **zero** overlap with its own building (not merely outside
  tolerance) and is more than `disconnectionRadiusM` away — a stronger,
  more specific signal than `UNIT_OUTSIDE_BUILDING`, which fires for any
  out-of-tolerance case including one that still touches its building.

`PARENT_CONTAINMENT` (item 9 of the spec's 3D Topology section) is not
separately computed here — it is an alias of `FLOOR_OUTSIDE_BUILDING_
VERTICAL_RANGE` and `UNIT_OUTSIDE_FLOOR` (§4); building-in-parcel
containment has no vertical component to add (parcels carry no z-extent), so
it is fully covered by `BUILDING_OUTSIDE_PARCEL`/`BUILDING_CROSSES_
PARCEL_BOUNDARY` alone.

## 10. Tolerances (`tolerances.js`)

Every threshold is centralized, named, documented and environment-variable
overridable — never a hidden magic number. Horizontal/vertical geometric
tolerances and the storey-height band are **reused directly from Phase 2**
(`GEOMETRY_TOLERANCE_M`, `Z_TOLERANCE_M`, `MIN_STOREY_M`, `MAX_STOREY_M`),
never redefined independently, so an entity that already passes Phase 2's
own containment check is never re-flagged by a differently-tuned Phase 7
rule.

| Key | Default | Meaning |
|---|---|---|
| `horizontalToleranceM` | 0.5 m (Phase 2) | footprint containment slack |
| `verticalToleranceM` | 0.05 m (Phase 2) | z-band containment/order slack |
| `overlapAreaTolM2` | 1.0 m² | ignore footprint-overlap slivers below this |
| `duplicateIouThreshold` | 0.9 | IoU at/above which two footprints read as duplicates |
| `candidateRadiusM` | 60 m | bbox-prefilter padding for general pairwise checks |
| `gapErrorMaxM` / `gapWarnMaxM` | 1.0 m / 2.0 m | parcel-gap ERROR/WARNING bands (must exceed `horizontalToleranceM`, else the ERROR band is empty) |
| `gapCandidateRadiusM` | 10 m | beyond this a gap is not reported (plausible road/setback) |
| `minAreaM2` / `minVolumeM3` | 1.0 | degenerate-geometry floors |
| `minHeightM` / `maxHeightM` | 0.1 m / 500 m | implausible height band |
| `areaMismatchFactor` | 0.25 | parcels: declared-vs-geometry area tolerance |
| `unitAreaMismatchFactor` | 2.5 | units: **much** looser — see §17 |
| `stackingGapWarnM` / `stackingGapErrorM` | 0.5 m / 3.0 m | unexplained vertical gap between floors |
| `disconnectionRadiusM` | 5 m | beyond containment tolerance, "outside" becomes "disconnected" |

Every finding that used a tolerance records both `computedValue` and
`tolerance` — e.g. `computedOverlap: 1.42` / `tolerance: 0.05` — so the
result is explainable without re-deriving the threshold.

## 11. Status and severity (`severity.js`)

`STATUS ∈ {VALID, WARNING, ERROR, REVIEW_REQUIRED}` describes a finding's
disposition; `SEVERITY ∈ {LOW, MEDIUM, HIGH, CRITICAL}` describes its
importance — the two are never conflated (a `status: ERROR, severity: HIGH`
pair is normal). `RULE_DEFAULTS` documents each rule's intended
status/severity; a rule can still override per-instance (a gap's severity
genuinely depends on how small the gap is).

## 12. Result schema (`result.js::makeFinding`)

```json
{
  "validationId": "TFIND-...",
  "ruleId": "UNIT_OVERLAP",
  "aliases": [],
  "status": "WARNING",
  "severity": "MEDIUM",
  "entityType": "UNIT",
  "entityId": "U202",
  "parentEntityId": "TN-CHN-...-B01",
  "relatedEntityId": "U201",
  "message": "Apartment U202 overlaps U201 by 1.4 m².",
  "geometry": null,
  "focusRef": { "kind": "unit", "propertyId": "...", "buildingId": "...", "floorNumber": 1, "ulpin": "..." },
  "relatedFocusRef": { "kind": "unit", "propertyId": "...", "buildingId": "...", "floorNumber": 1, "ulpin": "..." },
  "suggestedFix": "Adjust the unit boundary or review the floor-plan segmentation that produced it.",
  "computedValue": 1.4,
  "tolerance": 0.05,
  "provenance": "Verified",
  "locality": "sholinganallur",
  "createdAt": "2026-..."
}
```

`focusRef`/`relatedFocusRef` are how the frontend re-selects the primary and
related entity in the existing Cesium viewer (§14) without the UI needing to
parse `entityId` string formats. `geometry` is populated only where a
compact reference is genuinely useful and cheap (most findings omit it,
relying on `focusRef` + the live entity fetch instead of duplicating
geometry into every finding). The model is deliberately extensible — new
optional fields can be added without breaking existing consumers.

## 13. Suggested fixes

Every finding carries a `suggestedFix` — guidance only, e.g. *"Repair the
polygon ring and remove crossing segments"* (`SELF_INTERSECTION`),
*"Review the parent-parcel association or the building footprint
digitisation"* (`BUILDING_OUTSIDE_PARCEL`), *"Set zMin lower than zMax using
the verified floor/building elevation"* (`INVALID_Z_RANGE`). **No rule ever
applies its own fix** — geometry correction remains a separate, explicit
action outside Phase 7 (e.g. Phase 6's geometry-review-proposal workflow for
parcel boundaries).

## 14. Performance / spatial indexing (`spatialIndex.js`)

Pairwise checks never compare every geometry against every other naively.
`candidatePairs()` sorts items once by bounding-box `minX`, then sweeps
left-to-right, stopping the inner loop as soon as a later item's `minX`
exceeds the current item's `maxX` — nothing further in sorted order can
possibly overlap it. Only bbox-overlapping (optionally radius-padded)
**candidate** pairs are ever sent to the expensive exact-geometry check
(the ai-service's shapely predicates) or evaluated with Phase 2's AABB math.
This is O(n log n) + O(n + k) rather than a naive O(n²) — verified with a
500-item synthetic batch in `backend/tests/topology.test.js` (well-separated
items produce zero candidates, well under a second). The Node ↔ ai-service
geometry calls are also batched (`TOPOLOGY_MAX_GEOMETRY_BATCH`, default 500
per round trip) rather than one HTTP call per polygon/pair.

## 15. APIs

All additive, under `/api/topology/*`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/topology/config` | optional | Tolerances, geometry-engine status, ML decision, disclaimer |
| POST | `/topology/validate` | `topology:validate` | Validate the entire dataset |
| POST | `/topology/validate/area/:areaId` | `topology:validate` | Validate one locality |
| POST | `/topology/validate/parcel/:ulpin` | `topology:validate` | Validate one parcel + its hierarchy |
| POST | `/topology/validate/building/:buildingId` | `topology:validate` | Validate one building's owning parcel |
| POST | `/topology/validate/floor/:floorId` | `topology:validate` | Validate one floor's owning parcel |
| POST | `/topology/validate/unit/:propertyId` | `topology:validate` | Validate one unit's owning parcel |
| GET | `/topology/results` | `topology:read` | List past runs (summary only, no inlined findings) |
| GET | `/topology/results/:id` | `topology:read` | One run's full findings (filterable: `entity`, `status`, `severity`, `rule`) |
| GET | `/topology/summary` | `topology:read` | Latest run's summary |
| PATCH | `/topology/results/:id/findings/:validationId/review` | `topology:review` | Mark one finding reviewed — never touches geometry |

A `validate/*` scope call re-runs the engine over just that scope's owning
parcel and its full hierarchy — narrower than the whole area, verified in
`backend/tests/topology.test.js`.

## 16. UI

`/topology` (`TopologyValidation.jsx`): **Validate All** / **Validate
Current Area** / **Validate Selected Entity** (disabled unless a
parcel/building/floor/unit is currently selected), a summary panel (VALID/
WARNING/ERROR/REVIEW counts, plus a per-entity-type breakdown row), filters
(entity/status/severity), and a findings list. Each finding shows its rule
id, status/severity badges, message, suggested fix, a **Focus** button, a
**Details** expand/collapse (entity ids, computed value, tolerance,
provenance, aliases), and — for relationship findings — an **"Also focus
related entity"** link (`relatedFocusRef`), so e.g. an `OVERLAPPING_
PARCELS` finding can jump to either parcel in turn. A reviewer
(`topology:review`) can mark a finding reviewed inline.

## 17. Cesium integration

**Exactly one** Chennai-wide Cesium viewer — Phase 7 adds no new layer,
entity type, or viewer instance. **Focus** reuses the exact same
`SelectionContext` functions every other feature already uses
(`selectParcel`/`selectBuilding`/`selectFloor`/`selectUnit`, plus
`selectArea` first if the finding's locality differs from the current one),
then a client-side `navigate('/map')` — the existing selection → flyTo →
`PropertySidebar` wiring (already exercised by Phases 1–6) does the rest,
with zero Cesium-specific code added for Phase 7. A bare building-level
selection shows the existing generic "Building selected" panel (plus the
Phase 5 elevation-height panel) since this app has no dedicated
"BuildingCard" — only Parcel/AiBuilding/AiFloorUnit/Gnss selections do.

Because `Cesium3DMap` only mounts on the `/map` route (like every other
page-specific component in this app), navigating to `/topology` and back
legitimately unmounts/remounts it — "exactly one viewer" means only one
ever exists **at a time**, not that one JS object must survive a route
round-trip. Verified in Playwright by checking `canvas` count stays at 1
after such a round-trip, not object-reference equality (see §19 and the
regression note in §16 of the test file itself).

## 18. RBAC

Three new permissions, added to the existing RBAC matrix
(`backend/src/config/rbac.js`) — no bypass of authentication:
`topology:read` (Land Officer, Survey Officer, Planning Officer,
Administrator — view results/summary), `topology:validate` (Survey Officer,
Administrator — run a validation), `topology:review` (Survey Officer,
Administrator — mark a finding reviewed). A citizen sees no `/topology` nav
entry and gets `403` calling a gated endpoint directly.

## 19. Provenance

Every finding carries the underlying entity's own `provenance` (its
`status`/`constructionStatus`/etc. field) and `locality` — never upgraded or
inferred. A validation finding never changes a parcel's DEMO/OFFICIAL
status, and `topologyValidationResults` documents carry `isDemo: true`.

## 20. Testing

- **Python** (`ai-service/tests/test_topology_geometry.py`,
  `test_topology_api.py`) — polygon validity/self-intersection (a bowtie
  fixture), area, pairwise overlap/IoU (identical/partial/disjoint
  squares), the too-short-ring edge case, and the FastAPI endpoints. Part of
  the full ai-service suite (119 tests, all passing).
- **Backend** (`backend/tests/topology.test.js`, 23 tests against a
  dedicated `locality: 'topologytest'` synthetic dataset, cleaned up in
  `test.after`) — every rule id in §5–9 with a deliberately broken fixture,
  RBAC boundaries, geometry-never-modified, review-without-geometry-change,
  404 handling for unknown scopes, narrower single-parcel scoping, rule-alias
  filtering, entity-level (not finding-level) summary counting, and the
  spatial index's candidate-pair correctness + 500-item performance bound.
  Part of the full backend suite (100 tests, all passing).
- **Playwright** (`tests/e2e/landstack.spec.js`, "Phase 7" describe block,
  6 tests) — validated against the **real** Sholinganallur/Adyar/Anna Nagar
  demo dataset (not synthetic fixtures): Sholinganallur's one genuine
  `BUILDING_CROSSES_PARCEL_BOUNDARY` finding (building B05 extends exactly
  3.00 m past its parcel boundary — independently re-derived from the raw
  GeoJSON and confirmed to match the reported value), Anna Nagar's genuine
  `OVERLAPPING_PARCELS`/`GAPS` findings (also independently re-derived and
  confirmed), Adyar's genuinely clean (zero-finding) result, single-parcel
  scoping, the geometry-never-modified invariant, and canvas-count-stays-1
  across a validate → focus → map round trip.

## 21. Limitations (explicit)

- No official topology-certified cadastral ruling is produced — findings
  are RULE_ENGINE output against prototype/DEMO geometry, not a legal survey
  determination.
- `INVALID_UNIT_AREA`'s tolerance (`unitAreaMismatchFactor`, default 2.5) is
  deliberately much looser than parcels' (`areaMismatchFactor`, 0.25): this
  demo's unit footprints (`backend/src/data/geo.js::gridCells`) are
  deliberately inset ~8% per side purely so adjacent units render as
  visually separate boxes in the 3D view — a rendering choice, not a
  true-to-scale footprint — which alone shrinks geometry-derived area to
  ~70% of the un-inset cell before the normal ~15–20% built-up-vs-carpet-
  area markup is even considered. A tight tolerance here would flag most of
  the (correct) real demo dataset; the looser tolerance only catches
  genuinely gross (order-of-magnitude) mismatches. This was found and fixed
  during real-data verification against Sholinganallur (§20) — see the
  regression note below.
- A `GAPS` finding is a configurable heuristic about *unexplained proximity
  between two parcels* — it is never a claim about which (if either) parcel
  boundary is wrong, and it never modifies geometry.
- `associationConfidence`-style ratios anywhere in this engine (e.g. bbox
  footprint coverage for `BUILDING_OUTSIDE_PARCEL`) are simple, documented
  heuristics, not calibrated probabilities.
- Ancestor/descendant pairs (a unit inside its own building/floor, a floor
  inside its own building) are explicitly excluded from
  `VOLUME_INTERSECTION`/`UNIT_VERTICAL_OVERLAP` — those are containment
  relationships, not unexpected intersections. This exclusion is keyed on
  matching `focusRef.buildingId`/`floorNumber`, not `parentEntityId` alone
  (a floor's parent is its building; a building's "parent" is its ulpin —
  comparing `parentEntityId` alone would miss the floor/building pair). This
  bug was found and fixed during real-data verification (§20): before the
  fix, every unit and floor in Sholinganallur was flagged as
  "intersecting" its own building, producing 605 findings; after the fix,
  the real dataset shows the one genuine defect it actually has.
- No official 3D ULPIN is created or implied by any finding.

## 22. ML decision

Phase 7 uses deterministic topology validation rules. ML anomaly detection
is not enabled because explainable geometric rules are the appropriate
primary validation mechanism for cadastral and 3D topology validation.
