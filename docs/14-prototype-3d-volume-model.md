# 14 — Prototype 3D Volume Model & Geometric Validation (Phase 2)

> **Prototype, not a legal record.** The bounded 3D volumes described here are
> synthetic **DEMO** geometry derived from the existing 2D footprints. Volume /
> Building / Floor / Unit IDs are **application-level prototype identifiers** —
> **never official ULPINs**. The parent parcel's ULPIN provenance (Phase 1 —
> OFFICIAL / DEMO / UNVERIFIED / UNAVAILABLE) is unchanged; a volume's `source`
> mirrors that parcel's `verificationStatus` (**`DEMO`** today).

Code: `backend/src/services/geometry3d/` · `frontend/src/lib/volume.js` ·
floor-volume rendering in `frontend/src/components/map/Cesium3DMap.jsx`.

---

## 1. Coordinate assumptions

The rest of the app already uses:

| Axis | Meaning | Units |
| --- | --- | --- |
| **X** | WGS-84 **longitude** | **degrees** (consumed by `Cesium.Cartesian3.fromDegreesArray`) |
| **Y** | WGS-84 **latitude** | **degrees** |
| **Z** | height above a local ground datum | **metres** (`GROUND_ELEV = 8`, `FLOOR_HEIGHT = 3.2`, unit `baseHeight`/`topHeight`) |

Phase 2 does **not** introduce a new CRS and does **not** reinterpret degrees as
metres. A `volume` block stores `xmin/xmax` as **lon degrees**, `ymin/ymax` as
**lat degrees**, `zmin/zmax` as **metres** — exactly what Cesium already renders.

**Metric normalisation (validation only).** Containment and overlap checks need
metres. Degree deltas are converted with the same tangent-plane factors used in
`backend/src/data/geo.js`:

```
M_PER_DEG_LAT = 111320
metres_east  = (lon - lon_ref) × M_PER_DEG_LAT × cos(lat_ref)
metres_north = (lat - lat_ref) × M_PER_DEG_LAT
```

