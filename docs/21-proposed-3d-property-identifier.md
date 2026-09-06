# 21 — Proposed 3D Property Identifier (Phase 9)

> **Additive & non-authoritative.** Phase 9 defines a **RESEARCH / PROTOTYPE**
> identifier that links an existing parcel's **Official ULPIN** with the
> project's 3D cadastral hierarchy. It is **NOT** an official Government of
> India / Tamil Nadu / DoLR / Chennai Corporation 3D ULPIN standard, it has
> **not** been approved by any government body, and it **never** replaces the
> parcel-level Official ULPIN. Phases 1–8 are unchanged.

Preferred names: **"Proposed 3D Property Identifier"** or
**"3D Cadastral Reference ID"**. Never "Official ULPIN".

---

## 1. Objective

Provide a **machine-readable reference** across:

```
Official Parcel
    ↓
Official ULPIN            (authoritative, parcel-level — untouched)
    ↓
Building → Floor → Unit → 3D Volume → Geometry Version
```

The identifier is a *pointer layer* over existing entities. It reuses the
Phase-2 volume model, Phase-5 elevation values, Phase-6 survey references,
Phase-7 validation and Phase-8 spatial relationships — it recomputes none of
them and stores no geometry copies.

| Layer | Path |
| --- | --- |
| Backend service | `backend/src/services/identifier3d/` (`format` · `parse` · `validate` · `versions` · `resolve` · `constants` · `index`) |
| Backend controller | `backend/src/controllers/identifierController.js` |
| DEMO fixtures | `backend/src/data/identifier3d.js` (seed-mirrored via `seed.js`) |
| Frontend page | `frontend/src/pages/Property3DIdentifier.jsx` (`/identifier`) |
| Sidebar | `PropertySidebar.jsx` → unit card gains a "Proposed 3D Property Identifier" section |
| Cesium | **no new code** — focus reuses the existing unit selection (`SelectionContext.selectUnit`) |

---

## 2. Terminology (non-negotiable — spec sections 3, 44)

| Concept | Meaning | Provenance |
| --- | --- | --- |
| **Official ULPIN** | government / authoritative **parcel** identifier | its own (`ulpinStatus`); every seeded parcel is `DEMO_NOT_OFFICIAL` — a real ULPIN is never fabricated |
| **Proposed 3D Property Identifier** | this application's cross-hierarchy **reference** | `status: PROPOSED`, `isOfficial: false`, always |
| **3D Volume** | Phase-2 geometric representation of a unit | Phase-2 prototype volume model |
| **Rights / Ownership** | conceptual / authorized relationship only | `NOT_PROVIDED` / `NOT_ESTABLISHED` unless authoritative data attached |
| **Spatial intersection** | geometry fact | **never** ownership |

These are never blurred anywhere in the UI, API, docs or code comments.

---

## 3. Official ULPIN vs Proposed Identifier

- The Official ULPIN belongs to the **parcel**, comes from an authoritative
  source, and keeps its original value and provenance. Phase 9 **never**
  overwrites, renames or upgrades it.
- The Proposed 3D Property Identifier is an application/research reference that
  links parcel + building + floor + unit + volume + geometry version. It
  carries explicit `status: PROPOSED` and is never an "Official ULPIN".
- A demo property whose parcel has **no verified Official ULPIN** keeps
  `officialULPIN: null` and displays **"Official ULPIN: NOT AVAILABLE"** — a
  fake government identifier is never generated (spec section 6). Such records
  use the parcel's **internal prototype reference** (e.g. `PCL-CHN-SHLN-0001`)
  as the canonical's parcel key so the identifier stays globally unique.

---

## 4. Reference object

