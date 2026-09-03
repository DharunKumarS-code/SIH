# 13 — Official ULPIN Data Investigation & Provenance Foundation (Phase 1)

> **Bottom line:** No officially and legally accessible public API, GIS service or
> dataset provides real ULPIN-linked land-parcel data for Chennai
> (Sholinganallur / Adyar / Anna Nagar). Every authoritative channel requires an
> Aadhaar OTP, a CAPTCHA, or a registered-user login — none of which this project
> bypasses. **All parcels the app shows are DEMO data, explicitly labelled.**

Investigated: 2026-09-03.

---

## 1. What ULPIN is

| Property | Value |
| --- | --- |
| Full name | Unique Land Parcel Identification Number (a.k.a. Bhu-Aadhaar) |
| Format | **14-digit alphanumeric** |
| Basis | Parcel centroid latitude/longitude, ECCMA standard |
| Identifies | **A LAND PARCEL — only.** Never a building, floor, or apartment. |
| Authority | Department of Land Resources (DoLR), Ministry of Rural Development, Govt of India, under DILRMP |
| Tamil Nadu | Part of the national rollout |

Consequence for this project's hierarchy:

```
Official Land Parcel  →  Official ULPIN   (government-issued, one per parcel)
        └── Building   ─┐
              └── Floor │  application-level identifiers — NOT official ULPINs
                    └── Unit
```

## 2. Sources investigated

| # | Source | URL | What it is | Access barrier | Chennai |
| - | --- | --- | --- | --- | --- |
| 1 | DoLR — Bhu-Aadhaar / ULPIN Land Record Search | https://dolr.gov.in/en/ulpin/ | National ULPIN RoR lookup | **CAPTCHA** per lookup; ULPIN *generation* needs an **Aadhaar-linked mobile OTP**. No API, no bulk download. | UNAVAILABLE |
| 2 | Tamil Nilam — GI Viewer | https://tngis.tn.gov.in/apps/gi_viewer/ | TN cadastral parcels: survey no, sub-division, patta, FMB | **"Available exclusively to registered users"** — login required. | UNAVAILABLE |
| 3 | TNGIS GeoServer (OGC WMS/WFS/WCS) | https://tngis.tn.gov.in/geoserver | TN state GIS spatial layers | OGC endpoints (`/geoserver/ows`, `/geoserver/wfs`) return **HTTP 404** from the public internet — not exposed. | UNAVAILABLE |
| 4 | TN Government Land Management System (TNGLMS) | https://tnglms.in/ | Government-land inventory, cadastral maps, RoR | **Login required**; scope is government land, not private parcels. | UNAVAILABLE |
| 5 | TN Land Record e-Services — Patta / Chitta / A-Register / FMB / **TSLR** extract | https://eservices.tn.gov.in/ | TN land records by District/Taluk/Village/Survey No/Sub-Division | **CAPTCHA** on every extract; HTML forms only, no API, no machine-readable output. | UNAVAILABLE |
| 6 | Open Government Data Platform India | https://data.gov.in/ | Open datasets | **No** ULPIN-linked cadastral parcel-boundary dataset for Tamil Nadu / Chennai is published (only admin/village boundaries). | UNAVAILABLE |

None can be used without crossing a barrier the project constraints forbid
(bypassing authentication, authorization, CAPTCHA, rate limits, or security
mechanisms). Third-party resellers/scrapers (Landeed, mypatta, 1acre, …) are **not
authoritative** and are out of scope for the same reason.

## 3. Chennai administrative & record hierarchy (verified)

- Official land-parcel key: **District → Taluk → Village (Town-Survey block for
  urban land) → Survey Number → Sub-Division Number.**
- **Sholinganallur** and **Anna Nagar** are **taluks** of Chennai district (not
  villages). **Adyar** is a neighbourhood within **Mylapore taluk**.
- Chennai **urban** land is recorded in the **Town Survey Land Register (TSLR)**
  with Town Survey numbers — *not* the rural village Patta/FMB register.
- The prototype's `localities.js` registry records `adminLevel` and
  `recordType: 'TSLR'` accordingly.

## 4. Provider architecture (implemented)

`backend/src/services/landData/`

