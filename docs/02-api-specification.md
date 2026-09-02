# 02 — API Specification

Base URL: `http://localhost:4000/api` · All responses use the envelope
`{ "ok": true, "data": … , "meta"? }` or `{ "ok": false, "error": { message, details? } }`.
Auth: `Authorization: Bearer <JWT>` where required.

## Auth

| Method | Path | Auth | Body / notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | — | `{ username, name, email, password, role? }` → `{ token, user, permissions }` |
| POST | `/auth/login` | — | `{ username, password }` → `{ token, user, permissions }` |
| GET | `/auth/me` | Bearer | `{ user, permissions }` |

## Parcels & ULPIN

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/parcels` | optional | `?landUse&status&q&limit` |
| GET | `/parcels/:ulpin` | optional | parcel + landUse + registration + encumbrance + tax + disputes + buildings |
| POST | `/parcels` | `parcel:search` | create demo parcel (validated ULPIN pattern) |
| POST | `/parcels/:ulpin/verify` | `parcel:verify` | audited |
| GET | `/ulpins`, `/ulpins/:ulpin` | optional | ULPIN registry |

## 3D property hierarchy

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/buildings` | `?ulpin` |
| GET | `/buildings/:buildingId` | building + floors + approval + commonAreas + unitCount |
| GET | `/buildings/:buildingId/floors` | floor list |
| GET | `/floors/:floorId` | floor + units (with `gridCol/gridRow` for the floor plan) |
| GET | `/units` | `?buildingId&floorId&floorNumber&ulpin&status&usage&limit` |
| GET | `/units/:propertyId` | full unit record: hierarchy, building, floor, governance, documents, disputes |
| POST | `/units/:propertyId/verify` | `property:verify`; audited (`PROPERTY_VERIFIED`) |
| GET | `/common-areas` | `?buildingId` |

`:propertyId` is a **Prototype 3D Property Identifier**, e.g.
`TN-CHN-123456789-B01-F02-U201`. Invalid ids return a helpful `404`.

## Governance

| Method | Path |
| --- | --- |
| GET | `/ror/:ulpin` |
| GET | `/registration/:ulpin` `?propertyId` |
| GET | `/encumbrance/:ulpin` `?propertyId` |
| GET | `/property-tax/:ulpin` `?propertyId` |
| GET | `/building-approval/:buildingId` |
| GET | `/land-use/:ulpin` |
| GET | `/master-plan` |

## Interoperability

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/interop/:ulpin` `?propertyId` | aggregate of every department adapter |
| GET | `/interop/:ulpin/:department` | one adapter (`LandRecords`, `Registration`, `Planning`, `PropertyTax`, `Disputes`, `Utilities`) |

Envelope per department: `{ source, integration: "DEMO / MOCK INTEGRATION", ulpin, status, timestamp, data }`.

## GIS (GeoJSON)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/gis/parcels` | FeatureCollection of parcel polygons |
| GET | `/gis/buildings` | building footprints + `heightM`, `baseElevationM` |
| GET | `/gis/units` `?buildingId&floorNumber&ulpin` | one Feature per apartment with `baseHeight`/`topHeight` |
| GET | `/gis/common-areas` `?buildingId` | common-area polygons |
| GET | `/gis/layer/:layer` | `roads` · `utilities` · `environment` · `boundaries` · `master-plan` · `disputes` |

## Dashboards, disputes, AI, services, reports, admin, system

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/dashboard/stats` | optional |
| GET | `/analytics` | optional |
| GET | `/disputes` `?status&ulpin&propertyId`, `/disputes/:id` | optional |
| GET | `/ai/status` | optional |
| POST | `/ai/:feature` | `ai:run` (Survey Officer / Admin) |
| GET/POST | `/services`, `/services/:id`, `/services` (create), `/services/:id/advance` | Bearer / `service:create` / `service:process` |
| GET | `/reports` `?kind=property\|parcel\|building&id=` | optional |
| GET | `/notifications`, POST `/notifications/:id/read` | Bearer |
| GET | `/users` | `Administrator` |
| GET | `/audit` `?entityId&action` | `audit:view-own` (own entries) / Admin (all) |
| GET | `/system/status`, `/system/demo-credentials` | — |
| GET | `/search?q=` | optional — resolves ULPIN / proto id / building / unit / owner |
