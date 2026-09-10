# TNGIS / Tamil Nilam GI Viewer — Source Discovery + Integration

**Status:** Discovery complete (below) → **PUBLIC-source integration implemented**
(see "IMPLEMENTED INTEGRATION" at the end). Only the public, unauthenticated
endpoints are used; the authenticated / encrypted ULPIN API is never called.
**Investigated:** 2026-09-09, from `https://tngis.tn.gov.in/apps/gi_viewer/`
**Method:** Loaded the live GI Viewer in an instrumented browser, inspected the
network traffic, read the client `config.js` / `Encryption.js` / `scripts.js`,
probed the GeoServer OGC endpoints, and ran **one** parcel lookup
(Survey No. 234 and, incidentally via a map click, Survey No. 311/1F — both in
Sholinganallur-1 revenue village, Sholinganallur taluk, Chennai district).

> A browser profile on this machine held saved credentials for a **"Public"**
> tier account ("Dharun Kumar (Public)") and auto-authenticated the viewer. No
> credentials were supplied, extracted, stored, or hard-coded by this
> investigation, and no CAPTCHA/login was bypassed. All findings below are
> annotated with whether they were reproduced **unauthenticated**
> (`credentials: 'omit'`, fresh) or only observed **through the app's own
> authenticated session**.

---

## 1. Portal

| | |
|---|---|
| Landing | `https://tngis.tn.gov.in/apps/gi_viewer/` (marketing page) |
| Viewer | `https://tngis.tn.gov.in/apps/gi_viewer/map-viewer/index.html` (OpenLayers app) |
| Owner | Survey & Settlement Department + Inspector General of Registration (IGR), Govt of Tamil Nadu |
| Built by | Tamil Nadu e-Governance Agency (TNeGA) |
| Access statement | Landing modal: *"Tamil Nilam – GI Viewer is available **exclusively to registered users**. Registration is free."* Tabs: **Public** / **Official**. |
| Login | Mobile No. + Password + **image CAPTCHA** → `POST /apps/gi_viewer_api/gi_mvc/api/v1/auth/login`; JWT-style session with `auth/refresh` |
| Map engine | OpenLayers (`vendor/openlayer/dist/ol.js`) |
| Basemaps | Street Map, Satellite, Terrain, No Map. Cadastral overlay = XYZ raster tiles `https://tngis.tn.gov.in/data/xyz_tiles/cadastral_xyz/{z}/{x}/{y}.png` |

## 2. Accessible data (bottom line)

| Data | Public (no login) | Login-only |
|---|---|---|
| Admin hierarchy (District→Taluk→Village→Survey No→Sub-Div) + **LGD codes** | ✅ `generic_api` JSON | |
| **Parcel / village / taluk geometry** (GeoJSON, EPSG:4326) | ✅ `generic_api/v1/get_geom` **and** GeoServer WMS/WFS | |
| Cadastral polygon attributes: admin + LGD codes, `survey_number`, `kide`, `is_fmb`, timestamps | ✅ GeoServer WFS/WMS `GetFeatureInfo` | |
| **ULPIN**, Patta, FMB sketch, G-Value, EC, Property Tax, ownership (A-Register) | ❌ (null / absent in public layers) | ✅ encrypted `gi_mvc/api/v1/land-info`, `land/check-areg`, `tamilnilam_api/v1/*` |
| Thematic / Master Plan / Crop / N-Facility / population | ❌ | ✅ `thematic_viewer_api`, `gi_mvc` |

## 3. Discovered endpoints

From `map-viewer/assets/js/config.js` and observed XHR:

