# 03 — Data Schema

Canonical shapes live in `backend/src/data/seed.js`. Mongo persistence uses
permissive schemas (`strict:false`) with an index on each collection's natural
key (`backend/src/store/mongo.js`). All spatial layers carry `isDemo: true`.

## Collections

| Collection | Key | Purpose |
| --- | --- | --- |
| `users` | `username` | account + `passwordHash` + `role` |
| `owners` | `id` | synthetic demo people |
| `ulpins` | `ulpin` | ULPIN registry (parcel-level, `isOfficial: true`) |
| `parcels` | `ulpin`, `parcelId` | cadastral parcel + GeoJSON polygon + status rollup |
| `buildings` | `buildingId`, `ulpin` | footprint, `heightM`, `baseElevationM`, floor/unit counts |
| `floors` | `floorId`, `buildingId` | `floorNumber` (0 = Ground), `baseHeight`, `topHeight` |
| `propertyUnits` | `propertyId`, `buildingId`, `floorId`, `ulpin` | one apartment; geometry + height band + owner + status |
| `commonAreas` | `commonAreaId`, `buildingId` | lobby/stair/lift/corridor/parking/garden — `ownership: "COMMON AREA"` |
| `registrations` | `registrationId`, `ulpin`, `propertyId` | deed registrations (parcel + unit) |
| `encumbrances` | `encumbranceId`, `ulpin`, `propertyId` | mortgage / lien / nil |
| `buildingApprovals` | `approvalId`, `buildingId` | CMDA plan approval |
| `propertyTax` | `taxId`, `ulpin`, `propertyId` | GCC assessment + dues |
| `landUse` | `ulpin` | zone / FAR |
| `masterPlans` | `planId` | master-plan zones (polygons) |
| `utilities` | `utilityId`, `type` | water/sewer/electricity/drainage/gas/fiber LineStrings |
| `environment` | `id`, `kind` | water bodies / eco / CRZ / heritage |
| `boundaries` | `id`, `level` | corporation / zone / ward |
| `roads` | `id` | road centrelines |
| `disputes` | `disputeId`, `ulpin`, `propertyId` | linked to ULPIN/parcel/building/floor/unit |
| `documents` | `docId`, `ulpin`, `propertyId`, `buildingId` | demo document cards |
| `undergroundInfrastructure` | `infrastructureId`, `type`, `status`, `source`, `verificationStatus`, `parentParcel`, `parentBuilding`, `ownerAuthority`, `locality` | Phase 8 — one underground utility / tunnel / metro / duct / manhole / chamber; GeoJSON Point/LineString/Polygon + true Z depth model + explicit provenance. Seed-mirrored DEMO network + additive uploads. Never joined into `parcels`/`buildings`. |
| `infrastructureValidationResults` | `validationRunId`, `scopeType`, `scopeId` | Phase 8 — one deterministic validation run (findings + summary), Phase 7 result model. Never touches `undergroundInfrastructure` geometry. |
| `infrastructureJobs` | `jobId`, `locality` | Phase 8 — one upload/import job summary. |
| `proposed3DPropertyIdentifiers` | `identifierId`, `canonicalIdentifier` (unique), `officialULPIN`, `parcelId`, `buildingId`, `floorId`, `unitId`, `propertyId`, `volumeId`, `geometryVersion`, `status`, `locality` | Phase 9 — RESEARCH/PROTOTYPE cross-hierarchy reference linking an Official parcel ULPIN with Building→Floor→Unit→3D Volume→Geometry Version. `status: PROPOSED`, `isOfficial: false`. Pointers only — never joined into `parcels`/`buildings`/`floors`/`propertyUnits`. |
| `geometryVersions` | `geometryVersionId`, `entityType`, `entityId` (unit `propertyId`), `geometryVersion`, `status` | Phase 9 — geometry version history (reference records; `geometryRef`, never a geometry copy). Historical versions are never deleted; a finalized version is immutable. |
| `serviceRequests` | `requestId`, `raisedBy` | citizen request + workflow `history[]` |
| `notifications` | `notificationId`, `forRole` | approval / dispute / tax / change alerts |
| `auditLogs` | `logId`, `entityId` | user · action · entity · before/after · timestamp |