`proposed3DPropertyIdentifiers` collection (see
[`03-data-schema.md`](03-data-schema.md#proposed-3d-property-identifier-phase-9)):

```jsonc
{
  "identifierId": "P3DI-000123",
  "canonicalIdentifier": "3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2",
  "officialULPIN": "TN-CHN-123456789",       // null when NOT AVAILABLE
  "officialULPINStatus": "DEMO_NOT_OFFICIAL", // the parcel's own status — never upgraded
  "officialULPINVerified": false,
  "internalParcelRef": null,                  // set when officialULPIN is null
  "parcelId": "PCL-CHN-SHLN-0001",
  "buildingId": "…-B01", "buildingSegment": "B01",
  "floorId": "…-B01-F02", "floorSegment": "F02",
  "unitId": "U201", "propertyId": "…-B01-F02-U201", "unitSegment": "U201",
  "volumeId": "V0201", "geometryVersion": "v2",
  "status": "PROPOSED",                       // never OFFICIAL / AUTHORIZED
  "source": "DEMO", "verificationStatus": "DEMO", "isOfficial": false,
  "legalStatus": "NOT_ESTABLISHED", "ownershipStatus": "NOT_PROVIDED",
  "rightsStatus": "NOT_ESTABLISHED", "encumbranceStatus": "NOT_PROVIDED",
  "conceptualVolumetricRights": { "volumeId": "V0201", "rights": [], "restrictions": [], "encumbrances": [] },
  "geometryStatus": "VALID",                  // recomputed on read
  "locality": "sholinganallur",
  "createdAt": "…", "updatedAt": "…"
}
```

Authoritative parcel data is **referenced**, not duplicated.

---

## 5. Canonical format (spec section 5)

```
3DPR:<parcelKey>:<buildingSeg>:<floorSeg>:<unitSeg>:<volumeId>:<geometryVersion>
```

| Component | Rule |
| --- | --- |
| `3DPR` | fixed scheme prefix (case-insensitive in, upper out) |
| `parcelKey` | the Official ULPIN when one exists; otherwise the parcel's internal prototype reference; or the literal `NA` for a hypothetical parcel-less validation. `[A-Z0-9][A-Z0-9-]{2,31}`. A fake Official ULPIN is never generated. |
| `buildingSeg` | `B\d{2}` (e.g. `B01`) |
| `floorSeg` | `F\d{2}` (`F00` = ground) |
| `unitSeg` | `U[A-Z0-9]{1,12}` (e.g. `U201`) |
| `volumeId` | `V\d{2,4}` — the Phase-2 prototype volume id (`V<ff><nn>`, e.g. `V0201`) |
| `geometryVersion` | `v\d{1,4}` (`2`, `v2`, `V2` all normalise to `v2`) |

**Delimiter / escaping**: `:` is the ONLY delimiter and is reserved — no
component's character set contains it, so no escaping is needed; any input with
`:` inside a component is rejected. There are always exactly **7** tokens.
Parsing is idempotent: `format(parse(s)) === canonical(s)`.

Example: `3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2`
Example (no ULPIN): `3DPR:PCL-CHN-SHLN-0001:B01:F03:U301:V0301:v1`

The UI always labels this **"Proposed 3D Property Identifier"** / **"3D
Cadastral Reference ID"** with a `PROPOSED / RESEARCH` badge — never "Official
ULPIN", and never anything implying government approval.

---

## 6. Parser / formatter (spec section 23)

`backend/src/services/identifier3d/`:

- `formatCanonical(parts)` → canonical string (`format.js`).
- `parseCanonical(str)` → `{ ok, canonical, parts, errors[] }` (`parse.js`).
  Validates: prefix, exactly 7 components, allowed characters, component
  ordering (positional), version format, and reports every problem. It
  **never** repairs a malformed identifier and **never** resolves a collision
  by silently changing a component.
- `parseCanonicalOrThrow(str)` — throwing variant for internal callers.
- The **backend re-parses on every write path** — frontend validation is
  UX-only.

---

## 7. Hierarchy validation (spec sections 7, 35)

`validateIdentifier()` (`validate.js`) reuses the **Phase 7** `STATUS` /
`SEVERITY` vocabulary and finding shape. Rules (`ID3D_*`):

| Group | Rules |
| --- | --- |
| Structural | `ID3D_MALFORMED_IDENTIFIER` · `ID3D_INVALID_VERSION` · `ID3D_UNSUPPORTED_STATUS` · `ID3D_MISSING_PROVENANCE` |
| Official ULPIN | `ID3D_MISSING_OFFICIAL_ULPIN` (REVIEW_REQUIRED — never fabricated) · `ID3D_FABRICATED_OFFICIAL_ULPIN` (a caller trying to mark the identifier itself official → CRITICAL) |
| Hierarchy | `ID3D_PARCEL_NOT_FOUND` · `ID3D_BUILDING_NOT_FOUND` · `ID3D_FLOOR_NOT_FOUND` · `ID3D_UNIT_NOT_FOUND` · `ID3D_VOLUME_NOT_FOUND` · `ID3D_BROKEN_PARENT_RELATIONSHIP` · `ID3D_CONFLICTING_HIERARCHY` |
| Geometry | `ID3D_VOLUME_ID_MISMATCH` · `ID3D_INVALID_GEOMETRY_REFERENCE` · `ID3D_GEOMETRY_WARNING` · `ID3D_GEOMETRY_ERROR` (from Phase-2 `validateUnitVolume`) |
| Versioning | `ID3D_GEOMETRY_VERSION_NOT_FOUND` · `ID3D_DUPLICATE_ACTIVE_VERSION` |
| Uniqueness | `ID3D_DUPLICATE_IDENTIFIER` · `ID3D_DUPLICATE_VOLUME_ASSIGNMENT` (building-scoped) |
| Phase 7 ref | `ID3D_TOPOLOGY_ERROR_ON_HIERARCHY` (read-only; surfaced only from a persisted **parcel-scoped** Phase-7 run) |

A valid identifier is produced **only** for a valid hierarchy. `createIdentifier`
**blocks** on any `ERROR` finding and returns HTTP **409** with the findings —
a collision or broken hierarchy is *reported*, never silently fixed.

---

## 8. Geometry association (spec sections 8, 14, 41)

The identifier resolves to **existing** geometry — parcel polygon, building
footprint, floor volume, unit footprint and the Phase-2 unit **volume**. No
second 3D geometry implementation is created and no large geometry is copied
into MongoDB.

Before an identifier is marked fully valid: the volume must exist, its
`volumeId` must equal the identifier's `volumeId` component, the parent
relationships must be consistent, and Phase-2 geometry validation must not
report `ERROR`. If it does:

| Condition | `geometryStatus` |
| --- | --- |
| volume missing / id mismatch / version missing | `INVALID_GEOMETRY_REFERENCE` |
| Phase-2 `ERROR` | `ERROR` |
| Phase-2 `WARNING` | `WARNING` |
| overall `REVIEW_REQUIRED` (e.g. no Official ULPIN) | `REVIEW_REQUIRED` |
| otherwise | `VALID` |

Topology errors are never silently ignored.

---

## 9. Geometry versioning (spec sections 9–12)

`geometryVersions` collection. A version is a **reference record**
(`geometryRef`), not a geometry copy. History is keyed to the globally-unique
**unit `propertyId`** (the Phase-2 `volumeId` is only unique within a
building); each row carries the `volumeId` in `geometryRef`.

```jsonc
{
  "geometryVersionId": "GVER-000045",
  "entityType": "VOLUME", "entityId": "…-B01-F02-U201",
  "geometryVersion": "v2", "previousVersion": "v1",
  "status": "ACTIVE",                 // DRAFT|PENDING_REVIEW|ACTIVE|SUPERSEDED|REJECTED|ARCHIVED
  "source": "UPLOADED_SURVEY",
  "reason": "Unit geometry refined from an uploaded survey (demo).",
  "provenance": "…", "verificationStatus": "DEMO", "isOfficial": false,
  "geometryRef": { "kind": "VOLUME", "id": "V0201", "unitPropertyId": "…", "buildingId": "…" },
  "supersededBy": null,
  "createdAt": "…", "updatedAt": "…"
}
```

- **Immutability** — a finalized version (`ACTIVE` / `SUPERSEDED` / `REJECTED` /
  `ARCHIVED`) is never overwritten. A change creates a new version.
  `createVersion({ makeActive: true })` transitions the current `ACTIVE` to
  `SUPERSEDED` (recording `supersededBy`) and never deletes it.
- **Single ACTIVE** — normally exactly one version is `ACTIVE` per unit;
  `assertSingleActive()` validates this and `ID3D_DUPLICATE_ACTIVE_VERSION` is
  raised otherwise.
- **Status transitions** — a whitelist (`DRAFT→…`, `ACTIVE→SUPERSEDED|ARCHIVED`,
  …); an illegal transition is rejected.
- The seeded B01/F02 unit in each locality ships a real `v1 SUPERSEDED → v2
  ACTIVE` chain.

---

## 10. Audit history (spec section 12)

Every version create / supersede / status change is written through the
**existing** `auditService.recordAudit()` (`GEOMETRY_VERSION_CREATED`,
`GEOMETRY_VERSION_SUPERSEDED`, `GEOMETRY_VERSION_STATUS_CHANGED`); identifier
creation and revalidation likewise (`PROPOSED_3D_IDENTIFIER_CREATED`,
`PROPOSED_3D_IDENTIFIER_REVALIDATED`). Each record keeps `createdAt`,
`updatedAt`, `createdBy` (where supported), `source`, `reason`,
`previousVersion` and the status transition. No parallel audit system is added.

---

## 11. Identifier uniqueness (spec section 13)

The canonical identifier is deterministic — the same hierarchy + version always
produces the same string. `canonicalIdentifier` is the collection's natural
unique key. The engine **detects and reports** (never silently changes):
duplicate identifiers, conflicting hierarchy, duplicate (building-scoped)
volume assignment, duplicate `ACTIVE` version and inconsistent parent
relationships.

---

## 12. Rights model — conceptual only (spec sections 19–21)

`legalStatus`, `ownershipStatus`, `rightsStatus`, `encumbranceStatus` — values
`OFFICIAL | AUTHORIZED | PROPOSED | NOT_PROVIDED | NOT_ESTABLISHED | UNVERIFIED
| DEMO`. Seeded records are `NOT_ESTABLISHED` / `NOT_PROVIDED`. `DEMO` /
`PROPOSED` / `RESEARCH` never read as legally authoritative.

`conceptualVolumetricRights` is a **placeholder** container:

```jsonc
{ "volumeId": "V0201", "rights": [], "restrictions": [], "encumbrances": [] }
```

The UI labels it **"Conceptual Volumetric Rights (Proposed Rights
Association)"**. No statement of legal rights, ownership, title, lease,
easement, mortgage or government restriction is made unless authoritative legal
data is attached. Ownership is never inferred from a demo record or from
spatial intersection.

---

## 13. Phase 5 / 6 / 7 / 8 integration

- **Phase 5** — the resolved building carries `elevationOverrideActive`,
  `elevationSource`, `elevationConfidenceLevel` (referenced, never recomputed).
- **Phase 6** — `surveyReferences` exposes `controlPointId`, `surveySessionId`,
  `surveyMethod`, `crs`, `verticalDatum`, `verificationStatus` from the parcel's
  latest GNSS control point. A control-point reference does **not** make the
  identifier survey-authoritative.
- **Phase 7** — `geometryStatus` derives from Phase-2 validation for the fast
  path; `ID3D_TOPOLOGY_ERROR_ON_HIERARCHY` references a persisted **parcel-scoped**
  Phase-7 run. `POST /api/3d-identifiers/:id/revalidate` triggers a fresh
  Phase-7 `runValidation` for the linked parcel and stores it — Phase 9 never
  re-implements the rules.
- **Phase 8** — `relatedUndergroundInfrastructure` lists infrastructure that is
  spatially related to the parcel/building, **as a relationship only**.
  Underground infrastructure is never part of the identifier hierarchy and a
  spatial intersection is never an ownership claim.

---

## 14. API (spec section 22)

Base `http://localhost:4000/api`. Envelope `{ ok, data, meta? }`.

```
GET   /3d-identifiers/config
GET   /3d-identifiers/search              ?q=
GET   /3d-identifiers                     ?ulpin=&buildingId=&floorId=&unitId=&volumeId=&geometryVersion=&status=&locality=&limit=
GET   /3d-identifiers/:identifierId       (identifierId OR canonicalIdentifier)
GET   /3d-identifiers/:identifierId/hierarchy
GET   /3d-identifiers/:identifierId/geometry
GET   /3d-identifiers/:identifierId/versions
POST  /3d-identifiers                     (3didentifier:create)   — canonical string OR hierarchy refs OR propertyId
POST  /3d-identifiers/validate            (3didentifier:validate) — dry-run
POST  /3d-identifiers/:identifierId/versions          (3didentifier:create)  — new geometry version
PATCH /3d-identifiers/:identifierId/versions/review   (3didentifier:review)  — status transition
POST  /3d-identifiers/:identifierId/revalidate        (3didentifier:validate) — fresh Phase-7 parcel run
GET   /ulpins/:ulpin/3d-identifiers       — proposed 3D references for an Official ULPIN (spec section 30)
```

Existing APIs are unchanged. Global `/search` also resolves a `3DPR:…` string
(or any hierarchy component) to a `kind: "identifier"` result whose selection
focuses the referenced unit/volume in the **same** Chennai Cesium viewer.

---

## 15. MongoDB (spec section 24)

Additive collections only: `proposed3DPropertyIdentifiers` (unique on
`canonicalIdentifier`; indexed on `identifierId`, `officialULPIN`, `parcelId`,
`buildingId`, `floorId`, `unitId`, `propertyId`, `volumeId`, `geometryVersion`,
`status`, `locality`) and `geometryVersions` (indexed on `geometryVersionId`,
`entityType`, `entityId`, `geometryVersion`, `status`). MongoDB Atlas is
preserved; the DEMO fixtures mirror into empty collections on first boot. No
migrations. No large geometry is stored — pointers only.

---

## 16. RBAC (spec section 25)

| Permission | Roles |
| --- | --- |
| `3didentifier:read` | all roles (Citizen … Administrator) |
| `3didentifier:create` | Survey Officer, Administrator |
| `3didentifier:validate` | Survey Officer, Administrator |
| `3didentifier:review` | Survey Officer, Administrator |

GET routes use `optionalAuth`; mutating routes require the permission above.
Authentication is never bypassed; existing RBAC is unchanged.

---

## 17. Frontend & Cesium (spec sections 26–33)

- **Page** `/identifier` — canonical-format card, search (canonical / ULPIN /
  any component), a selected-identifier panel with: **Official ULPIN** (+
  status) shown *separately* from the **Proposed 3D Property Identifier** (mono,
  `PROPOSED / RESEARCH` badge); the full hierarchy tree
  (Parcel → Official ULPIN → Building → Floor → Unit → 3D Volume → Geometry
  Version); provenance; conceptual legal status; **Conceptual Volumetric
  Rights**; **geometry version history** (v1/v2/… with status; superseded
  versions remain visible); Phase 5/6/8 reference chips; validation findings; a
  **"Validate an identifier"** tool; and **"Look up by Official ULPIN"**.
- **Cesium** — **no new viewer, no new code**. "Focus 3D volume" and every
  search result reuse `SelectionContext.selectUnit()` → the existing unit
  selection focuses the Phase-2 volume, opens `PropertySidebar`, and preserves
  LOD / area navigation / progressive loading. There is exactly **one**
  Chennai-wide `Cesium.Viewer`.
- **Sidebar** — the existing unit card gains a "Proposed 3D Property
  Identifier" section (canonical + Official ULPIN line + `PROPOSED / RESEARCH`
  badge + link to `/identifier`).