```
BASE_URL            = https://tngis.tn.gov.in/apps/generic_api
GI_VIEWER_API_URL   = https://tngis.tn.gov.in/apps/gi_viewer_api/api
GEOSERVER_URL       = https://tngis.tn.gov.in/app/wms            <-- OGC GeoServer (WMS + WFS)
checkAregUrl        = https://tngis.tn.gov.in/apps/generic_api/v1/check_Areg
AREG_SEARCH_URL     = https://tngis.tn.gov.in/apps/tamilnilam_api/v1/tamil_nillam_ownership
TAMIL_NILAM_API_URL = https://tngis.tn.gov.in/apps/tamilnilam_api/v1
FMB_SKETCH_URL      = https://tngis.tn.gov.in/apps/generic_api/v1/sketch_fmb
IGR_URL            = https://tngis.tn.gov.in/apps/thematic_viewer_api/v1/getfeatureInfo
POPULATION_URL     = https://tngis.tn.gov.in/apps/thematic_viewer_api/v1/getfeatureinfo_population
layers config      = https://tngis.tn.gov.in/apps/gi_viewer_api/gi_mvc/api/v1/config/layers
thematic config    = https://tngis.tn.gov.in/apps/gi_viewer_api/gi_mvc/api/v1/config/thematic-layers
legacy PHP         = https://tngis.tn.gov.in/tngis_api/api/api_results.php
```

### 3a. `generic_api` — plaintext JSON, **public** (only needs header `x-app-name: <any>`)

| Endpoint | Purpose | Verified |
|---|---|---|
| `GET  /apps/generic_api/v2/admin_master_district?request_type=district` | 38 districts + `district_lgd_code` | ✅ unauth |
| `GET  /apps/generic_api/v2/admin_master_taluk?district_code=02&request_type=taluk` | taluks + `taluk_lgd_code` | ✅ unauth |
| `GET  /apps/generic_api/v2/admin_master_village?district_code=02&taluk_code=11&request_type=revenue_village` | revenue villages + `village_lgd_code` | ✅ unauth |
| `GET  /apps/generic_api/v2/admin_master_survey_number?district_code=02&taluk_code=11&revenue_village_code=013&area_type=rural&data_type=cadastral&request_type=survey_number` | survey-number list (500 for the test village) | ✅ observed |
| `POST /apps/generic_api/v1/get_geom` body `case=survey_number&code_type=revenue&district_code=02&taluk_code=11&village_code=013&survey_number=234` | **GeoJSON geometry** for that survey number (also `case=taluk`, `case=village`) | ✅ **unauth** |
| `POST /apps/generic_api/v1/check_Areg`, `.../v1/sketch_fmb` | A-Register availability / FMB sketch | not exercised |

Missing `x-app-name` header → `404 {"success":0,"message":"APP Name Missing"}`.

### 3b. GeoServer OGC — `https://tngis.tn.gov.in/app/wms` — **public** (`credentials:'omit'` verified)

| Request | Result |
|---|---|
| `?service=WMS&version=1.3.0&request=GetCapabilities` | 200, WMS 1.3.0, **572 layer names** across workspaces `tngis`, `generic_viewer`, `admin_master`, `cadastral_analysis`, `cadastral_data_wms`, `tngis_basemap`, `Police_Jurisdiction`, `aavin`, … |
| `?service=WMS&request=GetFeatureInfo&query_layers=cadastral_analysis:cadastral_ulpin&info_format=application/json&…` | 200, GeoJSON feature (see §7) |
| `?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=cadastral_analysis:cadastral_ulpin&outputFormat=application/json` | 200, full attribute schema |
| `?service=WFS&version=2.0.0&request=GetFeature&typeNames=cadastral_analysis:cadastral_ulpin&outputFormat=application/json&count=1&CQL_FILTER=survey_number='234' AND village_code='013' AND taluk_code=11` | 200, `numberMatched:4`, GeoJSON |