## Representative documents

### Parcel

```json
{
  "ulpin": "TN-CHN-123456789",
  "isOfficialUlpin": false,
  "parcelId": "PCL-CHN-SHLN-0001",
  "surveyNumber": "231/5", "subdivisionNumber": "231/5A", "recordType": "TSLR",
  "village": "Sholinganallur", "taluk": "Sholinganallur", "district": "Chengalpattu",
  "locality": "sholinganallur",
  "geometry": { "type": "Polygon", "coordinates": [[[80.226, 12.899], ...]] },
  "areaSqft": 645833,
  "landUse": "Primary Residential",
  "ownershipStatus": "Verified", "registrationStatus": "Registered",
  "encumbranceStatus": "Partly Encumbered", "propertyTaxStatus": "Paid",
  "status": "Verified", "isDemo": true
}
```

`GET /api/parcels/:ulpin` augments this with a computed **`provenance`** block —
`{ ulpinStatus, verificationStatus, sourceOrganization, sourceDataset, sourceUrl,
retrievedAt, disclaimer, recordType, adminLevel }` — and a `providerChain`. Today
every parcel resolves as `verificationStatus: "DEMO"` /
`ulpinStatus: "DEMO_NOT_OFFICIAL"`. `isOfficialUlpin` is normalised to `false` in
the API response (in the seed it historically meant "parcel-level id", not
"government-official"). See
[`13-official-ulpin-data-investigation.md`](13-official-ulpin-data-investigation.md).

### Building

```json
{
  "buildingId": "TN-CHN-123456789-B01",
  "buildingNumber": 1, "buildingSegment": "B01",
  "ulpin": "TN-CHN-123456789",
  "name": "B01 – Sai Residency",
  "geometry": { "type": "Polygon", "coordinates": [ ... ] },
  "floorsAboveGround": 10, "totalFloors": 11, "unitsPerFloor": 6, "unitCount": 60,
  "heightM": 43.2, "baseElevationM": 8, "floorHeightM": 3.2,
  "constructionType": "RCC", "completionYear": 2021,
  "approvalStatus": "Approved", "constructionStatus": "Completed", "isDemo": true
}
```

### Floor

```json
{
  "floorId": "TN-CHN-123456789-B01-F02",
  "buildingId": "TN-CHN-123456789-B01",
  "floorNumber": 2, "floorSegment": "F02", "label": "Floor 02",
  "heightM": 3.2, "baseHeight": 14.4, "topHeight": 17.6,
  "unitCount": 6, "isDemo": true
}
```

`GET /api/floors/:id`, `/api/units/:id`, `/api/buildings/:id` and
`/api/gis/units` augment floor / unit / building records with a computed
**`volume`** block `{ volumeId, xmin..zmax, geometryVersion, source, prototype,
status }` (Phase 2). `GET /api/parcels/:ulpin` adds a `volumes` count + a
`validation` rollup; `GET /api/parcels/:ulpin/volumes` returns every volume + the
full validation. All prototype / DEMO geometry — see
[`14-prototype-3d-volume-model.md`](14-prototype-3d-volume-model.md).

### Property unit (apartment)

```json
{
  "propertyId": "TN-CHN-123456789-B01-F02-U201",
  "idKind": "Prototype 3D Property Identifier",
  "ulpin": "TN-CHN-123456789",
  "buildingId": "TN-CHN-123456789-B01", "buildingSegment": "B01",
  "floorId": "TN-CHN-123456789-B01-F02", "floorNumber": 2, "floorSegment": "F02",
  "unitId": "U201", "apartmentNumber": "201",
  "geometry": { "type": "Polygon", "coordinates": [ ... ] },
  "centroid": { "type": "Point", "coordinates": [80.2270, 12.9004] },
  "baseHeight": 14.4, "topHeight": 17.3, "gridCol": 0, "gridRow": 0,
  "carpetAreaSqft": 1025, "builtUpAreaSqft": 1240,
  "bedrooms": "2 BHK", "facing": "East", "constructionType": "RCC",
  "completionYear": 2021, "usage": "Residential", "propertyType": "Apartment Unit",
  "status": "Verified",
  "owner": { "name": "Ramesh Kumar", "ownershipType": "Individual", "sharePct": 100 },
  "isDemo": true
}
```

