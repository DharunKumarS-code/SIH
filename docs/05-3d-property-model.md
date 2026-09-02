# 05 — 3D Property Model & Prototype Identifier

## The innovation

The conventional cadastre stops at the 2D parcel. LAND STACK extends it:

```
2D Parcel (ULPIN)
  └── Building
        └── Floor
              └── Unit / Apartment  ← independently identified, visualised, governed
```

## Identifiers

| Level | Identifier | Authority | Example |
| --- | --- | --- | --- |
| Parcel | **ULPIN** | Treated as the officially issued land-parcel id (prototype) | `TN-CHN-123456789` |
| Building | Building segment | Derived | `B01` |
| Floor | Floor segment (`F00` = Ground) | Derived | `F02` |
| Unit | **Prototype 3D Property Identifier** | Derived — **never an official ULPIN** | `TN-CHN-123456789-B01-F02-U201` |

### Composition (`backend/src/services/idService.js`)

```
<ULPIN>-B<bb>-F<ff>-U<unit>
        │      │      └ printed apartment number (e.g. 201), not re-padded
        │      └ 2-digit floor, F00 = Ground
        └ 2-digit building index
```

`makeProtoPropertyId(ulpin, buildingNumber, floorNumber, apartmentNumber)` and
`parseProtoPropertyId(id)` are the single source of truth. The UI always labels
these strings **“Prototype 3D Property Identifier”**.

## 3D representation

- **Building shell**: one extruded footprint polygon (`baseElevationM` →
  `heightM`). Shown at overview; hidden / faded when you drill into the building
  so its units are visible (LoD switch).
- **Apartment unit**: one **separate Cesium entity** per unit — its footprint
  cell (from a per-floor grid) extruded between `baseHeight` and `topHeight`.
  Carries `propertyId`, floor, area, owner, status, usage in `entity.properties`.
- **Common areas**: separate entities (`ownership: "COMMON AREA"`), attached to
  the building, never held as individual apartment ownership.

## Selection behaviour (spec §8, §32)

| Action | Effect |
| --- | --- |
| Click a unit | highlight only that unit (gold), dim siblings, keep the building shell as context, open the right sidebar, update the explorer, fly the camera to the unit |
| **Isolate Unit** | hide every other unit and building; keep the selected unit prominent |
| Exit Isolation / Reset View | restore building / overview |
| Floor selected | show only that floor's units + the floor plan |

## Performance strategy (spec §45)

- Building shells loaded once; **unit entities lazy-loaded per building** on first
  selection and cached.
- `scene.requestRenderMode = true` — the scene only re-renders on change.
- Visibility is toggled (`entity.show`) rather than recreating geometry.
- ~60–120 unit entities per building; the full parcel stays well within Cesium's
  entity budget.

## Toward Blender / GLB / BIM

Because every unit is an addressable entity with a stable id and a footprint +
height band, a custom GLB (Blender) or IFC model can later be swapped in per
unit without changing the data model or the API.