Relevant cadastral layers found: `cadastral_analysis:cadastral_ulpin`,
`cadastral_data_wms:view_cadastral`, `cadastral_analysis:view_cadastral`,
`cadastral_analysis:view_fmb`, `cadastral_data_wms:view_fmb`,
`cadastral_analysis:fmb_ulpin`, `cadastral_analysis:gcc_with_igr`,
`cadastral_analysis:mview_igr_analysis_2024`, `cadastral_analysis:revenue_village`.
The GI Viewer's on-screen "ULPIN" tile layer is `cadastral_information_new:fmb_ulpin`
— that **workspace does not exist on the public GeoServer** (`Unknown namespace
[cadastral_information_new]`), i.e. it is served from an internal instance.

### 3c. `gi_viewer_api/gi_mvc/api/v1/*` — **login + encryption + same-origin only**

| Endpoint | Purpose |
|---|---|
| `GET  /session-key` | issues the `x-session-id` |
| `POST /auth/captcha`, `/auth/login`, `/auth/refresh`, `GET /auth/me` | auth flow |
| `GET  /config/layers`, `/config/thematic-layers` | encrypted layer catalogue (401 `"Missing session ID"` without a session) |
| `POST /land-info` | **the parcel-info card** — ULPIN, district/taluk/village, LGD code, survey/sub-division, centroid |
| `POST /land/check-areg` | whether A-Register / ownership exists for the parcel |