### AI building + job (Phase 3 — `aiBuildings`, `aiJobs`; additive, separate from `buildings`)

```json
{
  "aiBuildingId": "AI-CHN-000123", "jobId": "AIJOB-...", "locality": "sholinganallur",
  "geometry": { "type": "Polygon", "coordinates": [[[80.2270, 12.9005], ...]] },
  "georeferenced": true, "geoStatus": "GEOREFERENCED", "pixelPolygon": [[x, y], ...],
  "source": "AI_DEMO", "model": "classical-cv", "modelVersion": "1.0", "timestamp": "...",
  "confidence": 0.86, "confidenceLevel": "HIGH",
  "geometryStatus": "VALID", "geometryIssues": [], "areaM2": 820.1, "areaPx": 3280,
  "parcelStatus": "MATCHED", "parentParcelId": "PCL-CHN-SHLN-0001",
  "parentULPIN": "TN-CHN-123456789", "ulpinStatus": "DEMO_NOT_OFFICIAL",
  "parcelCandidates": [{ "parcelId": "...", "ulpin": "...", "overlapRatio": 0.82 }],
  "height": null, "heightStatus": "UNAVAILABLE",
  "reviewRequired": false, "reviewStatus": "REVIEW_REQUIRED", "isDemo": true
}
```
```json
{ "jobId": "AIJOB-...", "status": "COMPLETED", "imageName": "tile.tif",
  "locality": "sholinganallur", "requestedBy": "survey01",
  "createdAt": "...", "completedAt": "...", "model": "classical-cv",
  "summary": { "total": 4, "high": 4, "matched": 4, "multiParcel": 0, "reviewRequired": 0 } }
```

`parcelStatus ∈ {MATCHED, MULTI_PARCEL, OUTSIDE_PARCEL, REVIEW_REQUIRED}`.
`reviewStatus ∈ {REVIEW_REQUIRED, ACCEPTED, REJECTED, NEEDS_CORRECTION}`. AI
records **never** carry an official ULPIN or verified flag — see
[`15-ai-building-extraction.md`](15-ai-building-extraction.md).

### AI floor plan / room / unit (Phase 4 — `aiFloorPlans`, `aiRooms`,
`aiFloorUnits`; additive, separate from `floors`/`propertyUnits`)