`toMetreBox(volume, ref)` measures from a **shared reference origin** (`ref`).
Two boxes compared against each other **must** share the same `ref` (the outer
object's centre) — otherwise the ~8.7 × 10⁶ absolute magnitude near longitude 80°
amplifies tiny per-box scale differences into ~1 m of spurious offset.

---

## 2. `volume` schema

```json
{
  "volumeId": "V0201",
  "xmin": 80.226403, "xmax": 80.226486,
  "ymin": 12.899829, "ymax": 12.899912,
  "zmin": 14.4, "zmax": 17.3,
  "geometryVersion": 1,
  "source": "DEMO",
  "prototype": true,
  "label": "Prototype 3D Geometry",
  "status": "VALID"
}
```

Built by `volumeFromFootprint(geometry, zmin, zmax, { volumeId, source })`:
`bbox()` of the footprint's outer ring → `xmin..ymax`; `zmin/zmax` from the
object's heights. `status` is filled by the validator.

- **Unit** volume = the unit's own footprint + `baseHeight`/`topHeight`.
- **Floor** volume = the **parent building** footprint + the floor's
  `baseHeight`/`topHeight` (floors have no footprint of their own).
- **Building** volume = the building footprint + `baseElevationM .. baseElevationM + heightM`.

## 3. Deterministic prototype `volumeId`

Stable across reboots, obviously not a ULPIN:

| Level | Pattern | Example |
| --- | --- | --- |
| Unit | `V<ff><nn>` (floor number, last 2 of apartment number) | floor 02 / apt 201 → `V0201` |
| Floor | `VF<ff>` | `VF02` |
| Building | `VB<bb>` | `VB01` |

`deriveVolumeId()` / `parseVolumeId()` in `volume.js`. Global search accepts a
`V…` token and resolves it to the existing unit/floor navigation.

## 4. Geometric tolerance

```
GEOMETRY_TOLERANCE_M = 0.5   // horizontal containment / overlap slack, metres
Z_TOLERANCE_M        = 0.05  // vertical (floor-range) slack, metres
```

**Why:** the demo unit footprints are inset ~8 % inside their grid cell and demo
building footprints hug the parcel edge, so exact floating-point containment
always fails. The tolerance absorbs that modelling slack **without masking real
errors** — a unit poking > 0.5 m outside its building is still flagged. Exact
float equality is never used.

Containment misses are then graded by how far out (`WARN_BAND_M`):

| Rule | WARNING up to | beyond → |
| --- | --- | --- |
| `UNIT_INSIDE_BUILDING` | 2.0 m | ERROR |
| `BUILDING_INSIDE_PARCEL` | 6.0 m | ERROR |

(Parcels/buildings are coarse cadastral approximations, so the building→parcel
band is wider. Two of the three demo parcels contain one building that overhangs
the demo parcel edge by ~3 m → that parcel rolls up to **WARNING**, which is the
honest result.)

## 5. Validation rules (deterministic — NOT AI)

`validateParcelVolumes({ parcel, buildings, floors, units })` and
`validateUnitVolume(unit, building)` each yield
`VALID | WARNING | ERROR` per check, plus a worst-of rollup and per-issue
`{ level, id, status, rule, message }`.

| # | `rule` | Check | Fail |
| - | --- | --- | --- |
| 1 | `Z_MIN_LT_Z_MAX` | `zmin < zmax` | ERROR |
| 2 | `HEIGHT_POSITIVE` | `zmax − zmin > 0` | ERROR |
| 3 | `HEIGHT_WITHIN_BOUNDS` | floor/unit storey height in `[2.0, 6.0] m` (buildings exempt) | WARNING |
| 4 | `VOLUME_COORDS_PRESENT` | all six bounds finite | ERROR |
| 5 | `UNIT_INSIDE_BUILDING` | unit metric bbox ⊆ building bbox (tolerance, graded) | WARNING / ERROR |
| 6 | `BUILDING_INSIDE_PARCEL` | building metric bbox ⊆ parcel bbox (tolerance, graded) | WARNING / ERROR |
| 7 | `FLOOR_RANGE_ORDER` | floors sorted by number have non-overlapping z-ranges (`> Z_TOLERANCE_M`) | WARNING |
| 8 | `UNIT_NO_OVERLAP` | units on the same floor don't overlap horizontally (`> tol²` m²) | WARNING |

## 6. API (all additive, backward-compatible, computed at request time)

| Endpoint | Phase 2 addition |
| --- | --- |
| `GET /api/units/:propertyId` | `unit.volume`, top-level `volume`, `validation`, `hierarchy.unit.volumeId` |
| `GET /api/floors/:floorId` | `floor.volume`; each `units[i].volume` |
| `GET /api/buildings/:buildingId` | `building.volume`; each `floors[i].volume` |
| `GET /api/parcels/:ulpin` | `volumes: { buildings, floors, units }` counts + `validation` rollup |
| `GET /api/parcels/:ulpin/volumes` | **new** — full `volumes: { buildings[], floors[], units[] }` + `validation` (sibling of `/provenance`) |
| `GET /api/gis/units` | feature `properties.volume` (6 bounds + id + version + source + status) |
| `GET /api/search?q=V0201` | resolves a prototype Volume ID to its unit/floor |

No database migration and **no reseed** — every volume is derived from existing
`geometry` + `baseHeight`/`topHeight`. Records without volume data keep working.

## 7. Cesium

One viewer, unchanged architecture. Units/common areas already render as extruded
polygons (bottom elevation, top elevation, vertical sides, individually
pickable). Phase 2 adds a **prototype floor volume**: the building footprint
extruded between the floor's `zmin`/`zmax`, translucent blue, built once per
`(building, floor)` and cached (`floorVolumeRef`), shown only while that floor is
selected, gated by the existing LOD / area / `layers.floors3d` logic. The slab is
click-through (`drillPick`) so every apartment underneath stays selectable.
Selection → isolation → reverse → return to building / area / Chennai overview all
use the existing mechanisms.

## 8. Limitations

- Volumes are **axis-aligned bounding boxes** of the demo footprints, not true
  prisms — non-rectangular footprints are approximated. "Est. footprint / volume"
  in the sidebar are bbox estimates; the authoritative carpet/built-up areas from
  the demo record are shown alongside and labelled.
- Z values come from a uniform `FLOOR_HEIGHT` model, not survey data.
- No official 3D survey, LiDAR, DEM/DSM, GNSS or building-approval geometry is
  used or implied. Nothing here is a legal or standardised 3D cadastral record.
