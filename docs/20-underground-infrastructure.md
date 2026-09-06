# 20 — Underground 3D Infrastructure Mapping (Phase 8)

> **Additive.** Phase 8 extends the existing Chennai 3D cadastral environment
> with underground infrastructure. It adds no second application, no second
> Cesium viewer and no second geometry system. Phases 1–7 are unchanged.

---

## 1. Architecture

```
Chennai
  ↓
ONE Cesium Viewer  (frontend/src/components/map/Cesium3DMap.jsx)
  ↓
Area / Locality    (AreaSelector — same camera, progressive/lazy load, LOD)
  ↓
Parcel → Building → Floor → Unit
  ↓
Underground Infrastructure   ← Phase 8
```

There is **exactly one** Chennai-wide `Cesium.Viewer`. Underground
infrastructure is an optional, **default-OFF** entity group inside it
(`groupsRef.current.undergroundInfrastructure`), demand-loaded per locality by
`ensureUndergroundInfrastructure(areaId)` exactly like every other layer.
Area selection continues to fly the same camera; LOD bands, progressive
loading, lazy loading, selection, isolation and camera behaviour are reused
unchanged. The whole Chennai underground network is never loaded at once.

| Layer | Path |
| --- | --- |
| Backend service | `backend/src/services/underground/` (`config` · `parse` · `geometry` · `validate` · `associate` · `index`) |
| Backend controller | `backend/src/controllers/undergroundController.js` |
| DEMO fixtures | `backend/src/data/underground.js` (seed-mirrored via `seed.js`) |
| Frontend page | `frontend/src/pages/UndergroundInfrastructure.jsx` (`/underground`) |
| Cesium layer | `Cesium3DMap.jsx` → `ensureUndergroundInfrastructure` + `refreshDetailVisibility` |
| Sidebar | `PropertySidebar.jsx` → `InfrastructureCard` |

### No new Python

Phase 8 introduces **no new Python code**. 3D intersection, vertical
separation, depth-model derivation and all validation rules are deterministic
JavaScript. CRS transformation for a projected CRS reuses the **Phase 6**
`ai-service` `pyproj` endpoint (`POST /gnss/transform`) via
`services/gnss/crsClient.js`; if the ai-service is unreachable a projected-CRS
upload reports `crsStatus: "TRANSFORMATION_FAILED"` — never a guessed CRS. No
PostGIS or QGIS runtime dependency is added.

---

## 2. Data model

