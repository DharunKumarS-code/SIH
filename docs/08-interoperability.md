# 08 — Interoperability

## Principle

Fragmented land datasets are integrated **around the ULPIN**. Every department
is reached through an adapter with one interface:

```js
adapter.fetch(ulpin, { propertyId?, buildingId? }) -> standardized envelope
```

## Standard envelope

```json
{
  "source": "TN Land Records (Tamil Nilam) — Demo Adapter",
  "integration": "DEMO / MOCK INTEGRATION",
  "ulpin": "TN-CHN-123456789",
  "status": "verified",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "data": { }
}
```

## Adapters (`backend/src/services/adapters/index.js`)

| Key | Represents | Prototype source |
| --- | --- | --- |
| `LandRecords` | TN Land Records / Tamil Nilam | seeded `parcels` + `landUse` |
| `Registration` | Registration Dept. / IGRS | seeded `registrations` |
| `Planning` | CMDA planning & master plan | seeded `buildingApprovals` + `masterPlans` |
| `PropertyTax` | Greater Chennai Corporation | seeded `propertyTax` |
| `Disputes` | Courts / revenue dispute register | seeded `disputes` |
| `Utilities` | Metro Water / TANGEDCO | seeded `utilities` |

Every adapter extends `MockGovernmentAPIAdapter` and is explicitly labelled
**“DEMO / MOCK INTEGRATION”**.

## Endpoints

- `GET /api/interop/:ulpin` — aggregate: `{ ulpin, generatedAt, integrationMode, departments: { LandRecords, Registration, … } }`
- `GET /api/interop/:ulpin/:department` — one adapter's envelope

The frontend's Unified Property Record and the governance pages consume these.

## Replacing a mock with a real integration

1. Implement a class with the same `fetch()` signature that calls the real
   public API (only where one exists and is legally usable).
2. Return the **same envelope**.
3. Register it in `adapters` under the same key.

No frontend or route changes are required.

## Existing TN ecosystem (design intent)

The architecture is designed so `MockGovernmentAPIAdapter` instances can be
replaced by adapters for **TNGLMS, TNGIS, Tamil Nilam, the Registration portal
and property-tax portals**. **No government system is scraped or bypassed**, and
the prototype makes **no claim of live connectivity** — `GET /api/system/status`
always reports these as *Demo Connected*.