```json
{
  "floorPlanId": "AIFP-CHN-000123", "jobId": "FPJOB-...",
  "source": "AI_DEMO", "dataClassification": "DEMO_RESEARCH_DATA", "dataset": "CubiCasa5K",
  "model": "classical-cv", "modelVersion": "1.0",
  "crs": "GEOREFERENCED_VIA_BUILDING", "scaleMPerPx": 0.02,
  "buildingId": "TN-CHN-123456789-B01", "floorId": "TN-CHN-123456789-B01-F02",
  "parentParcelId": "PCL-CHN-SHLN-0001", "parentULPIN": "TN-CHN-123456789",
  "ulpinStatus": "DEMO_NOT_OFFICIAL", "georeferenced": true,
  "validation": { "status": "VALID", "counts": { "valid": 0, "warning": 0, "error": 0 }, "issues": [] },
  "summary": { "walls": 1, "rooms": 7, "units": 2, "reviewRequired": 9 },
  "reviewStatus": "REVIEW_REQUIRED", "isDemo": true
}
```
```json
{ "roomId": "AIFP-CHN-000123-FP-RM-000001", "floorPlanId": "AIFP-CHN-000123",
  "class": "BEDROOM", "roomType": "BEDROOM", "area": 9.2, "areaUnit": "M2",
  "confidence": 0.71, "confidenceLevel": "MEDIUM", "geometryStatus": "VALID",
  "source": "AI_DEMO", "reviewRequired": true, "isDemo": true }
```
```json
{
  "aiFloorUnitId": "AIFP-CHN-000123-AI-UNIT-001", "localUnitId": "AI-UNIT-001",
  "floorPlanId": "AIFP-CHN-000123", "buildingId": "TN-CHN-123456789-B01",
  "floorId": "TN-CHN-123456789-B01-F02", "parentParcelId": "PCL-CHN-SHLN-0001",
  "parentULPIN": "TN-CHN-123456789", "ulpinStatus": "DEMO_NOT_OFFICIAL",
  "rooms": ["AIFP-CHN-000123-FP-RM-000001", "..."], "roomTypes": ["BEDROOM", "KITCHEN", "LIVING_ROOM"],
  "geometry": { "type": "Polygon", "coordinates": [[[80.2266, 12.8906], ...]] },
  "volume": { "volumeId": "FPV-001", "xmin": 80.2266, "xmax": 80.2267, "ymin": 12.8906, "ymax": 12.8993, "zmin": 6, "zmax": 9 },
  "area": 60.6, "areaUnit": "M2", "confidence": 0.71, "confidenceLevel": "HIGH",
  "geometryStatus": "VALID", "source": "AI_DEMO", "dataClassification": "DEMO_RESEARCH_DATA",
  "dataset": "CubiCasa5K", "heightStatus": "ESTIMATED",
  "reviewRequired": true, "reviewStatus": "REVIEW_REQUIRED", "isDemo": true
}
```

Unit/room identifiers (`AI-UNIT-nnn`, `FP-RM-nnnnnn`) are prototype application
IDs — **never** official ULPINs. `geometry`/`volume` are populated only when a
real `buildingId` (and, for `zmin`/`zmax`, `floorId`) was supplied; otherwise
they stay `null` and the plan/unit carries `localBoundary`/`localVolume`
instead. See [`16-ai-floor-plan-segmentation.md`](16-ai-floor-plan-segmentation.md).

### Elevation dataset + building height (Phase 5 — `elevationDatasets`,
`buildingHeights`; additive, separate from `buildings`; raw LAS/LAZ/GeoTIFF
bytes are never stored, only derived metadata + results)

```json
{
  "datasetId": "ELEV-CHN-000045", "datasetType": "DEM", "fileName": "dem_flat.tif",
  "status": "VALIDATED", "validationStatus": "VALID",
  "metadata": { "crs": "EPSG:32644", "resolutionM": [1.0, 1.0], "minElevationM": 6.1, "maxElevationM": 9.4 },
  "provenance": { "source": "ELEVATION_DEMO", "dataClassification": "DEMO_RESEARCH_DATA", "isOfficial": false },
  "locality": "sholinganallur", "isDemo": true
}
```
```json
{
  "buildingHeightId": "TN-CHN-123456789-B01-ELEVJOB-XYZ", "buildingId": "TN-CHN-123456789-B01",
  "jobId": "ELEVJOB-XYZ", "groundElevationM": 8.0, "roofElevationM": 28.0, "buildingHeightM": 20.0,
  "heightMethod": "DSM_MINUS_DEM", "heightStatistic": "ground=median, roof=median, outlier-clipped [2-98] pct",
  "qualityStatus": "VALID", "qualityIssues": [], "confidenceLevel": "HIGH", "confidenceScore": 0.91,
  "dataSource": "DEM_DSM_DERIVED", "groundClassificationMethod": null,
  "existingHeightM": 40.6, "existingHeightSource": "DEMO_ESTIMATED",
  "appliedToBuilding": false, "reviewStatus": "REVIEW_REQUIRED",
  "source": "ELEVATION_DEMO", "isDemo": true
}
```