`undergroundInfrastructure` collection. Minimum fields: `infrastructureId`,
`type`, `ownerAuthority`, `geometry`, depth/elevation, `diameterM` (where
applicable), `status`, `source`, `timestamp`. Additional fields are populated
only when supplied — see [`03-data-schema.md`](03-data-schema.md#underground-infrastructure-phase-8)
for the full document shape.

| Group | Fields |
| --- | --- |
| Identity | `infrastructureId`, `type`, `subtype`, `ownerAuthority`, `status` |
| Geometry | `geometry` (GeoJSON `Point` / `LineString` / `Polygon`) |
| Dimensions | `diameterM` (pipes/cables) · `widthM` + `heightM` (rectangular drains, tunnels, chambers) |
| Vertical | `surfaceElevationM`, `topElevationM`, `bottomElevationM`, `depthBelowSurfaceM`, `depthReference`, `verticalDatum`, `verticalReference`, `verticalStatus`, `epoch` |
| CRS | `inputCRS`, `outputCRS`, `crsStatus`, `horizontalDatum` |
| Survey (Phase 6) | `controlPointId`, `surveySessionId`, `referenceStation`, `surveyMethod`, `reportedAccuracyM` |
| Spatial (facts only) | `spatialRelation`, `parentParcel`, `parentParcelULPIN`, `parentBuilding`, `parcelRelations[]`, `buildingRelations[]` |
| Legal | `legalOwnership` (`NOT_PROVIDED` unless authoritative) |
| Provenance | `source`, `verificationStatus`, `isOfficial`, `provenanceNote`, `confidence`, `reviewRequired` |
| Bookkeeping | `locality`, `isDemo`, `createdBy`, `createdAt` |

Fields that do not apply to a type are **not required** (a pipeline has a
`diameterM` and no `widthM`; a rectangular drain has `widthM`+`heightM` and no
`diameterM`; a manhole is a point with a depth; a chamber is a bounded volume).

---

## 3. Controlled infrastructure types

```
WATER_PIPELINE  SEWER_PIPELINE  STORMWATER_DRAIN  ELECTRICAL  TELECOM  GAS
TUNNEL  METRO  UTILITY_DUCT  MANHOLE  CHAMBER  OTHER
```

`normaliseType()` maps an unrecognised value to `OTHER` and the validation
engine raises `INF_UNCONTROLLED_TYPE`. Arbitrary uncontrolled types are never
created when an existing type applies.

---

## 4. Provenance — non-negotiable

Every object has explicit provenance. Classifications:

```
OFFICIAL  AUTHORIZED  REAL_SURVEY  UPLOADED_SURVEY  DEMO  RESEARCH  UNVERIFIED  UNAVAILABLE
```

`deriveVerification(source)` sets `verificationStatus` = the source
classification and `isOfficial` = `source ∈ {OFFICIAL, AUTHORIZED}`.
**`DEMO` / `RESEARCH` / `UNVERIFIED` / `UPLOADED_SURVEY` are never
automatically promoted to official** — not on import, not on validation, not on
review. `PATCH /api/infrastructure/:id/review` only records
`reviewAction`/`reviewedBy`/`reviewedAt`; it never rewrites `source`,
`verificationStatus`, geometry or depth.

```jsonc
// demo record
{ "source": "DEMO", "verificationStatus": "DEMO", "isOfficial": false }
// authorized real data
{ "source": "AUTHORIZED", "verificationStatus": "AUTHORIZED", "isOfficial": true }
```

No utility authority, ownership, survey accuracy, depth, elevation or official
infrastructure ID is ever fabricated.

---

## 5. CRS handling

- WGS84 / `EPSG:4326` / `CRS84` → used as-is, `crsStatus: "MATCHED"`.
- A **missing** CRS → `crsStatus: "UNKNOWN"` — never guessed. Authoritative
  geographic placement is blocked (the GIS layer omits `UNKNOWN` records) until
  reviewed; validation raises `INF_CRS_UNKNOWN` (`REVIEW_REQUIRED`).
- A **projected** CRS → every vertex is transformed via the Phase 6 `pyproj`
  endpoint; success → `crsStatus: "REPROJECTED"`, `inputCRS` / `outputCRS`
  recorded; failure/unreachable → `crsStatus: "TRANSFORMATION_FAILED"` and
  `INF_TRANSFORMATION_FAILED` (`ERROR`). Coordinate systems are never silently
  mixed; a per-batch `crs` that disagrees with a per-record `crs` raises
  `INF_CRS_MISMATCH`.

---

## 6. Vertical datum & depth model

Depth always has an **explicit reference**. `depthReference ∈ {GROUND_SURFACE,
PARCEL_SURFACE, TERRAIN, ABSOLUTE, UNKNOWN}`; `verticalDatum` defaults to
`UNKNOWN` and is **never silently assumed**. Absolute elevation, relative
depth, depth-below-terrain and depth-below-parcel-surface are kept distinct and
never silently converted.

`verticalBand(record)` derives a `[bottom, top]` metre band, preferring
explicit `top/bottom` elevations, then `surfaceElevation − depthBelowSurface`,
and returns `null` when nothing usable was supplied.

### True depth rule (spec §9)

For a **real** source (`OFFICIAL` / `AUTHORIZED` / `REAL_SURVEY` /
`UPLOADED_SURVEY`) with no reliable Z:

```jsonc
{ "topElevationM": null, "bottomElevationM": null, "depthBelowSurfaceM": null,
  "verticalStatus": "UNKNOWN", "reviewRequired": true }
```

Depth is **never invented** to improve visualisation. The map draws such a
record just below the surface, faded and dashed, and the sidebar shows
`DEPTH UNKNOWN`.

### DEMO depth

Every DEMO fixture carries `verticalStatus: "DEMO"`,
`depthReference: "GROUND_SURFACE"`, `verticalDatum: "UNKNOWN"`. The sidebar
labels it **DEMO DEPTH — illustrative, relative to local ground surface;
vertical datum UNKNOWN**. Validation raises `INF_VERTICAL_DATUM_UNKNOWN`
(`WARNING`) for any record that reports a depth without a datum.

---

## 7. 3D geometry & representation

| Type | GeoJSON | Cesium |
| --- | --- | --- |
| pipeline / sewer / stormwater / cable / duct | `LineString` | depth-placed `polyline` (width ∝ diameter/width; DEMO = dashed, official = solid) |
| tunnel / metro | `LineString` (+ `widthM`/`heightM`) | depth-placed `polyline` |
| manhole / access point | `Point` | `cylinder` (length ∝ depth, radius ∝ width) |
| chamber / vault | `Polygon` | extruded volume between `bottomElevationM` and `topElevationM` |

Z is taken from the depth model (§6). The renderer reuses the Phase-2 Z
convention (metres above a local ground datum) — there is no second geometry
system. Entity counts are kept modest (≈10 demo records per locality; the layer
is default-OFF and building-zoom-gated).

---

## 8. 2D vs 3D intersection (spec §19) — the key Phase 8 capability

`intersection3D(recA, geomA, recB, geomB)` computes, for a pair of assets:

- `horizontal2D` — `INTERSECT` / `SEPARATE` + measured `horizontalSeparationM`;
- `verticalStatus` — `BOTH_KNOWN` / `Z_UNKNOWN`;
- `verticalSeparationM` — gap between the two vertical bands (`null` if unknown);
- `relationship`:
  - **`3D_COLLISION`** — cross in plan **and** vertical bands overlap;
  - **`2D_INTERSECTION`** — cross in plan but vertically clear → **not** a collision;
  - **`INDETERMINATE_Z`** — cross in plan, but ≥1 asset has no reliable Z;
  - `NO_INTERSECTION`.

Example: a water main at `topElevationM ≈ 6.5` and a sewer at
`topElevationM ≈ 4.0` cross in X/Y but have ~2.2 m vertical separation →
`relationship: "2D_INTERSECTION"`, never `3D_COLLISION`. The seeded DEMO
network is deliberately conflict-free and includes exactly this showcase pair
plus a metro tunnel that passes ~14 m under every utility (2D intersections
only).

---

## 9. Underground clearance (spec §20)

Where reliable Z exists the engine **reports the measured vertical
separation** on every crossing finding. It does **not** invent an
engineering/legal clearance threshold. `clearanceStatus` is `REVIEW_REQUIRED`
unless `INF_AUTHORITATIVE_CLEARANCE_M` is configured, in which case a
`MEETS_` / `BELOW_AUTHORITATIVE_CLEARANCE` verdict is issued. A configurable
`clearanceNoticeM` (default 0.6 m) only decides which measured separations are
close enough to surface as `REVIEW_REQUIRED`; it is not a clearance standard.

```
verticalSeparation = 2.1 m
clearanceStatus    = REVIEW_REQUIRED   // no authoritative rule configured
```

---

## 10. Validation (reuses & extends Phase 7)

`services/underground/validate.js` reuses the Phase 7 `STATUS` / `SEVERITY`
vocabulary and the finding result shape (spec §21): `validationId`, `ruleId`,
`status`, `severity`, `entityType`, `entityId`, `parentEntityId`,
`relatedEntityId`, `message`, `geometry`, `focusRef`, `suggestedFix`,
`computedValue`, `tolerance`, `provenance`, `createdAt`. A finding **never**
modifies stored geometry; `suggestedFix` is guidance only. Runs persist to
`infrastructureValidationResults`.

Infrastructure-specific deterministic rules:

| Group | Rules |
| --- | --- |
| Geometry | `INF_INVALID_GEOMETRY` · `INF_EMPTY_GEOMETRY` · `INF_INVALID_COORDINATES` · `INF_SELF_INTERSECTION` · `INF_DEGENERATE_GEOMETRY` · `INF_GEOMETRY_TYPE_MISMATCH` · `INF_UNCONTROLLED_TYPE` |
| Dimensions | `INF_INVALID_DIAMETER` · `INF_INVALID_DIMENSIONS` · `INF_DUPLICATE_ID` · `INF_DUPLICATE_GEOMETRY` |
| Vertical | `INF_INVALID_Z` · `INF_MISSING_DEPTH` · `INF_INVALID_DEPTH` · `INF_VERTICAL_DATUM_UNKNOWN` · `INF_DEPTH_SURFACE_CONFLICT` |
| CRS | `INF_CRS_UNKNOWN` · `INF_CRS_MISMATCH` · `INF_TRANSFORMATION_FAILED` |
| Spatial | `INF_OUTSIDE_PROJECT_AREA` · `INF_UNEXPECTED_PARCEL_RELATION` · `INF_UNEXPECTED_BUILDING_RELATION` |
| Provenance | `INF_MISSING_PROVENANCE` |
| 3D | `INF_3D_COLLISION` · `INF_2D_INTERSECTION_VERTICALLY_CLEAR` · `INF_CLEARANCE_REVIEW` |

A utility passing **beneath** a parcel is **not** an error — a plain
parcel/utility intersection is never flagged. Only an explicitly declared
`parentBuilding` that the geometry does not reach raises
`INF_UNEXPECTED_BUILDING_RELATION`.

---

## 11. Property relationships (spec §11–12, §32)

`spatialRelation`, `legalOwnership` and `ownerAuthority` are **separate
concepts**. Spatial vocabulary (geometry facts only):

```
WITHIN_PARCEL  CROSSES_PARCEL  NEAR_PARCEL  OUTSIDE_PROJECT_AREA
UNDER_BUILDING  NEAR_BUILDING  CROSSES_BUILDING
INTERSECTS_UTILITY  PARALLEL_TO_UTILITY
```

A spatial relationship is **never** converted into a legal ownership claim.
`legalOwnership` stays `NOT_PROVIDED` unless authoritative data supplies it.
`GET /api/infrastructure/:id/relations` returns spatial facts and legal
ownership under separate keys with an explicit `ownershipNote`. The sidebar
shows:

```
Related Parcel:   TN-CHN-123456789
Spatial Relation: CROSSES_PARCEL
Legal Ownership:  NOT_PROVIDED
```

It never displays "Parcel owns pipeline".

---

## 12. Phase 5 & Phase 6 integration

- **Phase 5 (elevation)** — `GET /api/infrastructure/:id/elevation` reuses the
  nearest building's validated `buildingHeights` `groundElevationM` as surface
  context. DSM − DEM is **never** used as an underground depth. Phase 5
  authoritative/reviewed values are never overwritten. Any derived surface
  value records its `surfaceElevationSource`.
- **Phase 6 (GNSS/CORS)** — a record may reference `controlPointId`,
  `surveySessionId`, `referenceStation`, `surveyMethod`. CRS transformation
  reuses the Phase 6 `pyproj` client. `reportedAccuracyM` is shown only when
  the source supplied it; `computedValue` / `tolerance` on a finding are kept
  distinct from a reported accuracy.

---

## 13. API

Base `http://localhost:4000/api`. Envelope `{ ok, data, meta? }`.

```
GET   /infrastructure/config
GET   /infrastructure/summary?locality=
GET   /infrastructure            ?type=&area=&parcel=&building=&status=&source=&verificationStatus=&ownerAuthority=&minDepthM=&maxDepthM=&limit=
GET   /infrastructure/:id
GET   /infrastructure/:id/relations
GET   /infrastructure/:id/elevation
POST  /infrastructure/upload      (infrastructure:upload)  — multipart GeoJSON/CSV/JSON, dry-run validate
POST  /infrastructure/import      (infrastructure:upload)  — persist
POST  /infrastructure/validate    (infrastructure:validate) — { scope: 'all'|'locality'|'infrastructure', locality?, infrastructureId? }
POST  /infrastructure/collisions  (infrastructure:validate) — { locality?, infrastructureIds? }
PATCH /infrastructure/:id/review  (infrastructure:review)   — { action: ACKNOWLEDGED|ACCEPTED|REJECTED|NEEDS_CORRECTION }
GET   /infrastructure/validation-results[/:id]  (infrastructure:read)
GET   /gis/underground-infrastructure  ?locality=&type=&source=&verificationStatus=&status=   — GeoJSON for the Cesium layer
```

Existing APIs are unchanged. Global `/search` also resolves an
`infrastructureId` / type / owner-authority to a focusable `kind: "infrastructure"` result.

---

## 14. Input data support

- **GeoJSON** `FeatureCollection` of `Point` / `LineString` / `Polygon`
  (properties carry the model fields; a top-level `crs` member is read only if
  a feature sets none).
- **CSV** one row per object — `infrastructureId,type,latitude,longitude,
  elevation|depth,diameterM,status,source,…` (a two-point line via
  `lat2,lon2`). Richer geometry must be GeoJSON.
- **JSON** an array, or `{ "infrastructure": [ … ] }`, each item optionally
  carrying a GeoJSON `geometry`.

Parsing uses a hand-rolled, allowlisted parser (only `CORE_FIELDS` +
`METADATA_FIELDS` reach a stored document — safe against prototype pollution /
unexpected-key injection). No PostGIS/QGIS runtime dependency.

---

## 15. MongoDB

Additive collections only:
`undergroundInfrastructure`, `infrastructureValidationResults`,
`infrastructureJobs`. Indexes on `infrastructureId`, `type`, `status`,
`source`, `verificationStatus`, `parentParcel`, `parentBuilding`,
`ownerAuthority`, `locality`. MongoDB Atlas is preserved; the DEMO network is
mirrored into an empty collection on first boot exactly like every other seed
collection. No migrations.

---

## 16. RBAC

| Permission | Roles |
| --- | --- |
| `infrastructure:read` | all roles (Citizen … Administrator) |
| `infrastructure:upload` | Survey Officer, Administrator |
| `infrastructure:validate` | Survey Officer, Administrator |
| `infrastructure:review` | Survey Officer, Administrator |

GET list/detail/GIS/config use `optionalAuth` (the demo data is non-sensitive
DEMO); mutating endpoints require the permission above. Authentication is never
bypassed; existing RBAC is unchanged.

---

## 17. Frontend

- **Page** `/underground` — summary, type/area/status/source/verification/depth
  filters, a clickable table (row → focus in the 3D map), a 3D collision /
  clearance analysis panel, a deterministic-validation panel, and a
  GeoJSON/CSV/JSON upload (validate → import) gated by `infrastructure:upload`.
- **Cesium layer** — `Underground Infrastructure` row in the existing
  `LayerManager`, **OFF by default**. Selection, isolation, LOD, progressive
  and lazy loading, and camera behaviour are the existing ones.
- **Sidebar** — `InfrastructureCard` shows infrastructure ID, type, authority,
  status, depth (with a `Surface ── −Xm` diagram), elevation, diameter,
  width/height, source, verification, timestamp, parent parcel, parent
  building, control point, confidence, spatial relationship and — only when
  actually supplied — legal ownership. Unavailable fields show "Not available",
  never a fabricated value. **Focus** flies the existing camera to the object.
- **Depth visualisation** — real depth is drawn and labelled; DEMO depth is
  labelled `DEMO DEPTH`; unknown depth is labelled `DEPTH UNKNOWN` and drawn
  faded/dashed so it never looks surveyed.
- **Disclaimer** — the page and the sidebar both carry the full UNDERGROUND
  INFRASTRUCTURE DATA disclaimer (spec §33).

---

## 18. Demo data

`backend/src/data/underground.js` builds a deterministic ~10-object network per
locality (Sholinganallur / Adyar / Anna Nagar): water pipeline, sewer,
stormwater box drain, electrical duct bank, telecom fibre duct, gas main, metro
bored tunnel, common services duct, sewer manhole, switchgear chamber. Every
record: `source: "DEMO"`, `verificationStatus: "DEMO"`, `isOfficial: false`,
`legalOwnership: "NOT_PROVIDED"`, `verticalDatum: "UNKNOWN"`. `ownerAuthority`
strings are suffixed `(DEMO)`.

Negative fixtures (invalid coordinates, missing CRS, CRS mismatch, invalid Z,
missing depth, invalid diameter, duplicate ID, self-intersection, unknown
vertical datum, 2D-intersection-with-valid-Z-separation, true 3D collision,
crossing-parcel, outside-project-bounds, missing provenance) live in
`backend/tests/underground.test.js` — never in the seed.

---

## 19. Testing

- **Backend** — `backend/tests/underground.test.js` (25 tests): config,
  CRUD/list, filtering (type/source/verification/depth), GIS layer, relations
  (spatial vs legal), elevation context, upload dry-run (all negative
  fixtures), import (+ provenance-never-promoted), deterministic validation
  run, 3D-collision vs 2D-intersection, collision endpoint, review
  (no promotion / no geometry change), RBAC (citizen 403 on
  upload/validate/review), search, API errors, and pure-function units
  (`validateRecord`, `validateIntersections`, `associate`, `verticalBand`,
  `intersection3D`).
- **Python** — none added; the existing `pytest` suite is unchanged.
- **E2E** — `tests/e2e/underground.spec.js` (12 tests) per spec §37: page
  loads, enable layer → infrastructure visible, select → sidebar +
  infrastructureId, Focus → same camera, search → focus, depth/elevation
  display, DEMO provenance visible, parcel intersection ≠ ownership, disable
  layer → hidden, exactly ONE Cesium canvas, area switch
  Sholinganallur → Adyar → Anna Nagar (same viewer, no stale data), and a
  2D-crossing-with-different-Z that is not reported as a 3D collision.

---

## 20. Limitations

- All Phase 8 data shipped is **DEMO**. No real Chennai government utility
  infrastructure is included or claimed.
- DEMO depths are illustrative and relative to an approximate local ground
  surface; `verticalDatum` is `UNKNOWN`.
- 3D collision detection uses each asset's axis-aligned vertical band and
  planar segment crossings — it is a screening check, not an engineering
  clash-detection tool.
- No authoritative underground clearance standard is configured; measured
  separations are reported, never judged.
- Spatial association is parcel/building-level and heuristic; it never creates
  or changes a ULPIN and never asserts legal ownership.
- CRS transformation for a projected CRS needs the Phase 6 `ai-service`;
  otherwise `crsStatus: "TRANSFORMATION_FAILED"`.

---

## 21. Security

RBAC preserved; mutating endpoints permission-gated. Upload parsing is
allowlisted (prototype-pollution safe) and size-capped
(`INFRA_MAX_UPLOAD_MB`, default 6). No secrets are logged. No `.env`, API keys,
MongoDB credentials, tokens or private datasets are committed — existing
`.env` configuration is reused. Protected infrastructure data is not exposed to
unauthorised users beyond the DEMO layer, which is non-sensitive by
construction.

---

## 22. Performance

The layer is default-OFF and building-zoom-gated; per-locality demand loading,
LOD bands, entity caching and `scene.requestRenderMode` are the existing
mechanisms. Millions of objects are never rendered. Pairwise 3D intersection
uses bounding-box prefiltering, not a blind O(n²) exact-geometry sweep.
Existing map performance is unaffected (the group is skipped entirely while the
layer is off).