- **Disclaimer** — the page and the config both carry the full PROPOSED 3D
  PROPERTY IDENTIFIER disclaimer (spec section 34). Nothing implies government
  approval.

---

## 18. DEMO fixtures (spec section 36)

`backend/src/data/identifier3d.js` — per locality: 3 `v1 ACTIVE` identifiers
(B01/F01, B01/F02 with a `v1→v2` chain, B02/F01) + 1 with `officialULPIN: null`
(B01/F03, canonical keyed by the internal parcel ref). 12 identifiers + 15
geometry versions total. All `status: PROPOSED`, `source: DEMO`,
`isOfficial: false`, `legalStatus: NOT_ESTABLISHED`. Negative fixtures
(duplicate identifier, malformed, missing building/floor/unit/volume, invalid
volume, broken parent relationship, duplicate active version, missing geometry,
missing provenance, fabricated-Official-ULPIN attempt, conflicting hierarchy,
invalid version) live in `backend/tests/identifier3d.test.js`.

---

## 19. Testing (spec sections 37–38)

- **Backend** — `backend/tests/identifier3d.test.js`: config, parser/formatter,
  create/read/search, validation (all negative fixtures), uniqueness,
  hierarchy, geometry association, versioning + immutability + single-ACTIVE +
  transitions, status, provenance, rights metadata, RBAC, `byOfficialUlpin`,
  API errors.
- **Python** — none added; the existing `pytest` suite is unchanged.
- **E2E** — `tests/e2e/identifier3d.spec.js` (14 tests) per spec section 38.

---

## 20. Limitations

- All Phase 9 data shipped is **DEMO / PROPOSED / RESEARCH** — none is legally
  authoritative. No Official ULPIN, ownership, title or legal right is
  fabricated.
- The canonical format is a **proposed prototype**. It is not a government
  standard and would be superseded by an authoritative 3D cadastral standard if
  one is published.
- The Phase-2 `volumeId` is unique only within a building; version history is
  therefore keyed to the unit `propertyId`.
- `geometryStatus` uses Phase-2 validation for the fast path; a full Phase-7
  parcel run is only referenced when explicitly triggered via `revalidate`.
- Rights / restrictions / encumbrances are conceptual placeholders only.

---

## 21. Future standardization

If an authoritative Government of India / Tamil Nadu 3D or volumetric cadastral
identifier standard is published, this proposed format is expected to be
**replaced** by it. Until then the Official ULPIN remains parcel-level only, and
this identifier stays an explicitly-labelled research / prototype reference.