`qualityStatus`/`confidenceLevel` are deterministic rule-based / weighted-score
outputs, not AI. When a reviewer `ACCEPT`s a result
(`PATCH /api/elevation/buildings/:id/review`), the *existing* `buildings` doc
gains `baseElevationM`/`heightM` updated in place plus additive
`elevationOverrideActive`/`elevationSource`/`elevationConfidenceLevel`/
`elevationOriginal` fields (the pre-override backup) — and every one of that
building's `floors`/`propertyUnits` gets the same treatment on
`baseHeight`/`topHeight`. `POST /api/elevation/buildings/:id/revert` restores
`elevationOriginal` exactly. See
[`17-lidar-dem-dsm-elevation.md`](17-lidar-dem-dsm-elevation.md).

### GNSS/CORS control point + boundary verification + geometry proposal
(Phase 6 — `gnssControlPoints`, `boundaryVerification`,
`geometryReviewProposals`; additive, never overwrites `parcels.geometry`
except via an explicit accepted proposal)

```json
{
  "controlPointId": "GNSS-CHN-000042", "latitude": 12.90045, "longitude": 80.22705,
  "resolvedLatitude": 12.90045, "resolvedLongitude": 80.22705, "height": 8.0,
  "accuracy": 0.02, "accuracyStatus": "REPORTED", "accuracyUnit": "m",
  "coordinateReferenceSystem": "EPSG:4326", "crsStatus": "MATCHED",
  "timestamp": "2024-01-15T10:00:00Z", "source": "CORS_SURVEY", "isSurveyGradeSource": true,
  "surveyMethod": "RTK", "verificationStatus": "UNVERIFIED",
  "validationStatus": "VALID", "validationIssues": [],
  "parcelStatus": "MATCHED", "parentParcelId": "PCL-CHN-SHLN-0001", "parentULPIN": "TN-CHN-123456789",
  "associationConfidence": 1, "nearestBoundaryM": 6.0,
  "jobId": "GNSSJOB-...", "locality": "sholinganallur",
  "isOfficial": false, "isDemo": true, "disclaimer": "GNSS/CORS DEMO / MODEL OUTPUT. ..."
}
```
```json
{
  "boundaryVerificationId": "GNSSBV-...", "parcelId": "PCL-CHN-SHLN-0001", "ulpin": "TN-CHN-123456789",
  "tolerance": 1.0, "verificationStatus": "WITHIN_TOLERANCE",
  "deviations": { "count": 4, "meanM": 0.42, "medianM": 0.4, "maxM": 0.9, "rmseM": 0.51 },
  "points": [{ "controlPointId": "GNSS-CHN-000042", "distanceM": 0.42, "verificationStatus": "WITHIN_TOLERANCE" }],
  "note": "OBSERVED DEVIATION from the existing parcel boundary — not an official cadastral correction.",
  "isDemo": true
}
```
```json
{
  "proposalId": "GNSSPROP-000012", "parcelId": "PCL-CHN-SHLN-0001", "ulpin": "TN-CHN-123456789",
  "originalGeometry": { "type": "Polygon", "coordinates": [ /* existing parcel ring */ ] },
  "proposedGeometry": { "type": "Polygon", "coordinates": [ /* proposed ring */ ] },
  "controlPoints": ["GNSS-CHN-000042"], "deviations": { "maxM": 1.4 },
  "reason": "Corner markers consistently 1.4 m outside the recorded boundary.",
  "reviewStatus": "PENDING_REVIEW", "reviewer": null, "reviewedAt": null,
  "isDemo": true
}
```

Optional GNSS survey metadata (`horizontalAccuracy`, `verticalAccuracy`,
`horizontalDatum`, `verticalDatum`, `epoch`, `antennaHeight`,
`observationDuration`, `fixStatus`, `satelliteCount`, `pdop`,
`correctionSource`, `referenceStation`, `operator`, `surveySessionId`,
`provenanceNote`) is stored only when the uploaded dataset supplied it —
never defaulted or inferred. `accuracy` is the value as supplied by the
source (`reportedAccuracy`); a boundary-verification `distanceM`/DEM-DSM
`elevationResidualM` is a *computed residual* against a configured
*validation tolerance* — the three are never conflated (see
[`18-gnss-cors-spatial-control.md`](18-gnss-cors-spatial-control.md)).
`geometryReviewProposals.reviewStatus` (`PENDING_REVIEW` → `ACCEPTED` |
`REJECTED`) only ever writes the *existing* `parcels.geometry` document on an
authorized `ACCEPT` — see that same doc, section 11.

