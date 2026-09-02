# 04 — GIS Standards

## Formats

- **GeoJSON** (RFC 7946) for all vector exchange — `/api/gis/*` returns
  `FeatureCollection`s. Coordinates are `[lon, lat]` (WGS84 / EPSG:4326).
- **Extruded polygons** for 3D: each building footprint and each apartment unit
  is a `Polygon` plus `baseHeight` / `topHeight` (metres, ellipsoid-relative),
  which the CesiumJS client extrudes.
- **LineString** for roads and utility networks.

## Coordinate reference

| Purpose | CRS |
| --- | --- |
| Storage / API | EPSG:4326 (WGS84 lon/lat) |
| 3D rendering | Cesium ECEF (client converts from lon/lat/height) |
| Local metre offsets in the seed generator | tangent-plane approximation at the Sholinganallur base point |

## Demonstration area

Chennai — OMR / Sholinganallur, Zone 15. Base point `80.22705 E, 12.90045 N`.
The primary parcel `TN-CHN-123456789` (~270 m × 250 m) carries five apartment
blocks B01–B05.

## OGC / interoperability alignment (design intent)

- Feature model and attribute separation follow **OGC Simple Features**.
- The parcel→building→floor→unit containment and the ownership / common-area
  distinction are **LADM-compatible in terminology** (see `05` and `34`).
- 3D building/unit representation is conceptually aligned with **CityGML LoD1**
  (prismatic buildings) and can be exported toward **IFC/BIM** at unit level.
- No formal OGC-service (WFS/WMS/3D Tiles) endpoint is implemented in the
  prototype — the GeoJSON REST endpoints are the integration surface.

> Compliance with the above standards is **not certified**; the architecture is
> designed to adopt them.

## Layer catalogue

Base · Governance · Utility & Infrastructure · Environment & Restrictions ·
Administrative Boundaries · 3D Property — see `docs/09` and the in-app GIS Layer
Manager. Every layer toggle controls real entity visibility.
