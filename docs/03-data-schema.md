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

## Relationships

`parcels.ulpin` 1—N `buildings.ulpin` 1—N `floors.buildingId` 1—N
`propertyUnits.floorId`. Governance rows reference `ulpin` (parcel scope) and/or
`propertyId` (unit scope) and/or `buildingId`. `disputes` may reference any level.
`aiBuildings.parentParcelId` optionally references `parcels.parcelId` (spatial
association only).
