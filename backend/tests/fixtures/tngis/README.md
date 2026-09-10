# TNGIS fixtures — recorded PUBLIC responses (discovery 2026-09-09)

These are verbatim (geometry trimmed for size where noted) responses from the
**public, unauthenticated** TNGIS endpoints recorded during the source-discovery
phase. They let the adapter and its tests run **offline / deterministically** and
guarantee that repeated lookups of the discovery test parcel never re-hit the
government server.

Sources:
- `districts.json`      — `GET  https://tngis.tn.gov.in/apps/generic_api/v2/admin_master_district?request_type=district`
- `taluks-02.json`      — `GET  .../admin_master_taluk?district_code=02&request_type=taluk`
- `villages-02-11.json` — `GET  .../admin_master_village?district_code=02&taluk_code=11&request_type=revenue_village`
- `surveys-02-11-013.json` — `GET  .../admin_master_survey_number?district_code=02&taluk_code=11&revenue_village_code=013&area_type=rural&data_type=cadastral&request_type=survey_number` (list trimmed to a sample)
- `geom-02-11-013-234.json` — `POST .../generic_api/v1/get_geom` body `case=survey_number&code_type=revenue&district_code=02&taluk_code=11&village_code=013&survey_number=234`
- `wfs-cadastral-02-11-013-234.json` — GeoServer `WFS 2.0.0 GetFeature` on `cadastral_analysis:cadastral_ulpin`, `CQL_FILTER=survey_number='234' AND village_code='013' AND taluk_code=11`

NONE of the authenticated / encrypted endpoints (`gi_mvc/*`, `land-info`,
ownership, patta, EC, property-tax) were recorded or are used.