### Topology validation run (Phase 7 — `topologyValidationResults`;
additive, never touches `parcels`/`buildings`/`floors`/`propertyUnits`)

```json
{
  "validationRunId": "TRUN-...", "scopeType": "area", "scopeId": "sholinganallur",
  "localities": ["sholinganallur"],
  "findings": [{
    "validationId": "TFIND-...", "ruleId": "BUILDING_CROSSES_PARCEL_BOUNDARY", "aliases": [],
    "status": "WARNING", "severity": "MEDIUM",
    "entityType": "BUILDING", "entityId": "TN-CHN-123456789-B05",
    "parentEntityId": "TN-CHN-123456789", "relatedEntityId": "PCL-CHN-SHLN-0001",
    "message": "Building B05 extends 3.00 m beyond parcel PCL-CHN-SHLN-0001's boundary (tolerance 0.5 m).",
    "focusRef": { "kind": "building", "buildingId": "TN-CHN-123456789-B05", "ulpin": "TN-CHN-123456789" },
    "relatedFocusRef": { "kind": "parcel", "ulpin": "TN-CHN-123456789" },
    "suggestedFix": "Review the building footprint against the parcel boundary; a small setback violation may need a boundary-review proposal (Phase 6).",
    "computedValue": 3, "tolerance": 0.5, "provenance": "Completed", "locality": "sholinganallur",
    "createdAt": "..."
  }],
  "summary": {
    "total": 774, "valid": 773, "warning": 1, "error": 0, "reviewRequired": 0,
    "overallStatus": "WARNING", "overallSeverity": "MEDIUM",
    "byEntity": { "PARCEL": { "total": 12, "valid": 12, "warning": 0, "error": 0, "reviewRequired": 0 } },
    "byRule": { "BUILDING_CROSSES_PARCEL_BOUNDARY": { "ruleId": "BUILDING_CROSSES_PARCEL_BOUNDARY", "total": 1, "warning": 1, "error": 0, "reviewRequired": 0 } }
  },
  "mlDecision": "Phase 7 uses deterministic topology validation rules. ...",
  "requestedBy": "survey01", "isDemo": true
}
```

Every finding's `computedValue`/`tolerance`/`reportedAccuracy`-equivalent
fields are kept as distinct concepts (never conflated) — see
[`19-intelligent-topology-validation.md`](19-intelligent-topology-validation.md)
section 10. `PATCH /api/topology/results/:id/findings/:validationId/review`
only ever adds `reviewAction`/`reviewedBy`/`reviewedAt` to one finding
within its own run document — it never touches `parcels`/`buildings`/
`floors`/`propertyUnits` geometry.

### Underground infrastructure (Phase 8)