| File | Responsibility |
| --- | --- |
| `provenance.js` | Vocabulary (`VERIFICATION_STATUS`, `ULPIN_STATUS`), `ULPIN_SPEC`, and `OFFICIAL_SOURCES` — the register above, machine-readable. |
| `governmentProvider.js` | `GovernmentDataProvider`. `describe()` returns the register. `lookup()` returns **`UNAVAILABLE`** unless `GOV_LAND_API_URL` is set to an officially sanctioned endpoint; `fetchFromSource()` is the reserved plug-in point. **Never fabricates a ULPIN or returns geometry it did not receive from a real source.** |
| `demoProvider.js` | `DemoDataProvider`. Serves the synthetic seed parcels; computes a `provenance` block (`verificationStatus: 'DEMO'`, `ulpinStatus: 'DEMO_NOT_OFFICIAL'`, source org/dataset/retrievedAt/disclaimer) at request time — no extra DB fields required. |
| `index.js` | `resolveParcel(query)` runs the chain **Government → Demo** and returns `{ record, provenance, providerChain }`. `listLandSources()` → the register. |

### Verification vocabulary

| Status | Meaning |
| --- | --- |
| `OFFICIAL` | Sourced from an authoritative government system. **Not used yet** — nothing may be tagged OFFICIAL until a real source is wired. |
| `DEMO` | Synthetic prototype data. Every parcel today. |
| `UNVERIFIED` | Real-looking but not confirmed against an official system. |
| `UNAVAILABLE` | Official data exists but is not accessible to this application. |

### Adding a real source later

1. Obtain an **officially sanctioned** endpoint (MoU / API key from DoLR or TN
   Survey & Settlement Dept). It must not require the app to defeat a CAPTCHA/OTP.
2. Set `GOV_LAND_API_URL` in `backend/.env`.
3. Implement `fetchFromSource()` in `governmentProvider.js` to call it and map the
   response to `{ record, provenance: { verificationStatus: 'OFFICIAL', ulpinStatus: 'OFFICIAL', sourceOrganization, sourceDataset, sourceUrl, retrievedAt } }`.
4. Nothing else changes — `resolveParcel` already prefers the government provider,
   and the UI already renders `OFFICIAL` (green "Official ULPIN — Government
   Source") vs `DEMO` ("Demo Parcel ID — Not Official ULPIN").

## 5. API surface added

| Endpoint | Purpose |
| --- | --- |
| `GET /api/land-sources` | The official-source register + `chennai.status = UNAVAILABLE` + `ulpinSpec` + per-locality `adminLevel`/`recordType`. Public — it is documentation, not data. |
| `GET /api/parcels/:ulpin` | Now also returns `provenance` and `providerChain`; `parcel.isOfficialUlpin` normalised to `false`; `parcel.subdivisionNumber` guaranteed. |
| `GET /api/parcels/:ulpin/provenance` | `provenance` + `providerChain` only. |
| `GET /api/gis/parcels` | Feature `properties` now carry `verificationStatus`, `ulpinStatus`, `isOfficialUlpin: false`. |
| `GET /api/parcels?verificationStatus=DEMO` | Optional additive filter. |
| `GET /api/search` | Parcels now also match Survey No / Sub-Division / Locality / Village / Ward / District / Taluk; parcel results carry a `verification` tag; floor results added. |

## 6. UI

- **Parcel sidebar** (`PropertySidebar.jsx` → `ParcelCard`): shows **ULPIN,
  Status, ULPIN Status, Survey Number, Subdivision, Record Type, Locality, Taluk,
  District, Area, Coordinates, Source, Dataset, Retrieved At** with a prominent
  header badge — **"Demo Parcel ID — Not Official ULPIN"** (gold) today, green
  **"Official ULPIN — Government Source"** if/when a real source is wired.
- **Global search** results show an `OFFICIAL` / `DEMO` chip on parcel rows.
- **Settings → "Land Data Sources & Provenance"** lists all six sources, their
  access barriers, and the bold line: *official Chennai ULPIN parcel data is
  UNAVAILABLE via public channels; all parcels shown are DEMO.*

The single Chennai-wide Cesium viewer, area navigation, progressive/LOD loading,
auth/RBAC and MongoDB architecture are unchanged.