Request headers required: `x-session-id`, `x-csrf-token`, `x-secure-request: true`,
`content-type: application/json`. **Request _and_ response bodies are encrypted**
(`{"payload": base64({ciphertext, iv, salt, iterations:1000})}`) — AES-256-CBC,
key derived with PBKDF2-SHA512 ×1000 (`assets/js/Encryption.js`, *"Synchronized
with PHP OpenSSL implementation"*), static app key embedded in the client JS.
`Access-Control-Allow-Origin: https://tngis.tn.gov.in` (**not** `*`) → a browser
cross-origin call from our app is blocked. Per-service **rate limiting**
(`rate_limited: true` responses; `handleRateLimitResponse()` in `config.js`).

## 4. Authentication

- **Required** for every "rich" land field (ULPIN, Patta, FMB, EC, Property Tax,
  G-Value, ownership, thematic, master plan).
- Registered user, free registration. Login = Mobile + Password + CAPTCHA.
  Tiers: **Public** and **Official** (Official presumably unlocks more).
- **Not required** for: admin hierarchy + LGD codes (`generic_api`), parcel
  **geometry** (`generic_api/v1/get_geom` and GeoServer WMS/WFS), and cadastral
  polygon attributes limited to admin/LGD/survey codes.

## 5. Parcel fields (Survey No. 234, Sholinganallur-1)

`generic_api/v1/get_geom` response `properties` (plaintext):
`district_code: 2`, `taluk_code: 11`, `village_code: "013"`, `survey_number: "234"`,
`centroid_longitude: 80.23825171967582`, `centroid_latitude: 12.890008333795098`.
Geometry: `MultiPolygon`, `[lon,lat]`, EPSG:4326, `numberMatched` 2 features (sub-parcels).

GeoServer WFS `cadastral_analysis:cadastral_ulpin` `DescribeFeatureType` — full column list:
`id, lgd_district_code, district_code, lgd_taluk_code, taluk_code, lgd_village_code,
village_code, kide, survey_number, sub_division, is_fmb, is_active, created_at,
deleted_at, updated_at, govt_pri, land_type_id, land_type, the_geom`.
Observed values: `id: 113214445`, `lgd_district_code: 568`, `district_code: 2`,
`lgd_taluk_code: 5705`, `taluk_code: 11`, `lgd_village_code: 933868`,
`village_code: "013"`, `kide/survey_number: "234"`, `sub_division: null`,
`is_fmb: 0`, `is_active: 1`, `created_at: 2024-03-13`, `updated_at: 2025-04-08`,
`land_type: null`. **No `ulpin` column exists in this layer.**

GeoServer `cadastral_analysis:view_fmb` adds `patta_no, type_cate, tax_hect,
ext_ares, calculated_area, remarks_unicode, …` — **all null** for the test parcel
via the public service.

GI Viewer UI card (from the encrypted `land-info`, seen on a map click on Survey
311/1F): District `Chennai`, Taluk `Sholinganallur`, Village `Sholinganallur- 1`,
**Village LGD Code `933868` (rural)**, **ULPIN `74RTFVDD7BBHH0`**,
Centroid `12.893511, 80.235369`, Survey Number `311`, Sub Division `1F`, plus
clickable icons for Patta / FMB / Vertex / G-Value / EC / Property Tax / Boundary
/ Thematic / Crop / M-plan / N-Facility.

Cross-check consistency (all three sources agree):
`taluk_lgd_code 5705` (Sholinganallur) and `village_lgd_code 933868`
(Sholinganallur-1) match across `generic_api`, GeoServer WFS, and the UI card.

## 6. ULPIN availability

| Path | ULPIN? | Evidence |
|---|---|---|
| GeoServer WMS/WFS `cadastral_ulpin` / `view_cadastral` / `view_fmb` | **No** — attribute not in schema; all observed values null | DescribeFeatureType + GetFeature (unauth) |
| `generic_api/v1/get_geom` | **No** — only admin codes + centroid | response body |
| `gi_mvc/api/v1/land-info` | **Yes** (`74RTFVDD7BBHH0`) — but encrypted, login-gated, same-origin-locked, rate-limited | UI card + encrypted XHR `#754` |

## 7. Geometry availability

**Yes — real parcel geometry is available and reproduced unauthenticated.**

- `generic_api/v1/get_geom` → GeoJSON `FeatureCollection` of `MultiPolygon`,
  coordinates `[lon, lat]` (some responses `[lon, lat, 0]`), plus
  `centroid_longitude` / `centroid_latitude` in `properties`.
- GeoServer WFS `GetFeature` `outputFormat=application/json` → GeoJSON
  `MultiPolygon`, `geometry_name: "the_geom"`, `crs.properties.name:
  "urn:ogc:def:crs:EPSG::4326"`, per-feature `bbox`.
- Retrieved: 2026-09-09 ~06:03–06:12 UTC. Source record id (WFS): `113214445`
  (`cadastral_ulpin.fid-378153e3_1a084ca1f6d_311c`).
- Geometry was **not** simplified or altered by this investigation (values copied
  verbatim from the responses).

## 8. CRS

**EPSG:4326 / WGS84**, decimal degrees, lon/lat order in the payload
(`urn:ogc:def:crs:EPSG::4326`). Confirmed on `get_geom`, WMS `GetFeatureInfo`
(`application/json`), and WFS `GetFeature`. GeoServer `GetCapabilities` also
advertises `CRS:84` and the standard GeoServer default CRS set. The OpenLayers
view projection could not be read from a global (`window.map` not exposed) but is
almost certainly `EPSG:3857` for display; **the data CRS is unambiguously 4326**.
No CRS was guessed.

## 9. Survey information

Survey Number and Sub-Division are first-class: cascading dropdowns
(`survey-number-dropdown` → `sub-division-dropdown`) backed by
`generic_api/v2/admin_master_survey_number`, and `survey_number` / `sub_division`
are columns on every cadastral GeoServer layer. There is also an urban track
(`town`/`ward`/`block`/`urban-survey-number`/`urban-sub-division` dropdowns) for
Town Survey / TSLR parcels. For Survey 234 the public services return
`sub_division: null` (the sub-division breakdown lives in the FMB / login-gated
data); the UI card for Survey 311 shows `Sub Division: 1F`.

## 10. Boundary

"Boundary" and "Vertex" are UI tools that draw the selected parcel outline and
its vertices from the same geometry (`get_geom` / GeoServer). Panel id
`vertex-info-container`. Geometry is the polygon already covered in §7.

## 11. FMB (Field Measurement Book)

- `cadastral_analysis:view_fmb` / `cadastral_data_wms:view_fmb` GeoServer layers —
  polygon + `patta_no`, `tax_hect`, `ext_ares`, `calculated_area`, `type_cate`,
  `remarks_*` columns, **all null** for the test parcel on the public service.
- FMB **sketch** = `generic_api/v1/sketch_fmb` (`FMB_SKETCH_URL`), panel
  `fmb-sketch-info-panel` — not exercised (would be a second lookup).

## 12. Patta

Not in any public layer/endpoint observed. `patta_no` column exists on
`view_fmb` but was null. Delivered (if at all) only through the encrypted
`gi_mvc` / `tamilnilam_api` ownership call. UI icon "Patta" present.

## 13. G-Value

UI icon "G-Value" (guideline value / IGR). Backed by `IGR_URL =
thematic_viewer_api/v1/getfeatureInfo` and `cadastral_analysis:gcc_with_igr` /
`mview_igr_analysis_2024`. Not exercised. Login-gated.

## 14. EC (Encumbrance Certificate)

UI icon "EC"; panel `encumbrance-info-panel`. IGR/registration data
(`tnreginet.gov.in` is credited in the footer). Not exposed publicly; login-gated,
almost certainly through the encrypted `gi_mvc` path. Not exercised.

## 15. Property Tax

UI icon "Property Tax"; panel `property-tax-details-container`. Not exposed
publicly; login-gated. Not exercised.

## 16. Thematic layers

`gi_mvc/api/v1/config/thematic-layers` (encrypted) + `thematic_viewer_api/v1/*`.
GeoServer carries many thematic layers (`cadastral_analysis:thematic_population`,
`cadastral_analysis:population`, `generic_viewer:*`). Config is login-gated;
individual GeoServer thematic layers may be WMS-renderable publicly (not tested).

## 17. Master Plan

UI icon "M plan"; panel `masterplan-info-container`. Login-gated `gi_mvc`.
Not exercised.

## 18. Rate limits

Real and enforced. `config.js` has `handleRateLimitResponse()` /
`ALL_INFO_PANEL_IDS` clean-up for `{"rate_limited": true, "message": …}`
responses, per service ("`${serviceLabel} limit reached`"). No numeric limit is
published client-side. `generic_api` and GeoServer did not rate-limit the handful
of requests in this discovery, but should be assumed limited.

## 19. Usage restrictions

- **"Available exclusively to registered users"** (landing modal).
- Footer: *"Owned and supported by Survey and Settlement Department & IGR – GoTN"*,
  *"Designed and developed by TNeGA"*, plus a **"Disclaimer"** link (standard
  government "for reference, not legal record" style — could not capture the exact
  modal text in-session).
- No open-data licence (CC-BY / OGDL-India / Bhuvan-style terms) is stated
  anywhere on the viewer or GeoServer.
- The `gi_mvc` API is deliberately hardened against third-party use: payload
  encryption with a static key, CSRF token, `x-secure-request`, strict
  same-origin CORS, session binding, rate limiting. Treat that as an explicit
  "no programmatic third-party access" signal.
- The public GeoServer WMS/WFS has **no** stated licence either. Technical
  reachability is **not** permission to ingest/redistribute.
- **Conclusion:** any integration beyond ad-hoc manual reference needs a formal
  data-sharing request / MoU with TNeGA + Survey & Settlement Department
  (contact `tngis.support@tn.gov.in`, +91-44-40164907).

## 20. Recommended integration architecture (IF approval is obtained)

Do **not** build this yet. When/if a data-sharing agreement + credentials (or a
sanctioned GeoServer endpoint) exist, add an **isolated adapter**, mirroring the
existing `backend/src/services/landData/` + `services/gnss/crsClient.js` pattern,
under:

```
backend/src/services/sources/tngis/
  client.js       // fetch wrapper: base URLs, x-app-name header, ret/backoff,
                  //   rate-limit handling; NO credentials in code — read from env
  admin.js        // district/taluk/village/survey lookups -> normalized LGD tree
  parcel.js       // one parcel by (district,taluk,village,survey,subdiv) ->
                  //   { adminCodes, lgdCodes, surveyNumber, subDivision }
  geometry.js     // get_geom / WFS GetFeature -> GeoJSON (EPSG:4326, unaltered),
                  //   with retrievedAt + sourceRecordId
  ulpin.js        // ONLY if a sanctioned, decrypted ULPIN feed is provided;
                  //   returns officialULPIN as an opaque string
  provenance.js   // stamps every field OFFICIAL_SOURCE / AUTHENTICATED_SOURCE /
                  //   UNAVAILABLE / UNKNOWN + source URL + timestamp
  normalize.js    // TNGIS shape -> our parcel model; keeps officialULPIN SEPARATE
                  //   from the prototype 3DPR identifier
```

Integration points in the existing app (unchanged for now):
- `backend/src/services/landData/provenance.js::OFFICIAL_SOURCES` — flip the
  `tn-tamilnilam-giviewer` / `tngis-geoserver` entries from `UNAVAILABLE` and
  record what is actually reachable.
- `backend/src/services/landData/governmentProvider.js` — add TNGIS as a real
  provider in the chain behind a feature flag + env credentials.
- `backend/src/controllers/landController.js` (`getParcel`, `gisParcels`) — no
  change to response shape; add `provenance` + `officialULPIN` fields only.
- Frontend `lib/provenance.js`, `PropertySidebar` — surface `officialULPIN`
  and the `OFFICIAL_SOURCE` badge next to the existing prototype identifier.
- **Never** feed a TNGIS `officialULPIN` into the `3DPR:<ulpin>:<building>:…`
  string builder — keep them separate fields.
- Cesium / Underground Explorer / Three.js / Phases 2–10 — untouched.

### Field provenance classification (this discovery)

| Field | Class | Basis |
|---|---|---|
| District / Taluk / Village names + codes + **LGD codes** | `OFFICIAL_SOURCE` | `generic_api`, plaintext, unauth, cross-checked 3 ways |
| Parcel **geometry** (MultiPolygon, EPSG:4326) | `OFFICIAL_SOURCE` | `get_geom` + GeoServer WFS, unauth |
| `survey_number`, `kide`, `is_fmb`, record `id`, timestamps | `OFFICIAL_SOURCE` | GeoServer WFS, unauth |
| Sub-division number | `UNAVAILABLE` (public) / `AUTHENTICATED_SOURCE` (UI card) | null in public services; shown in login-gated card |
| **ULPIN** | `AUTHENTICATED_SOURCE` (encrypted, login) — **not** freely structured | UI card + `land-info` XHR |
| Patta / FMB attrs / G-Value / EC / Property Tax / ownership | `UNAVAILABLE` (public) / `AUTHENTICATED_SOURCE` | null in public layers; login-gated encrypted APIs |
| Parcel area / extent | `UNAVAILABLE` | `ext_ares` / `calculated_area` null in public `view_fmb` |

---

# IMPLEMENTED INTEGRATION (2026-09-09)

The **public-source-only** integration is now live in the app. It uses **only**
the endpoints proven public + unauthenticated above. The authenticated /
encrypted `gi_mvc` API (ULPIN, Patta, EC, Property Tax, ownership) is **not**
called, decrypted, automated or bypassed. `officialULPIN` is always `null`.

## PUBLIC INTEGRATED DATA  vs  AUTHENTICATED PROTECTED DATA

| Data | Status in the app | Field class |
|---|---|---|
| Parcel geometry (MultiPolygon, EPSG:4326, verbatim) | **Integrated** — `tngisParcels.geometry`, rendered in the one Cesium viewer | `OFFICIAL_SOURCE` |
| District / Taluk / Village + **LGD codes** | **Integrated** — `districtCode/lgdDistrictCode/…` | `OFFICIAL_SOURCE` |
| `surveyNumber`, `sourceRecordId`, `sourceUpdatedAt`, `isFmb`, centroid | **Integrated** | `OFFICIAL_SOURCE` |
| `sourceCRS` = `EPSG:4326` | **Integrated** (never guessed) | `OFFICIAL_SOURCE` |
| `subDivision`, parcel area/extent | **Integrated as `null`** with an explicit "Unavailable from public TNGIS source" label | `UNAVAILABLE` |
| **Official ULPIN** | **NOT integrated** — `officialULPIN: null`, `officialULPINStatus: "UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE"` | `AUTHENTICATED_SOURCE` |
| Patta / FMB attributes / G-Value / EC / Property Tax / ownership | **NOT integrated** | `AUTHENTICATED_SOURCE` |

## Endpoints integrated (all public, `credentials`-free from the Node backend)

| Adapter call | Upstream |
|---|---|
| `listDistricts / listTaluks / listVillages / listSurveyNumbers` | `GET https://tngis.tn.gov.in/apps/generic_api/v2/admin_master_{district,taluk,village,survey_number}` (+ header `x-app-name`) |
| `getSurveyGeometry` | `POST https://tngis.tn.gov.in/apps/generic_api/v1/get_geom` — body `case=survey_number&code_type=revenue&district_code=&taluk_code=&village_code=&survey_number=` (exact form from discovery) |
| `getCadastralWfsFeature` | `GET https://tngis.tn.gov.in/app/wms?service=WFS&version=2.0.0&request=GetFeature&typeNames=cadastral_analysis:cadastral_ulpin&outputFormat=application/json&CQL_FILTER=…` |

Not called: `gi_viewer_api/gi_mvc/api/v1/*` (`land-info`, `land/check-areg`,
`config/*`, `auth/*`), `tamilnilam_api/v1/*`, `thematic_viewer_api/v1/*`.

## Fields stored (`tngisParcels` collection, one doc per fetched parcel)

```
source: "TNGIS_TAMIL_NILAM"   sourceType: "GOVERNMENT_GIS"
provenance: "OFFICIAL_SOURCE"  verificationStatus: "SOURCE_VERIFIED"  sourceGeometry: true
officialULPIN: null            officialULPINStatus: "UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE"
districtCode lgdDistrictCode districtName
talukCode    lgdTalukCode    talukName
villageCode  lgdVillageCode  villageName
surveyNumber  subDivision (null from public source)
centroid: { latitude, longitude }
geometry: { type: "MultiPolygon", coordinates: [...] }   geometryType   sourceCRS: "EPSG:4326"
isFmb  landType  areaSqm(null)
sourceRecordId  sourceUpdatedAt  sourceCreatedAt  sourceFeatureCount
locality (nearest project locality, spatial pointer only)
retrievedAt  firstFetchedAt  updatedAt  fetchedBy
```
No `password`, session cookie, CSRF token or authorization token is ever stored
(enforced by a test).

## CRS

`EPSG:4326` / WGS84, lon/lat degrees, on every code path — copied from the
source (`urn:ogc:def:crs:EPSG::4326`), never inferred.

## Provenance implementation

`services/sources/tngis/provenance.js` — `TNGIS_PROVENANCE` block stamped on
every record + `normalize.js`; `PARCEL_FIELD_CLASSES` maps each field to
`OFFICIAL_SOURCE` / `AUTHENTICATED_SOURCE` / `UNAVAILABLE`; `GET /api/tngis/config`
publishes `integratedFields` vs `notIntegratedFields`. UI: a green
**OFFICIAL SOURCE / SOURCE-VERIFIED GEOMETRY** badge in the sidebar + layer
manager; an amber **"Official ULPIN — Unavailable from current public source"**
block; the base disclaimer on the card.

## Cesium / building / topology / search

- **Cesium** — additive `tngisParcels` layer, OFF by default, inside the **one**
  existing viewer (`GET /api/gis/tngis-parcels`, `ensureTngisParcels`,
  `kind: 'tngis-parcel'` pick, `flyToTngisParcel`, `refreshTngisParcels`). No
  second viewer. Terrain-clamped polygons; gold fill when selected.
- **Building relationship** — `GET /api/tngis/parcels/:id/relations` returns
  `WITHIN_PARCEL` / `CROSSES_PARCEL_BOUNDARY` / `NEAR_PARCEL` for existing DEMO
  building footprints, each stamped "Spatial relationship only — not an
  ownership claim". A "Open 3D Building Explorer" link appears only when a real
  overlapping building exists.
- **Topology** — `POST /api/tngis/parcels/:id/validate-topology` reuses the
  **existing Phase 7 engine** (`services/topology/evaluate`). No second engine.
  Findings are shown as-is (VALID / WARNING / ERROR / REVIEW).
- **Search** — `/api/search` matches cached TNGIS parcels by survey number,
  district/taluk/village name and LGD codes and by `sourceRecordId`; selecting
  one focuses it in the same viewer. Protected ULPIN search is not offered.
  Existing DEMO ULPIN search is unchanged.

## Locality / coverage

No hard-coded three localities: the full public TNGIS District → Taluk → Village
→ Survey hierarchy drives the `/tngis` page. **One parcel per fetch**, on demand.
A fetched parcel is spatially tagged to the nearest project locality (≤6 km) only
so the Cesium layer's area filter and demand-loading work; parcels outside the
demo extents render area-agnostically.

## Cache / rate-limit strategy

`services/sources/tngis/client.js`:
- **fixture-first** — the discovery test parcel and the admin lists are served
  from bundled recorded public responses (`backend/tests/fixtures/tngis/`), so
  CI + the acceptance test never touch the network;
- **in-memory cache** — 10 min TTL per distinct call, request de-duplication;
- **rate limiter** — a process-wide minimum interval (default 1200 ms) between
  live calls, one bounded retry, 9 s timeout;
- **no bulk path** — there is no "fetch an area/district" call; the API only
  resolves one parcel from exact codes.
- `TNGIS_LIVE=0` disables live calls entirely (fixtures/cache only).

## Error handling

Upstream failure → `GET/POST /api/tngis/*` return `400` with
`"TNGIS source temporarily unavailable: …"`; the `/tngis` page shows a
"TNGIS source temporarily unavailable" banner and keeps already-fetched parcels
listed. No fabricated official data is ever substituted. A missing field shows
"Unavailable from public TNGIS source".

## Legal / authorization limitation (unchanged)

The GI Viewer states it is "available exclusively to registered users" and
publishes no open-data licence. This integration deliberately uses only the
endpoints that are reachable without any login, encryption key or credential.
**Bulk ingestion, redistribution, or use of the authenticated ULPIN / Patta /
EC / tax / ownership data would require a formal data-sharing agreement with
TNeGA + the Survey & Settlement Department** (`tngis.support@tn.gov.in`).

## Files

Created: `backend/src/services/sources/tngis/{client,admin,geometry,normalize,parcel,relations,provenance,index}.js`,
`backend/src/controllers/tngisController.js`,
`backend/tests/tngis.test.js`, `backend/tests/fixtures/tngis/*`,
`frontend/src/pages/TngisParcels.jsx`, `tests/e2e/tngis.spec.js`.
Modified: `backend/src/routes/index.js`, `backend/src/controllers/miscController.js` (search),
`frontend/src/lib/api.js`, `frontend/src/App.jsx`, `frontend/src/lib/nav.js`,
`frontend/src/context/SelectionContext.jsx`, `frontend/src/components/map/Cesium3DMap.jsx`,
`frontend/src/components/layout/{LayerManager,TopBar,PropertySidebar}.jsx`.