```json
{
  "infrastructureId": "INF-DEMO-SHLN-WATER-0001",
  "type": "WATER_PIPELINE",               // controlled list — see docs/20 §3
  "subtype": "Distribution main",
  "ownerAuthority": "Chennai Metro Water (DEMO)",
  "status": "OPERATIONAL",
  "geometry": { "type": "LineString", "coordinates": [ /* [lon,lat] */ ] },
  "source": "DEMO",                        // OFFICIAL | AUTHORIZED | REAL_SURVEY | UPLOADED_SURVEY | DEMO | RESEARCH | UNVERIFIED | UNAVAILABLE
  "verificationStatus": "DEMO",            // mirrors `source` — NEVER auto-promoted
  "isOfficial": false,                     // true only for OFFICIAL / AUTHORIZED
  "diameterM": 0.3,                        // pipes/cables; null when N/A
  "widthM": null, "heightM": null,         // rectangular drains / tunnels / chambers
  "surfaceElevationM": 8, "topElevationM": 6.5, "bottomElevationM": 6.2,
  "depthBelowSurfaceM": 1.5,
  "depthReference": "GROUND_SURFACE",      // GROUND_SURFACE | PARCEL_SURFACE | TERRAIN | ABSOLUTE | UNKNOWN
  "verticalDatum": "UNKNOWN",              // never silently assumed
  "verticalReference": "Local ground surface (approx.)",
  "verticalStatus": "DEMO",               // KNOWN | KNOWN_RELATIVE | DERIVED | DEMO | UNKNOWN
  "inputCRS": "EPSG:4326", "outputCRS": "EPSG:4326",
  "crsStatus": "MATCHED",                  // MATCHED | REPROJECTED | UNKNOWN | TRANSFORMATION_FAILED
  "controlPointId": null, "surveySessionId": null, "reportedAccuracyM": null,
  "spatialRelation": "CROSSES_PARCEL",     // geometry fact only
  "parentParcel": "PCL-CHN-SHLN-0001", "parentParcelULPIN": "TN-CHN-123456789",
  "parentBuilding": null,
  "parcelRelations": [ { "parcelId": "…", "ulpin": "…", "spatialRelation": "CROSSES_PARCEL", "nearestBoundaryM": 0 } ],
  "legalOwnership": "NOT_PROVIDED",        // ONLY from authoritative data — never inferred from intersection
  "locality": "sholinganallur",
  "isDemo": true
}
```

If the source has **no reliable Z**, `topElevationM` / `bottomElevationM` /
`depthBelowSurfaceM` are `null`, `verticalStatus` is `UNKNOWN` and (for a real
source) `reviewRequired` is `true` — a depth is **never invented** (docs/20
§9). A `depthBelowSurfaceM` filter on `GET /api/infrastructure` only ever
matches records that actually carry a depth.

### Proposed 3D Property Identifier (Phase 9)

```json
{
  "identifierId": "P3DI-000123",
  "canonicalIdentifier": "3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2",
  "officialULPIN": "TN-CHN-123456789",        // null when NOT AVAILABLE (never fabricated)
  "officialULPINStatus": "DEMO_NOT_OFFICIAL",  // the parcel's OWN status — never upgraded
  "officialULPINVerified": false,
  "internalParcelRef": null,                   // set when officialULPIN is null
  "parcelId": "PCL-CHN-SHLN-0001",
  "buildingId": "TN-CHN-123456789-B01", "buildingSegment": "B01",
  "floorId": "TN-CHN-123456789-B01-F02", "floorSegment": "F02",
  "unitId": "U201", "propertyId": "TN-CHN-123456789-B01-F02-U201", "unitSegment": "U201",
  "volumeId": "V0201", "geometryVersion": "v2",
  "status": "PROPOSED",                        // never OFFICIAL / AUTHORIZED
  "source": "DEMO", "verificationStatus": "DEMO", "isOfficial": false,
  "legalStatus": "NOT_ESTABLISHED", "ownershipStatus": "NOT_PROVIDED",
  "rightsStatus": "NOT_ESTABLISHED", "encumbranceStatus": "NOT_PROVIDED",
  "conceptualVolumetricRights": { "volumeId": "V0201", "rights": [], "restrictions": [], "encumbrances": [] },
  "geometryStatus": "VALID",                   // recomputed on read
  "locality": "sholinganallur", "createdAt": "…", "updatedAt": "…"
}
```

Canonical form (documented in
[`21-proposed-3d-property-identifier.md`](21-proposed-3d-property-identifier.md#5-canonical-format-spec-section-5)):
`3DPR:<parcelKey>:B<dd>:F<dd>:U<unit>:V<dddd>:v<n>` — 7 `:`-separated tokens,
`:` reserved, deterministic, parsed backend-side.

### Geometry version (Phase 9)

```json
{
  "geometryVersionId": "GVER-000045",
  "entityType": "VOLUME", "entityId": "TN-CHN-123456789-B01-F02-U201",
  "geometryVersion": "v2", "previousVersion": "v1",
  "status": "ACTIVE",           // DRAFT|PENDING_REVIEW|ACTIVE|SUPERSEDED|REJECTED|ARCHIVED
  "source": "UPLOADED_SURVEY", "reason": "…", "isOfficial": false,
  "geometryRef": { "kind": "VOLUME", "id": "V0201", "unitPropertyId": "…", "buildingId": "…" },
  "supersededBy": null, "createdAt": "…", "updatedAt": "…"
}
```

Keyed to the unit `propertyId` (the Phase-2 `volumeId` is unique only within a
building). Historical versions are never deleted; a finalized version is
immutable — a change creates a new version, and taking `ACTIVE` supersedes the
prior `ACTIVE` in place.

## Relationships

`parcels.ulpin` 1—N `buildings.ulpin` 1—N `floors.buildingId` 1—N
`propertyUnits.floorId`. Governance rows reference `ulpin` (parcel scope) and/or
`propertyId` (unit scope) and/or `buildingId`. `disputes` may reference any level.
`aiBuildings.parentParcelId` optionally references `parcels.parcelId` (spatial
association only). `aiFloorPlans.buildingId`/`floorId` and
`aiFloorUnits.buildingId`/`floorId` optionally reference `buildings.buildingId`
/ `floors.floorId` (association only — the AI collections are never joined into
`floors`/`propertyUnits`); `aiRooms.floorPlanId` and `aiFloorUnits.floorPlanId`
reference `aiFloorPlans.floorPlanId`. `buildingHeights.buildingId` references
`buildings.buildingId` (association + optional, reviewer-gated write-back onto
that same document — see above); `elevationDatasets` stand alone (referenced
by `buildingHeights.jobId` via the shared `aiJobs` doc, `kind: "elevation"`).
`gnssControlPoints.parentParcelId`/`parentULPIN` optionally reference
`parcels.parcelId`/`ulpin` (spatial association only, never a new ULPIN);
`boundaryVerification.parcelId`/`ulpin` and `geometryReviewProposals.parcelId`/
`ulpin` likewise reference an existing parcel, and a proposal's
`controlPoints` reference `gnssControlPoints.controlPointId`. Only an
authorized `ACCEPT` on a `geometryReviewProposals` document ever writes
`parcels.geometry`.

`undergroundInfrastructure.parentParcel`/`parentParcelULPIN` and
`parentBuilding` optionally reference `parcels.parcelId`/`ulpin` and
`buildings.buildingId` (spatial association only — the collection is never
joined into `parcels`/`buildings`, and a spatial relationship is never a legal
ownership claim). `undergroundInfrastructure.controlPointId` optionally
references `gnssControlPoints.controlPointId` (Phase 6).
`infrastructureValidationResults` stand alone (scoped by `locality` or
`infrastructureId`); `infrastructureJobs` summarise an upload. A validation
finding and a `PATCH /api/infrastructure/:id/review` only ever add
`reviewAction`/`reviewedBy`/`reviewedAt` — they never change geometry, depth or
`verificationStatus`.

`proposed3DPropertyIdentifiers` holds only POINTERS:
`officialULPIN`/`parcelId` → `parcels`, `buildingId` → `buildings`,
`floorId` → `floors`, `propertyId` → `propertyUnits`, `volumeId` → the Phase-2
prototype volume of that unit. It is never joined into those collections and
never writes to them. `geometryVersions.entityId` references a unit
`propertyId`; `geometryRef` carries the `volumeId`. Phase 9 reads (but never
re-runs unless `POST /api/3d-identifiers/:id/revalidate` is called) the latest
parcel-scoped `topologyValidationResults` and references
`undergroundInfrastructure` spatial relations — always as relationships, never
as ownership. The Official ULPIN's own value and provenance are never modified
by Phase 9.
