import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useSelection } from '../../context/SelectionContext.jsx'
import { applyGrading } from '../../lib/cesiumGrading.js'
import { api } from '../../lib/api.js'
import { PARCEL_ULPIN, DEFAULT_AREA_ID, CHENNAI_CITY_VIEW, COIMBATORE_DEMO_PROPERTY } from '../../lib/constants.js'
import { LAND_USE_COLORS } from '../../lib/format.js'

const CESIUM_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN

const ring = (geometry) => {
  const coords = geometry?.coordinates?.[0] || []
  const flat = []
  for (const [lon, lat] of coords) flat.push(lon, lat)
  return flat
}
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// Deterministic tone pick from COL.buildingShellVariants, keyed by buildingId
// — same building always gets the same tone, no randomness/flicker on reload.
function shellVariantIndex(id, variantCount) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % variantCount
}

// Camera-height bands that gate progressive detail. ONE scene, ONE camera —
// selecting an area only moves the camera and flips visibility.
const LOD = { CITY: 5200, AREA: 750 } // > CITY: city  | CITY..AREA: area  | < AREA: building/unit

// TNGIS Chennai-wide viewport (BBOX) parcel loader tuning.
const TNGIS_VIEWPORT_MAX_CAM_M = 4200 // only pull parcel geometry when this close
const TNGIS_VIEWPORT_LIMIT = 250 // per-viewport server cap (server hard cap is 400)
const TNGIS_MAX_ENTITIES = 1400 // resident TNGIS parcel entities before oldest are evicted

const COL = {
  // Solid, near-opaque neutral massing (was a translucent 0.28 ghost fill —
  // read as a flat map overlay rather than a 3D city). A small deterministic
  // tone set (below) gives buildings gentle, professional separation without
  // turning into a gaming palette.
  buildingShell: Cesium.Color.fromCssColorString('#aab2c0').withAlpha(0.95),
  buildingShellSel: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.18),
  unit: Cesium.Color.fromCssColorString('#9aa7bd').withAlpha(0.92),
  unitCommercial: Cesium.Color.fromCssColorString('#d99b3f').withAlpha(0.9),
  unitSelected: Cesium.Color.fromCssColorString('#f2b807'),
  unitDim: Cesium.Color.fromCssColorString('#9aa7bd').withAlpha(0.08),
  common: Cesium.Color.fromCssColorString('#38c9d6').withAlpha(0.5),
  outline: Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.75),
  // Deterministic, near-neutral tone set for building massing — picked per
  // buildingId (see buildingShellVariant()) so adjacent buildings in a dense
  // block read as distinct structures rather than one fused slab.
  buildingShellVariants: ['#aab2c0', '#a2acb9', '#b3bac4', '#9fa9b7'].map((c) =>
    Cesium.Color.fromCssColorString(c).withAlpha(0.95),
  ),
  floorVolume: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.14), // prototype floor volume slab
  floorVolumeLine: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.8),
  areaFill: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.05),
  areaFillActive: Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.08),
  areaLine: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.7),
  areaLineActive: Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.9),
  aiBuilding: Cesium.Color.fromCssColorString('#f2822f').withAlpha(0.30),   // AI_DEMO candidate building
  aiBuildingLine: Cesium.Color.fromCssColorString('#f2822f').withAlpha(0.9),
  aiReview: Cesium.Color.fromCssColorString('#e4566e').withAlpha(0.30),     // needs review
  aiFloorUnit: Cesium.Color.fromCssColorString('#38c9d6').withAlpha(0.34),  // Phase 4 AI floor-plan unit
  aiFloorUnitLine: Cesium.Color.fromCssColorString('#38c9d6').withAlpha(0.9),
  aiFloorUnitSel: Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.8),
  // Phase 5 — height-quality overlay for buildings with an ACCEPTED
  // elevation-derived height (LiDAR/DSM-DEM), coloured by confidence.
  elevationHigh: Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.4),
  elevationMedium: Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.4),
  elevationLow: Cesium.Color.fromCssColorString('#e4566e').withAlpha(0.4),
  // Phase 6 — GNSS/CORS control points, coloured by validationStatus. A
  // distinct magenta/violet family so they never read as a parcel, building,
  // AI overlay or DEM/DSM layer.
  gnssValid: Cesium.Color.fromCssColorString('#c084fc'),
  gnssWarning: Cesium.Color.fromCssColorString('#a855f7'),
  gnssError: Cesium.Color.fromCssColorString('#7e22ce'),
  gnssSelected: Cesium.Color.fromCssColorString('#f2b807'),
  // TNGIS / Tamil Nilam — public-source (OFFICIAL_SOURCE) parcel geometry. A
  // distinct government teal-green so it never reads as a DEMO parcel.
  tngisParcel: Cesium.Color.fromCssColorString('#0f766e').withAlpha(0.20),
  tngisParcelSel: Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.28),
  tngisParcelLine: Cesium.Color.fromCssColorString('#0f766e').withAlpha(0.95),
  // TNGIS building/house footprints — vertical DEMO_VISUAL_HEIGHT extrusion
  // (see TNGIS_DEMO_VISUAL_HEIGHT_M below). Same neutral ash-gray "placeholder
  // mass" language as the selected-parcel DEMO_VISUALIZATION extrusion — never
  // presented as a surveyed/official building volume. The ground boundary
  // keeps the teal tngisParcelLine/tngisParcelSel above so the footprint's
  // official-source origin stays visually identifiable.
  tngisBuilding: Cesium.Color.fromCssColorString('#9a9ea6').withAlpha(0.88),
  tngisBuildingSel: Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.55),
  tngisBuildingOutline: Cesium.Color.fromCssColorString('#55565c').withAlpha(0.9),
  // Phase 8 — underground infrastructure, coloured by utility type. An
  // earthy / amber family so it never reads as a parcel, building, AI overlay,
  // DEM/DSM or GNSS layer. Selected = the same gold used everywhere else.
  infra: {
    WATER_PIPELINE: Cesium.Color.fromCssColorString('#4fa9ff'),
    SEWER_PIPELINE: Cesium.Color.fromCssColorString('#9b7b4f'),
    STORMWATER_DRAIN: Cesium.Color.fromCssColorString('#4fbf9f'),
    ELECTRICAL: Cesium.Color.fromCssColorString('#f2b807'),
    TELECOM: Cesium.Color.fromCssColorString('#a86fd1'),
    GAS: Cesium.Color.fromCssColorString('#e4566e'),
    TUNNEL: Cesium.Color.fromCssColorString('#c9925b'),
    METRO: Cesium.Color.fromCssColorString('#d98a3f'),
    UTILITY_DUCT: Cesium.Color.fromCssColorString('#8b97ad'),
    MANHOLE: Cesium.Color.fromCssColorString('#cbb26b'),
    CHAMBER: Cesium.Color.fromCssColorString('#b5895b'),
    OTHER: Cesium.Color.fromCssColorString('#9aa7bd'),
  },
  infraSelected: Cesium.Color.fromCssColorString('#f2b807'),
  infraUnknownDepth: Cesium.Color.fromCssColorString('#8b97ad').withAlpha(0.5),
  // Coimbatore — the ONE demonstration property. A distinct emerald so it
  // never reads as a Chennai parcel/building/AI/GNSS/infrastructure/TNGIS
  // layer; gold on select, matching every other selected entity in the scene.
  coimbatoreDemo: Cesium.Color.fromCssColorString('#059669'),
  coimbatoreDemoSelected: Cesium.Color.fromCssColorString('#f2b807'),
  // Temporary DEMO_VISUALIZATION extrusion for the selected land parcel — a
  // neutral ash-gray so it reads as "placeholder mass", never as a real
  // surveyed building. Not used for any other layer.
  parcelDemoExtrusion: Cesium.Color.fromCssColorString('#8c8c91').withAlpha(0.75),
  parcelDemoExtrusionOutline: Cesium.Color.fromCssColorString('#55565c').withAlpha(0.9),
}

// Underground records without a supplied depth are drawn just below the surface
// with a faded, dashed style so the UI NEVER visually implies that an unknown
// depth is a real surveyed one (spec section 27).
const UNKNOWN_DEPTH_Z = 7.0

// AI buildings have no surveyed height — extrude with a clearly-flagged
// ESTIMATED / DEMO value only (heightStatus stays UNAVAILABLE in the record).
const ESTIMATED_AI_HEIGHT_M = 24
// AI floor-plan units without a floor z-range: a thin ESTIMATED/DEMO slab only.
const ESTIMATED_AI_UNIT_HEIGHT_M = 3

// TNGIS building/house footprints have no official height in the public
// geometry TNGIS exposes (survey-number polygon only — see
// docs/13-official-ulpin-data-investigation.md) — extrude every footprint by
// this fixed DEMO_VISUAL_HEIGHT so it reads as a genuine elevated 3D
// structure instead of a flat map marking. Never surveyed/official; never
// persisted or presented as a certified building/cadastral volume.
const TNGIS_DEMO_VISUAL_HEIGHT_M = 8

export function Cesium3DMap() {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const gradingCleanupRef = useRef(null)
  const handlerRef = useRef(null)
  const lodCleanupRef = useRef(null)
  const groupsRef = useRef({}) // layerKey -> Entity[]  (each entity tagged __area)
  const unitEntitiesRef = useRef(new Map()) // propertyId -> Entity
  const floorVolumeRef = useRef(new Map()) // `${buildingId}|${floorNumber}` -> Entity (prototype floor volume)
  const floorRangesRef = useRef(new Map()) // buildingId -> [{ floorNumber, baseHeight, topHeight, floorId }]
  const loadedBuildingsRef = useRef(new Set())
  const loadedAreasRef = useRef(new Set()) // areaId that has parcels+shells loaded
  const loadedBuildingAreasRef = useRef(new Set()) // areaId whose city-wide 3D buildings are loaded
  const buildingShellRef = useRef(new Map()) // buildingId -> Entity
  const parcelEntityRef = useRef(new Map()) // ulpin -> Entity
  const selectedParcelExtrusionRef = useRef(null) // the ONE temporary ash-gray DEMO_VISUALIZATION extrusion, for whichever parcel is currently selected
  const aiBuildingsRef = useRef(new Map()) // aiBuildingId -> Entity (Phase 3, AI_DEMO)
  const aiFloorUnitsRef = useRef(new Map()) // aiFloorUnitId -> Entity (Phase 4, AI_DEMO)
  const gnssPointsRef = useRef(new Map()) // controlPointId -> Entity (Phase 6, GNSS/CORS DEMO)
  const infraEntitiesRef = useRef(new Map()) // infrastructureId -> Entity (Phase 8, underground infrastructure)
  const tngisParcelRef = useRef(new Map()) // sourceRecordId -> Entity (TNGIS / Tamil Nilam public-source parcels)
  const coimbatoreEntityRef = useRef(null) // the ONE Coimbatore demonstration property Entity — always resident, own layer
  // Coimbatore sits ~400-450m above the ellipsoid (unlike coastal Chennai, near
  // sea level) — a flat small height there would bury the entity/camera inside
  // real World Terrain. Sampled once from the actual terrain provider (see
  // buildCoimbatoreDemoProperty); this fallback is only used if that sample
  // hasn't resolved yet.
  const coimbatoreGroundHeightRef = useRef(411)
  const tngisAbortRef = useRef(null) // in-flight viewport (BBOX) request — cancelled on the next camera move
  const tngisLastBboxRef = useRef('') // last viewport key loaded (2dp) — skip a redundant refetch
  const tngisMoveTimerRef = useRef(null) // debounce timer for the viewport loader
  const cityAreaRef = useRef(new Map()) // areaId -> { fill, line }
  const localityCacheRef = useRef(new Map()) // 'building:<id>' | 'infra:<id>' | 'parcel:<ulpin>' -> locality id
  const activeAreaRef = useRef(DEFAULT_AREA_ID)
  const lodRef = useRef('area')
  const cityViewRef = useRef(false) // true while the camera is parked at the Chennai overview

  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  // City-wide 3D building coverage counters — computed from ACTUAL entity state,
  // never a fabricated number (spec section 26).
  const [buildingStats, setBuildingStats] = useState({ available: 0, loaded: 0, visible: 0 })
  // TNGIS Chennai-wide parcel coverage — all from ACTUAL state, never fabricated.
  // `loaded`/`visible` are resident entities; `inViewFromSource` is what the
  // public GeoServer WFS reported for the last viewport (numberMatched).
  const [tngisStats, setTngisStats] = useState({ loaded: 0, visible: 0, inViewFromSource: null, truncated: false })

  function recomputeTngisStats(meta) {
    const group = groupsRef.current.tngisParcels || []
    let visible = 0
    for (const ent of group) if (ent?.show) visible += 1
    setTngisStats((prev) => {
      const next = {
        loaded: tngisParcelRef.current.size,
        visible,
        inViewFromSource: meta && Number.isFinite(meta.numberMatched) ? meta.numberMatched : prev.inViewFromSource,
        truncated: meta ? !!meta.truncated : prev.truncated,
      }
      return prev.loaded === next.loaded && prev.visible === next.visible
        && prev.inViewFromSource === next.inViewFromSource && prev.truncated === next.truncated
        ? prev : next
    })
  }

  function recomputeBuildingStats() {
    const loaded = buildingShellRef.current.size
    let visible = 0
    for (const ent of buildingShellRef.current.values()) if (ent.show) visible += 1
    const available = (selRef.current.localities || []).reduce(
      (s, l) => s + (Number(l.counts?.buildings) || 0),
      0,
    )
    setBuildingStats((prev) => {
      const next = { available: Math.max(available, loaded), loaded, visible }
      return prev.available === next.available && prev.loaded === next.loaded && prev.visible === next.visible
        ? prev
        : next
    })
  }

  const sel = useSelection()
  const selRef = useRef(sel)
  selRef.current = sel

  // The viewer if it is still alive, else null. Cesium can be destroyed while an
  // async pipeline step (fetch / flyTo) is mid-await — e.g. the user navigates
  // away from /map — so async code must re-check this after every await before
  // touching `viewer.scene` / `viewer.entities`.
  function liveViewer() {
    const v = viewerRef.current
    return v && !v.isDestroyed() ? v : null
  }

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    let cancelled = false
    let viewer

    async function init() {
      if (!CESIUM_TOKEN) {
        setError('Cesium ion token missing — set VITE_CESIUM_ION_TOKEN in frontend/.env')
        return
      }
      Cesium.Ion.defaultAccessToken = CESIUM_TOKEN

      try {
        viewer = new Cesium.Viewer(hostRef.current, {
          animation: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          timeline: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
        })
      } catch {
        setError('3D engine failed to initialise (WebGL unavailable?).')
        return
      }
      if (cancelled) {
        viewer.destroy()
        return
      }
      viewerRef.current = viewer
      window.viewer = viewer
      window.Cesium = Cesium
      viewer.scene.requestRenderMode = true
      viewer.scene.maximumRenderTimeChange = Infinity
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false

      try {
        gradingCleanupRef.current = applyGrading(viewer, Cesium)
      } catch {
        /* grading is optional */
      }

      // terrain (non-fatal)
      try {
        viewer.terrainProvider = await Cesium.createWorldTerrainAsync()
      } catch {
        /* keep ellipsoid */
      }

      // Elevated 3D-city presentation: sun-based terrain relief + soft building
      // shadows, so buildings visibly rise off the ground instead of reading as
      // flat coloured polygons. Purely visual — never touches geometry, picking
      // or the LOD/loading pipeline — so it is wrapped and non-fatal like the
      // colour grading above (a GPU without shadow-map/depth-texture support
      // just keeps the flat-shaded look).
      try {
        viewer.scene.globe.enableLighting = true
        viewer.shadows = true
        viewer.terrainShadows = Cesium.ShadowMode.RECEIVE_ONLY
        viewer.shadowMap.softShadows = true
        viewer.shadowMap.darkness = 0.45 // restrained — never a dark/gaming look
        viewer.shadowMap.maximumDistance = 3000 // bounded to area/building LOD range
      } catch {
        /* shadows are optional */
      }
      if (cancelled) return

      registerMapApi(viewer)
      installPicker(viewer)
      installLod(viewer)

      // ONE Chennai-wide scene: a cheap city-overview layer that is always
      // resident, then demand-load the starting locality's detail.
      buildCityOverview(viewer)
      await buildCoimbatoreDemoProperty(viewer)
      if (cancelled) return
      const startArea = selRef.current.area?.id || DEFAULT_AREA_ID
      activeAreaRef.current = startArea
      await ensureAreaLayers(startArea)
      if (cancelled) return
      // City-wide: every available building in every locality becomes a 3D
      // structure in THIS viewer (lightweight massing). Non-blocking.
      ensureAllBuildings().catch(() => {})

      // If a preset / deep-link selection is already pending, applySelection()
      // owns the camera (it positions on the entity, switching locality first if
      // needed). Only prime layer visibility here — firing flyToArea() too would
      // race applySelection and snap the camera to the start-locality overview.
      const presetMode = selRef.current.selection?.mode
      if (['parcel', 'building', 'floor', 'unit', 'infrastructure'].includes(presetMode)) {
        lodRef.current = 'area'
        applyLayerVisibility()
      } else {
        flyToArea(startArea, 0)
      }
      setReady(true)
      window.__map = { ready: true }
      applySelection() // reflect any preset selection
    }

    init().catch((e) => {
      console.error('map init failed', e)
      if (!cancelled) setError('Unexpected error initialising the 3D map.')
    })

    return () => {
      cancelled = true
      handlerRef.current?.destroy?.()
      lodCleanupRef.current?.()
      gradingCleanupRef.current?.()
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
      viewerRef.current = null
      window.__map = { ready: false }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------- locality list */
  const localityOf = (id) =>
    (selRef.current.localities || []).find((l) => l.id === id) || selRef.current.area

  /* ------------------------------------------------- city-overview context */
  function buildCityOverview(viewer) {
    for (const loc of selRef.current.localities || []) {
      const half = (loc.extentM || 1500) / 2
      const dLat = half / 111320
      const dLon = half / (111320 * Math.cos((loc.base.lat * Math.PI) / 180))
      const positions = Cesium.Cartesian3.fromDegreesArray([
        loc.base.lon - dLon, loc.base.lat - dLat,
        loc.base.lon + dLon, loc.base.lat - dLat,
        loc.base.lon + dLon, loc.base.lat + dLat,
        loc.base.lon - dLon, loc.base.lat + dLat,
      ])
      const fill = viewer.entities.add({
        polygon: {
          hierarchy: positions,
          material: COL.areaFill,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        properties: { kind: 'area', areaId: loc.id },
      })
      const line = viewer.entities.add({
        polyline: {
          positions: [...positions, positions[0]],
          material: COL.areaLine,
          width: 2,
          clampToGround: true,
        },
        label: {
          text: loc.name,
          font: '600 15px "Inter", system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#0b1220'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -6),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1.15, 6.0e4, 0.55),
        },
        position: Cesium.Cartesian3.fromDegrees(loc.base.lon, loc.base.lat, 40),
        properties: { kind: 'area', areaId: loc.id },
      })
      fill.__area = '__city'
      line.__area = '__city'
      cityAreaRef.current.set(loc.id, { fill, line })
    }
    viewer.scene.requestRender()
  }

  // Coimbatore — the ONE demonstration property (user-provided ODM textured
  // model). Always resident (like the city-overview boundaries above) — it is
  // NOT a Chennai locality, never loaded/unloaded by loadArea(), and never
  // hidden by the Chennai LOD/area visibility system (no `.__area` tag, so
  // `areaOk()` treats it as always-visible; `.show` is set once here and never
  // revisited by applyLayerVisibility()). A single point + label, exactly like
  // one GNSS/CORS control point — deliberately not a 3D model, so the main
  // Cesium map stays a clean geographic marker/selection point. The ACTUAL
  // ODM reconstruction (OBJ + MTL + 21 textures) is shown exclusively in the
  // detailed Three.js explorer (/coimbatore-explorer, Exterior mode).
  async function buildCoimbatoreDemoProperty(viewer) {
    const p = COIMBATORE_DEMO_PROPERTY
    // Coimbatore is well inland (~400-450m above the ellipsoid), unlike
    // coastal Chennai — sample the actual World Terrain height here so the
    // marker sits ON the ground instead of buried inside it.
    try {
      const [sampled] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
        Cesium.Cartographic.fromDegrees(p.lon, p.lat),
      ])
      if (finite(sampled?.height)) coimbatoreGroundHeightRef.current = sampled.height
    } catch { /* keep the documented fallback */ }
    if (!liveViewer()) return
    const ent = viewer.entities.add({
      show: true,
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, coimbatoreGroundHeightRef.current + 2),
      point: {
        pixelSize: 14,
        color: COL.coimbatoreDemo,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: p.name,
        font: '600 14px "Inter", system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0b1220'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1.1, 8.0e5, 0.4),
      },
      properties: { kind: 'coimbatore-demo', propertyId: p.propertyId },
    })
    coimbatoreEntityRef.current = ent
    viewer.scene.requestRender()
  }

  /* ---------------------------------------------------- 3D building massing */
  // ONE reusable path for turning a gisBuildings feature into a lightweight 3D
  // extruded structure inside the SAME Cesium viewer. Guarded per buildingId so
  // the per-area load and the city-wide load never double-add. The extrusion
  // uses the feature's OWN footprint polygon + base/top elevation — never a
  // global box or a single shared height.
  function addBuildingEntity(f, areaId) {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return null
    const p = f.properties || {}
    const id = p.buildingId
    if (!id || buildingShellRef.current.has(id)) return buildingShellRef.current.get(id) || null
    const positions = ring(f.geometry)
    if (positions.length < 6) return null

    const base = finite(p.baseElevationM) ? p.baseElevationM : 0
    // Height priority: source-supplied heightM (already provenance-resolved by
    // the backend) → floors × floorHeight → a visible procedural fallback.
    const byFloors = finite(p.totalFloors) && finite(p.floorHeightM) ? p.totalFloors * p.floorHeightM : null
    const h = finite(p.heightM) ? p.heightM : byFloors != null ? byFloors : 30
    const top = base + Math.max(h, 3)
    const shellMaterial = COL.buildingShellVariants[shellVariantIndex(id, COL.buildingShellVariants.length)]

    const ent = viewer.entities.add({
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
        material: shellMaterial,
        outline: true,
        outlineColor: COL.outline,
        height: base,
        extrudedHeight: top,
        // Buildings cast + receive shadows (viewer.shadows, set up at init) so
        // the extruded massing visibly rises off the terrain instead of
        // reading as a flat coloured footprint.
        shadows: Cesium.ShadowMode.ENABLED,
      },
      // A roof-height label point — shown only at close zoom via LOD + the
      // Building Labels layer toggle, and scaled down with distance.
      position: (() => {
        let sx = 0
        let sy = 0
        let n = 0
        for (let i = 0; i < positions.length; i += 2) { sx += positions[i]; sy += positions[i + 1]; n += 1 }
        return n ? Cesium.Cartesian3.fromDegrees(sx / n, sy / n, top + 4) : undefined
      })(),
      label: {
        text: p.shortName || p.buildingSegment || id,
        font: '600 12px "Inter", system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0b1220'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        show: false,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(150, 1.0, 2200, 0.35),
        translucencyByDistance: new Cesium.NearFarScalar(1500, 1.0, 3000, 0.0),
      },
      properties: { kind: 'building', ...p },
    })
    ent.__area = areaId
    ent.__baseMaterial = shellMaterial
    buildingShellRef.current.set(id, ent)
    ;(groupsRef.current.buildings ||= []).push(ent)
    return ent
  }

  // City-wide: make EVERY available building in EVERY locality a 3D structure in
  // the one viewer. Lightweight massing only (no Three.js, no interior). Cheap +
  // idempotent; the existing per-area + LOD machinery governs what is drawn.
  async function ensureAllBuildings() {
    if (!liveViewer()) return 0
    const locs = selRef.current.localities || []
    let added = 0
    for (const l of locs) {
      try {
        const fc = await api.gisBuildings({ locality: l.id })
        for (const f of fc.features || []) if (addBuildingEntity(f, l.id)) added += 1
        loadedBuildingAreasRef.current.add(l.id)
      } catch { /* a locality's buildings are optional — never block the map */ }
    }
    if (added && liveViewer()) {
      applyLayerVisibility()
      liveViewer().scene.requestRender()
    }
    recomputeBuildingStats()
    return added
  }

  /* ------------------------------------------------------------ area data */
  async function ensureAreaLayers(areaId) {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    if (loadedAreasRef.current.has(areaId)) return
    loadedAreasRef.current.add(areaId)

    const groups = groupsRef.current
    const tag = (ent) => {
      if (ent) ent.__area = areaId
      return ent
    }
    const addPolygon = (layerKey, geometry, opts) => {
      const positions = ring(geometry)
      if (positions.length < 6) return null
      const ent = viewer.entities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
          material: opts.material,
          outline: opts.outline ?? false,
          outlineColor: opts.outlineColor ?? COL.outline,
          height: opts.height,
          extrudedHeight: opts.extrudedHeight,
          classificationType: opts.clamp ? Cesium.ClassificationType.TERRAIN : undefined,
        },
        properties: opts.properties,
      })
      tag(ent)
      ;(groups[layerKey] ||= []).push(ent)
      return ent
    }
    const addLine = (layerKey, geometry, color, width) => {
      const coords = geometry?.coordinates || []
      const flat = []
      for (const [lon, lat] of coords) flat.push(lon, lat)
      if (flat.length < 4) return
      const ent = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          material: color,
          width,
          clampToGround: true,
        },
        properties: { kind: 'overlay', areaId },
      })
      tag(ent)
      ;(groups[layerKey] ||= []).push(ent)
    }

    const P = { locality: areaId }

    try {
      const parcels = await api.gisParcels(P)
      for (const f of parcels.features || []) {
        const c = LAND_USE_COLORS[f.properties.landUse] || '#3f7fd6'
        const ent = addPolygon('parcels', f.geometry, {
          material: Cesium.Color.fromCssColorString(c).withAlpha(0.16),
          clamp: true,
          properties: { kind: 'parcel', ...f.properties },
        })
        if (ent) parcelEntityRef.current.set(f.properties.ulpin, ent)
      }
    } catch (e) {
      console.warn('parcels load failed', e)
    }

    try {
      const buildings = await api.gisBuildings(P)
      for (const f of buildings.features || []) addBuildingEntity(f, areaId)
      loadedBuildingAreasRef.current.add(areaId)
    } catch (e) {
      console.warn('buildings load failed', e)
    }

    // overlays (per-area)
    try {
      const roads = await api.gisLayer('roads', P)
      for (const f of roads.features || []) addLine('roads', f.geometry, Cesium.Color.fromCssColorString('#c9d2e3').withAlpha(0.75), 3)
    } catch { /* ignore */ }
    try {
      const utils = await api.gisLayer('utilities', P)
      const uColor = { 'Water Supply': '#4fa9ff', 'Sewer Line': '#9b7b4f', Electricity: '#f2b807', Drainage: '#4fbf9f', 'Gas Pipeline': '#e4566e', 'Fiber Network': '#a86fd1' }
      for (const f of utils.features || []) {
        const key = { 'Water Supply': 'waterSupply', 'Sewer Line': 'sewerLines', Electricity: 'electricity', Drainage: 'drainage', 'Gas Pipeline': 'gasPipeline', 'Fiber Network': 'fiberNetwork' }[f.properties.type]
        addLine(key || 'utilities', f.geometry, Cesium.Color.fromCssColorString(uColor[f.properties.type] || '#8b97ad'), 2)
      }
    } catch { /* ignore */ }
    try {
      const env = await api.gisLayer('environment', P)
      const map = { 'Water Body': 'waterBodies', 'Eco Sensitive Zone': 'ecoZones', 'Heritage Zone': 'heritageZones', 'Coastal Regulation Zone': 'coastalZone' }
      for (const f of env.features || []) {
        const key = map[f.properties.kind] || 'waterBodies'
        if (f.geometry.type === 'Polygon') {
          addPolygon(key, f.geometry, { material: Cesium.Color.fromCssColorString('#2f6feb').withAlpha(0.12), clamp: true })
        } else {
          addLine(key, f.geometry, Cesium.Color.fromCssColorString('#38c9d6').withAlpha(0.8), 2)
        }
      }
    } catch { /* ignore */ }
    try {
      const bounds = await api.gisLayer('boundaries', P)
      const map = { 'Corporation Boundary': 'corporationBoundary', 'Zone Boundary': 'zoneBoundary', 'Ward Boundary': 'wardBoundary' }
      for (const f of bounds.features || []) {
        const key = map[f.properties.level] || 'zoneBoundary'
        addPolygon(key, f.geometry, { material: Cesium.Color.TRANSPARENT, outline: false, clamp: true, properties: { kind: 'boundary', ...f.properties } })
        addLine(key, { coordinates: (f.geometry.coordinates[0] || []) }, Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.5), 2)
      }
    } catch { /* ignore */ }
    try {
      const mp = await api.gisLayer('master-plan', P)
      for (const f of mp.features || []) addPolygon('masterPlan', f.geometry, { material: Cesium.Color.fromCssColorString('#a86fd1').withAlpha(0.08), clamp: true, properties: { kind: 'masterplan', ...f.properties } })
    } catch { /* ignore */ }
    try {
      const dsp = await api.gisLayer('disputes', P)
      for (const f of dsp.features || []) {
        if (f.geometry?.type !== 'Point') continue
        const [lon, lat] = f.geometry.coordinates
        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 60),
          point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#e4566e'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
          properties: { kind: 'dispute', ...f.properties },
        })
        ent.__area = areaId
        ;(groupsRef.current.disputes ||= []).push(ent)
      }
    } catch { /* ignore */ }

    await ensureAiBuildings(areaId)
    await ensureAiFloorUnits(areaId)
    await ensureGnssControlPoints(areaId)
    await ensureUndergroundInfrastructure(areaId)
    await ensureTngisParcels(areaId)
    if (!liveViewer()) return
    applyLayerVisibility()
    liveViewer().scene.requestRender()
  }

  // Phase 3 — AI-derived candidate buildings (AI_DEMO). Their own layer,
  // separate from the demo `buildings`. Idempotent (guarded per aiBuildingId),
  // so it can be re-run after a new extraction without duplicating entities.
  async function ensureAiBuildings(areaId) {
    if (!liveViewer()) return
    let added = 0
    try {
      const ai = await api.gisAiBuildings({ locality: areaId })
      const viewer = liveViewer()
      if (!viewer) return 0
      for (const f of ai.features || []) {
        if (aiBuildingsRef.current.has(f.properties.aiBuildingId)) continue
        const positions = ring(f.geometry)
        if (positions.length < 6) continue
        const review = f.properties.reviewRequired || f.properties.reviewStatus === 'REVIEW_REQUIRED'
        const ent = viewer.entities.add({
          show: false,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
            material: review ? COL.aiReview : COL.aiBuilding,
            outline: true,
            outlineColor: COL.aiBuildingLine,
            height: 0,
            extrudedHeight: ESTIMATED_AI_HEIGHT_M, // ESTIMATED / DEMO — not survey-derived
          },
          properties: { kind: 'ai-building', estimated: true, ...f.properties },
        })
        ent.__area = areaId
        aiBuildingsRef.current.set(f.properties.aiBuildingId, ent)
        ;(groupsRef.current.aiBuildings ||= []).push(ent)
        added += 1
      }
    } catch { /* AI layer is optional — never block the map */ }
    if (added && liveViewer()) {
      applyLayerVisibility()
      liveViewer().scene.requestRender()
    }
    return added
  }

  // Phase 4 — AI floor-plan-derived apartment/property units (AI_DEMO). Own
  // layer, separate from the demo `propertyUnits`. Only GEOREFERENCED units
  // (associated to an existing building/floor) are placed on the map; local-only
  // floor plans stay on the AI Floor Plan page. Idempotent (guarded per
  // aiFloorUnitId) so it can be re-run after a new inference without dupes.
  async function ensureAiFloorUnits(areaId) {
    if (!liveViewer()) return 0
    let added = 0
    try {
      const fc = await api.gisAiFloorUnits({ locality: areaId })
      const viewer = liveViewer()
      if (!viewer) return 0
      for (const f of fc.features || []) {
        const id = f.properties.aiFloorUnitId
        if (!id || aiFloorUnitsRef.current.has(id)) continue
        const positions = ring(f.geometry)
        if (positions.length < 6) continue
        const review = f.properties.reviewRequired || f.properties.reviewStatus === 'REVIEW_REQUIRED'
        const base = finite(f.properties.baseHeight) ? f.properties.baseHeight : 0
        const top = finite(f.properties.topHeight)
          ? f.properties.topHeight
          : base + ESTIMATED_AI_UNIT_HEIGHT_M // ESTIMATED / DEMO — never survey-derived
        const ent = viewer.entities.add({
          show: false,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
            material: review ? COL.aiReview : COL.aiFloorUnit,
            outline: true,
            outlineColor: COL.aiFloorUnitLine,
            height: base,
            extrudedHeight: top,
          },
          properties: { kind: 'ai-floor-unit', estimated: true, ...f.properties },
        })
        ent.__area = areaId
        ent.__review = review
        aiFloorUnitsRef.current.set(id, ent)
        ;(groupsRef.current.aiFloorUnits ||= []).push(ent)
        added += 1
      }
    } catch { /* AI layer is optional — never block the map */ }
    if (added && liveViewer()) {
      applyLayerVisibility()
      liveViewer().scene.requestRender()
    }
    return added
  }

  // Phase 6 — GNSS/CORS control points (GNSS/CORS DEMO). Own layer, OFF by
  // default. Rendered as small points (never a raw point-cloud splat), one
  // per validated control point that resolved to a usable WGS84 coordinate.
  // Idempotent (guarded per controlPointId), so re-running an import updates
  // the layer without duplicating entities.
  async function ensureGnssControlPoints(areaId) {
    if (!liveViewer()) return 0
    let added = 0
    try {
      const fc = await api.gisGnssControlPoints({ locality: areaId })
      const viewer = liveViewer()
      if (!viewer) return 0
      for (const f of fc.features || []) {
        const id = f.properties.controlPointId
        if (!id || gnssPointsRef.current.has(id)) continue
        const [lon, lat] = f.geometry.coordinates
        if (!finite(lon) || !finite(lat)) continue
        const status = f.properties.validationStatus
        const color = status === 'ERROR' ? COL.gnssError : status === 'WARNING' ? COL.gnssWarning : COL.gnssValid
        const ent = viewer.entities.add({
          show: false,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, finite(f.properties.height) ? f.properties.height : 5),
          point: {
            pixelSize: 10,
            color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { kind: 'gnss-point', estimated: false, ...f.properties },
        })
        ent.__area = areaId
        gnssPointsRef.current.set(id, ent)
        ;(groupsRef.current.gnssControlPoints ||= []).push(ent)
        added += 1
      }
    } catch { /* GNSS layer is optional — never block the map */ }
    if (added && liveViewer()) {
      applyLayerVisibility()
      liveViewer().scene.requestRender()
    }
    return added
  }

  // Phase 8 — underground 3D infrastructure (DEMO / uploaded / authorized). Own
  // layer, OFF by default. Rendered INSIDE THIS SAME viewer at true Z/depth:
  // linear assets as depth-placed polylines, manholes as cylinders, chambers as
  // bounded 3D volumes. Records with no supplied depth are drawn just below the
  // surface, faded + dashed, so unknown depth never looks like a surveyed one.
  // Idempotent (guarded per infrastructureId).
  async function ensureUndergroundInfrastructure(areaId) {
    if (!liveViewer()) return 0
    let added = 0
    try {
      const fc = await api.gisUndergroundInfrastructure({ locality: areaId })
      const viewer = liveViewer()
      if (!viewer) return 0
      for (const f of fc.features || []) {
        const p = f.properties || {}
        const id = p.infrastructureId
        if (!id || infraEntitiesRef.current.has(id)) continue
        const g = f.geometry
        if (!g) continue
        const typeColor = COL.infra[p.type] || COL.infra.OTHER
        const depthUnknown = !finite(p.topElevationM)
        const zTop = finite(p.topElevationM) ? p.topElevationM : UNKNOWN_DEPTH_Z
        const zBot = finite(p.bottomElevationM) ? p.bottomElevationM : zTop - 0.3
        const isOfficial = Boolean(p.isOfficial)
        let ent = null

        if (g.type === 'LineString') {
          const positions = []
          for (const c of g.coordinates) positions.push(c[0], c[1], zTop)
          if (positions.length < 6) continue
          const widthPx = Math.max(3, Math.min(14, (finite(p.diameterM) ? p.diameterM : finite(p.widthM) ? p.widthM : 0.3) * 12))
          ent = viewer.entities.add({
            show: false,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArrayHeights(positions),
              width: widthPx,
              arcType: Cesium.ArcType.NONE,
              material: depthUnknown
                ? new Cesium.PolylineDashMaterialProperty({ color: COL.infraUnknownDepth, dashLength: 12 })
                : isOfficial
                  ? typeColor
                  : new Cesium.PolylineDashMaterialProperty({ color: typeColor, dashLength: 24 }),
            },
            properties: { kind: 'infra', ...p },
          })
        } else if (g.type === 'Point') {
          const [lon, lat] = g.coordinates
          if (!finite(lon) || !finite(lat)) continue
          const len = Math.max(0.6, (finite(p.depthBelowSurfaceM) ? p.depthBelowSurfaceM : 2) )
          const radius = Math.max(0.4, (finite(p.widthM) ? p.widthM : 1.2) / 2)
          const midZ = finite(p.surfaceElevationM) ? p.surfaceElevationM - len / 2 : UNKNOWN_DEPTH_Z
          ent = viewer.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, midZ),
            cylinder: {
              length: len,
              topRadius: radius,
              bottomRadius: radius,
              material: (depthUnknown ? COL.infraUnknownDepth : typeColor).withAlpha(0.6),
              outline: true,
              outlineColor: COL.outline,
            },
            properties: { kind: 'infra', ...p },
          })
        } else if (g.type === 'Polygon') {
          const flat = []
          for (const c of g.coordinates[0] || []) flat.push(c[0], c[1])
          if (flat.length < 6) continue
          ent = viewer.entities.add({
            show: false,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
              material: (depthUnknown ? COL.infraUnknownDepth : typeColor).withAlpha(0.35),
              outline: true,
              outlineColor: typeColor,
              height: Math.min(zBot, zTop),
              extrudedHeight: Math.max(zBot, zTop),
            },
            properties: { kind: 'infra', ...p },
          })
        }
        if (!ent) continue
        ent.__area = areaId
        ent.__depthUnknown = depthUnknown
        infraEntitiesRef.current.set(id, ent)
        ;(groupsRef.current.undergroundInfrastructure ||= []).push(ent)
        added += 1
      }
    } catch { /* underground layer is optional — never block the map */ }
    if (added && liveViewer()) {
      applyLayerVisibility()
      liveViewer().scene.requestRender()
    }
    return added
  }

  // Turn TNGIS parcel GeoJSON features into individual, selectable, VERTICALLY
  // EXTRUDED building/house volumes — the actual (possibly irregular) TNGIS
  // footprint, raised off the terrain by a fixed DEMO_VISUAL_HEIGHT (never a
  // generic box, never a real surveyed height) — plus a crisp ground outline
  // so every footprint boundary stays visually distinct. Idempotent per
  // sourceRecordId. Shared by the explicit-fetch layer and the Chennai-wide
  // viewport (BBOX) loader.
  async function addTngisFeatures(features) {
    const viewer = liveViewer()
    if (!viewer) return 0

    // First pass (sync): collect every new ring's actual footprint positions,
    // skipping already-known ids / degenerate rings.
    const toAdd = []
    for (const f of features || []) {
      const p = f.properties || {}
      const id = p.sourceRecordId
      if (!id || tngisParcelRef.current.has(id)) continue
      const g = f.geometry
      if (!g) continue
      const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
      for (let pi = 0; pi < polys.length; pi += 1) {
        const flat = []
        for (const c of polys[pi][0] || []) flat.push(c[0], c[1])
        if (flat.length < 6) continue
        toAdd.push({ id, p, pi, positions: Cesium.Cartesian3.fromDegreesArray(flat) })
      }
    }
    if (!toAdd.length) return 0

    // Batch-sample the real terrain height under each footprint's own centroid
    // in ONE call (same sampleTerrainMostDetailed approach already used for the
    // selected-parcel DEMO_VISUALIZATION extrusion) — the base of every
    // extrusion sits on real ground, never sea level, never clamped flat. Falls
    // back to height 0 per-footprint if sampling is unavailable — the layer
    // must never be blocked by it.
    const cartos = toAdd.map(({ positions }) => {
      const c = Cesium.Cartographic.fromCartesian(Cesium.BoundingSphere.fromPoints(positions).center)
      return Cesium.Cartographic.fromRadians(c.longitude, c.latitude)
    })
    let sampled = []
    try {
      sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos)
    } catch { /* keep sampled empty — every footprint falls back to height 0 below */ }
    if (!liveViewer()) return 0 // viewer torn down while the terrain request was in flight

    let added = 0
    for (let i = 0; i < toAdd.length; i += 1) {
      const { id, p, pi, positions } = toAdd[i]
      if (tngisParcelRef.current.has(id)) continue // guard a race with a second concurrent load
      const groundHeight = finite(sampled[i]?.height) ? sampled[i].height : 0
      const ent = viewer.entities.add({
        show: false,
        polygon: {
          hierarchy: positions, // the ACTUAL TNGIS footprint — never a generic box
          material: COL.tngisBuilding,
          outline: true,
          outlineColor: COL.tngisBuildingOutline,
          outlineWidth: 1,
          height: groundHeight,
          extrudedHeight: groundHeight + TNGIS_DEMO_VISUAL_HEIGHT_M,
        },
        polyline: {
          positions,
          width: 1.5,
          material: COL.tngisParcelLine,
          clampToGround: true,
        },
        properties: {
          kind: 'tngis-parcel',
          ...p,
          heightProvenance: 'DEMO_VISUAL_HEIGHT',
          heightM: TNGIS_DEMO_VISUAL_HEIGHT_M,
        },
      })
      // TNGIS parcels are Chennai-wide by nature (viewport-loaded or explicitly
      // fetched anywhere in the district) — not bound to one demo locality.
      // Tag '__city' so visibility is governed only by the layer switch + LOD.
      ent.__area = '__city'
      ent.__tngisId = id
      if (pi === 0) tngisParcelRef.current.set(id, ent)
      ;(groupsRef.current.tngisParcels ||= []).push(ent)
      added += 1
    }
    // Keep the resident TNGIS entity set bounded — evict the oldest parcels that
    // are not the current selection when we blow past the cap (Chennai has ~74k
    // parcels; we only ever keep what has been in view).
    const group = groupsRef.current.tngisParcels || []
    if (group.length > TNGIS_MAX_ENTITIES) {
      const selId = selRef.current.selection?.sourceRecordId
      const overflow = group.length - TNGIS_MAX_ENTITIES
      let removed = 0
      for (let i = 0; i < group.length && removed < overflow; i += 1) {
        const ent = group[i]
        if (!ent || ent.__tngisId === selId) continue
        viewer.entities.remove(ent)
        if (ent.__tngisId) tngisParcelRef.current.delete(ent.__tngisId)
        group[i] = null
        removed += 1
      }
      groupsRef.current.tngisParcels = group.filter(Boolean)
    }
    if (added) {
      applyLayerVisibility()
      viewer.scene.requestRender()
    }
    recomputeTngisStats()
    return added
  }

  // TNGIS / Tamil Nilam — PUBLIC-source parcels a user EXPLICITLY fetched
  // (District → Taluk → Village → Survey). Own layer, OFF by default. Viewport-
  // discovered parcels are excluded here — the BBOX loader below owns those.
  async function ensureTngisParcels() {
    if (!liveViewer()) return 0
    try {
      const fc = await api.gisTngisParcels({ excludeViewport: 1 })
      return addTngisFeatures(fc.features)
    } catch { /* TNGIS layer is optional — never block the map */ }
    return 0
  }

  // TNGIS Chennai-wide — progressively load OFFICIAL parcel geometry for
  // whatever Chennai extent is in view, from the public GeoServer WFS (BBOX +
  // district_code=Chennai, capped server-side). Only runs when the layer is ON
  // and the camera is close enough for parcel detail. Previous request is
  // cancelled on every new camera move. Never downloads the whole district.
  async function loadTngisViewport() {
    const viewer = liveViewer()
    if (!viewer) return
    if (!(selRef.current.layers?.tngisParcels)) return
    if (lodRef.current === 'city') return
    const carto = viewer.camera.positionCartographic
    if (!carto || carto.height > TNGIS_VIEWPORT_MAX_CAM_M) return

    const rect = viewer.camera.computeViewRectangle()
    if (!rect) return
    const minLon = Cesium.Math.toDegrees(rect.west)
    const minLat = Cesium.Math.toDegrees(rect.south)
    const maxLon = Cesium.Math.toDegrees(rect.east)
    const maxLat = Cesium.Math.toDegrees(rect.north)
    // Outside greater Chennai — nothing to ask the Chennai cadastre for.
    if (maxLon < 79.9 || minLon > 80.45 || maxLat < 12.8 || minLat > 13.35) return

    const key = [minLon, minLat, maxLon, maxLat].map((n) => n.toFixed(2)).join(',')
    if (key === tngisLastBboxRef.current) return
    tngisLastBboxRef.current = key

    tngisAbortRef.current?.abort()
    const ac = new AbortController()
    tngisAbortRef.current = ac
    try {
      const fc = await api.gisTngisParcelsBbox(
        { bbox: `${minLon},${minLat},${maxLon},${maxLat}`, limit: TNGIS_VIEWPORT_LIMIT },
        { signal: ac.signal },
      )
      if (ac.signal.aborted) return
      await addTngisFeatures(fc.features)
      if (ac.signal.aborted) return
      recomputeTngisStats(fc.meta)
    } catch { /* aborted or source unavailable — the layer just stays as-is */ }
  }

  async function ensureUnits(buildingId) {
    if (!buildingId || loadedBuildingsRef.current.has(buildingId)) return
    loadedBuildingsRef.current.add(buildingId)
    if (!liveViewer()) return
    // Fallback area tag only — each entity is tagged with its own feature
    // `locality` below so a cross-locality selection is never mis-tagged with
    // whatever area happened to be active when this ran.
    const areaId = activeAreaRef.current
    try {
      const [units, commons] = await Promise.all([
        api.gisUnits({ buildingId }),
        api.gisCommonAreas({ buildingId }),
      ])
      const viewer = liveViewer()
      if (!viewer) return
      for (const f of units.features || []) {
        const p = f.properties
        const positions = ring(f.geometry)
        if (positions.length < 6 || !finite(p.baseHeight) || !finite(p.topHeight)) continue
        const ent = viewer.entities.add({
          show: false,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
            material: p.usage === 'Commercial' ? COL.unitCommercial : COL.unit,
            outline: true,
            outlineColor: COL.outline,
            height: p.baseHeight,
            extrudedHeight: p.topHeight,
          },
          properties: { kind: 'unit', ...p },
        })
        ent.__area = p.locality || areaId
        unitEntitiesRef.current.set(p.propertyId, ent)
        ;(groupsRef.current.units3d ||= []).push(ent)
      }
      for (const f of commons.features || []) {
        const p = f.properties
        const positions = ring(f.geometry)
        if (positions.length < 6) continue
        const ent = viewer.entities.add({
          show: false,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
            material: COL.common,
            outline: true,
            outlineColor: COL.outline,
            height: p.baseHeight,
            extrudedHeight: p.topHeight,
          },
          properties: { kind: 'common-area', ...p },
        })
        ent.__area = p.locality || areaId
        ;(groupsRef.current.commonAreas ||= []).push(ent)
      }
    } catch (e) {
      console.warn('unit load failed', e)
    }
  }

  // Prototype 3D floor volume: the building footprint extruded between the
  // floor's zmin/zmax. Built once per (building, floor) and cached; hidden by
  // default and shown by refreshDetailVisibility() when the floor is selected.
  // The z-range is taken from the units already loaded for that floor (no extra
  // fetch — ensureUnits() has run first), falling back to the floors API.
  async function ensureFloorVolume(buildingId, floorNumber) {
    if (buildingId == null || floorNumber == null) return
    const key = `${buildingId}|${floorNumber}`
    if (floorVolumeRef.current.has(key)) return
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    const shell = buildingShellRef.current.get(buildingId)
    if (!shell) return

    let baseHeight
    let topHeight
    let floorId

    // 1) derive from already-loaded unit entities on this floor
    for (const ent of unitEntitiesRef.current.values()) {
      const p = ent.properties
      if (valueOf(p.buildingId) !== buildingId || valueOf(p.floorNumber) !== floorNumber) continue
      const v = valueOf(p.volume)
      const bh = v?.zmin ?? valueOf(p.baseHeight)
      const th = v?.zmax ?? valueOf(p.topHeight)
      if (finite(bh) && finite(th)) {
        baseHeight = baseHeight == null ? bh : Math.min(baseHeight, bh)
        topHeight = topHeight == null ? th : Math.max(topHeight, th)
      }
    }

    // 2) fallback: floors API (cached per building)
    if (!finite(baseHeight) || !finite(topHeight)) {
      if (!floorRangesRef.current.has(buildingId)) {
        try {
          const floors = await api.buildingFloors(buildingId)
          floorRangesRef.current.set(buildingId, (floors || []).map((f) => ({
            floorNumber: f.floorNumber,
            floorId: f.floorId,
            baseHeight: f.volume?.zmin ?? f.baseHeight,
            topHeight: f.volume?.zmax ?? f.topHeight,
          })))
        } catch {
          floorRangesRef.current.set(buildingId, [])
        }
      }
      const r = (floorRangesRef.current.get(buildingId) || []).find((f) => f.floorNumber === floorNumber)
      if (r && finite(r.baseHeight) && finite(r.topHeight)) {
        baseHeight = r.baseHeight
        topHeight = r.topHeight
        floorId = r.floorId
      }
    }
    if (!finite(baseHeight) || !finite(topHeight) || topHeight <= baseHeight) return
    // units are inset ~0.3 m below the true floor top — restore it for the slab
    topHeight += 0.3

    const hv = shell.polygon?.hierarchy?.getValue?.(Cesium.JulianDate.now())
    const positions = hv?.positions || hv // Cesium may or may not wrap the ring in a PolygonHierarchy
    if (!Array.isArray(positions) || positions.length < 3) return

    const ent = viewer.entities.add({
      show: false,
      polygon: {
        hierarchy: [...positions],
        material: COL.floorVolume,
        outline: true,
        outlineColor: COL.floorVolumeLine,
        height: baseHeight,
        extrudedHeight: topHeight,
      },
      properties: {
        kind: 'floor-volume',
        buildingId,
        floorNumber,
        floorId: floorId || `${buildingId}-F${String(floorNumber).padStart(2, '0')}`,
      },
    })
    ent.__area = activeAreaRef.current
    floorVolumeRef.current.set(key, ent)
    ;(groupsRef.current.floorVolumes ||= []).push(ent)
    viewer.scene.requestRender()
  }

  // Temporary DEMO_VISUALIZATION for the selected land parcel — an ash-gray
  // vertical extrusion of the parcel's OWN (possibly irregular) polygon, so a
  // selected parcel reads as a 3D mass rather than a flat tile, until a real
  // building/property model exists for it. Exactly one at a time: always
  // clears whatever the previous selection drew first. NOT an official
  // height — DEMO_VISUAL_HEIGHT_M is a fixed placeholder, never persisted or
  // presented as surveyed/cadastral data.
  const DEMO_VISUAL_HEIGHT_M = 10
  async function updateSelectedParcelExtrusion(ulpin) {
    const viewer = liveViewer()
    if (!viewer) return
    if (selectedParcelExtrusionRef.current) {
      viewer.entities.remove(selectedParcelExtrusionRef.current)
      selectedParcelExtrusionRef.current = null
    }
    const parcelEnt = parcelEntityRef.current.get(ulpin)
    const hv = parcelEnt?.polygon?.hierarchy?.getValue?.(Cesium.JulianDate.now())
    const positions = hv?.positions || hv
    if (!Array.isArray(positions) || positions.length < 3) return

    // Terrain-sample the footprint's own centroid — same approach already
    // used for Coimbatore (sampleTerrainMostDetailed) — so the extrusion's
    // base sits on the real ground, never sea level, never clamped flat.
    let groundHeight = 0
    try {
      const centerCarto = Cesium.Cartographic.fromCartesian(Cesium.BoundingSphere.fromPoints(positions).center)
      const [sampled] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
        Cesium.Cartographic.fromRadians(centerCarto.longitude, centerCarto.latitude),
      ])
      if (finite(sampled?.height)) groundHeight = sampled.height
    } catch { /* keep groundHeight = 0 rather than block the extrusion */ }
    if (!liveViewer()) return

    const ent = viewer.entities.add({
      polygon: {
        hierarchy: [...positions], // the ACTUAL parcel footprint — never a generic box
        height: groundHeight,
        extrudedHeight: groundHeight + DEMO_VISUAL_HEIGHT_M,
        material: COL.parcelDemoExtrusion,
        outline: true,
        outlineColor: COL.parcelDemoExtrusionOutline,
        outlineWidth: 1,
      },
      properties: {
        kind: 'parcel-demo-extrusion',
        ulpin,
        provenance: 'DEMO_VISUALIZATION',
        heightLabel: 'DEMO_VISUAL_HEIGHT_M',
        heightM: DEMO_VISUAL_HEIGHT_M,
      },
    })
    selectedParcelExtrusionRef.current = ent
    viewer.scene.requestRender()
  }

  /* --------------------------------------------------------------- picking */
  function installPicker(viewer) {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handlerRef.current = handler
    handler.setInputAction((click) => {
      let props = viewer.scene.pick(click.position)?.id?.properties
      let kind = props?.kind?.getValue?.() ?? props?.kind
      // The translucent floor-volume slab is context only — see through it to the
      // unit underneath so every apartment stays individually selectable.
      if (kind === 'floor-volume') {
        const drilled = viewer.scene.drillPick(click.position, 6)
        const hit = drilled.find((d) => {
          const k = d?.id?.properties?.kind?.getValue?.() ?? d?.id?.properties?.kind
          return k && k !== 'floor-volume'
        })
        if (hit) {
          props = hit.id.properties
          kind = props.kind?.getValue?.() ?? props.kind
        }
      }
      if (!props) return
      const s = selRef.current
      if (kind === 'floor-volume') {
        s.selectFloor(valueOf(props.buildingId), valueOf(props.floorNumber), s.area?.ulpin)
      } else if (kind === 'area') {
        s.selectArea(valueOf(props.areaId))
      } else if (kind === 'unit') {
        s.selectUnit({
          propertyId: valueOf(props.propertyId),
          buildingId: valueOf(props.buildingId),
          floorNumber: valueOf(props.floorNumber),
          ulpin: valueOf(props.ulpin) || s.area?.ulpin || PARCEL_ULPIN,
        })
      } else if (kind === 'building') {
        s.selectBuilding(valueOf(props.buildingId), valueOf(props.ulpin))
      } else if (kind === 'parcel' || kind === 'parcel-demo-extrusion') {
        s.selectParcel(valueOf(props.ulpin))
      } else if (kind === 'ai-building') {
        s.selectAiBuilding(valueOf(props.aiBuildingId))
      } else if (kind === 'ai-floor-unit') {
        s.selectAiFloorUnit(valueOf(props.aiFloorUnitId))
      } else if (kind === 'gnss-point') {
        s.selectGnssPoint(valueOf(props.controlPointId))
      } else if (kind === 'infra') {
        s.selectInfrastructure(valueOf(props.infrastructureId))
      } else if (kind === 'tngis-parcel') {
        s.selectTngisParcel(valueOf(props.sourceRecordId))
      } else if (kind === 'coimbatore-demo') {
        s.selectCoimbatoreDemo()
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }
  const valueOf = (p) => (p?.getValue ? p.getValue(Cesium.JulianDate.now()) : p)

  /* -------------------------------------------------------- LOD by camera */
  function installLod(viewer) {
    viewer.camera.percentageChanged = 0.2
    let raf = 0
    const onChange = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const h = viewer.camera.positionCartographic?.height ?? 99999
        const next = h > LOD.CITY ? 'city' : h > LOD.AREA ? 'area' : 'building'
        if (next !== lodRef.current) {
          lodRef.current = next
          applyLayerVisibility()
          viewer.scene.requestRender()
        }
      })
    }
    viewer.camera.changed.addEventListener(onChange)

    // TNGIS Chennai-wide: after the camera settles, pull OFFICIAL parcel
    // geometry for the new viewport (debounced, cancellable, LOD-gated inside
    // loadTngisViewport). moveEnd fires once per gesture — right for a fetch.
    const onMoveEnd = () => {
      if (tngisMoveTimerRef.current) clearTimeout(tngisMoveTimerRef.current)
      tngisMoveTimerRef.current = setTimeout(() => { loadTngisViewport() }, 350)
    }
    viewer.camera.moveEnd.addEventListener(onMoveEnd)

    lodCleanupRef.current = () => {
      if (raf) cancelAnimationFrame(raf)
      viewer.camera.changed.removeEventListener(onChange)
      viewer.camera.moveEnd.removeEventListener(onMoveEnd)
      if (tngisMoveTimerRef.current) clearTimeout(tngisMoveTimerRef.current)
      tngisAbortRef.current?.abort()
    }
  }

  /* ------------------------------------------------------------- camera api */
  function registerMapApi(viewer) {
    const api2 = selRef.current.mapApi
    // Fly to an entity by computing its bounding sphere directly from geometry.
    // `viewer.flyTo(entity)` depends on the DataSourceDisplay having a resolved
    // bounding volume, which is often not ready in the same tick an entity (or a
    // whole locality) was just added — the flight then silently rejects. Reading
    // the positions ourselves avoids that race; `viewer.flyTo` is kept as a
    // fallback for anything we can't measure.
    const flyToEntity = (ent, offset, duration = 1.2) => {
      if (!ent || !liveViewer()) return
      const now = Cesium.JulianDate.now()
      let positions = null
      const hv = ent.polygon?.hierarchy?.getValue?.(now) ?? ent.polygon?.hierarchy
      if (hv) positions = hv.positions || hv
      else if (ent.polyline?.positions) positions = ent.polyline.positions.getValue?.(now) || ent.polyline.positions
      else if (ent.position) { const p = ent.position.getValue?.(now) || ent.position; if (p) positions = [p] }
      if (Array.isArray(positions) && positions.length) {
        try {
          const sphere = Cesium.BoundingSphere.fromPoints(positions)
          viewer.camera.flyToBoundingSphere(sphere, { duration, offset })
          viewer.scene.requestRender()
          return
        } catch { /* fall through to viewer.flyTo */ }
      }
      viewer.flyTo(ent, { duration, offset }).catch(() => {})
    }

    api2.current = {
      ...api2.current,
      resetView: () => flyToArea(activeAreaRef.current, 1.4),
      flyToArea: (areaId, duration) => flyToArea(areaId, duration),
      flyToCity: () => flyToCity(1.6),
      // Chennai coverage regions — same camera, same viewer. Parks over a region
      // at an overview height; the user then zooms in and the TNGIS viewport
      // loader streams that region's official parcels.
      flyToLonLat: (lon, lat, height = 9000) => {
        cityViewRef.current = false
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
          duration: 1.6,
        })
        viewer.scene.requestRender()
      },
      // Coimbatore — camera-only move to the ONE demonstration property. Does
      // NOT touch activeAreaRef / loadArea — the Chennai locality data stays
      // exactly as it was, simply out of frame, so switching back to Chennai
      // afterwards needs no reload. Framed the same way as every other point
      // entity (flyToGnssPoint et al.) — a bounding-sphere flyTo centred on
      // the entity's own (terrain-sampled) position, not a raw camera offset.
      flyToCoimbatoreDemo: () => {
        cityViewRef.current = false
        flyToEntity(coimbatoreEntityRef.current, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 260))
      },
      topView: () => {
        const b = localityOf(activeAreaRef.current).base
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, 1400),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89), roll: 0 },
          duration: 1,
        })
      },
      zoomBy: (factor) => viewer.camera.zoomIn(viewer.camera.positionCartographic.height * factor),
      rotateBy: (deg) => viewer.camera.rotateRight(Cesium.Math.toRadians(deg)),
      tiltBy: (deg) => viewer.camera.lookUp(Cesium.Math.toRadians(deg)),
      flyToParcel: (ulpin) => flyToEntity(parcelEntityRef.current.get(ulpin), new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 600)),
      flyToBuilding: (buildingId) => flyToEntity(buildingShellRef.current.get(buildingId), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(35), Cesium.Math.toRadians(-30), 260)),
      flyToUnit: (propertyId) => flyToEntity(unitEntitiesRef.current.get(propertyId), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(40), Cesium.Math.toRadians(-22), 90)),
      flyToAiBuilding: (aiBuildingId) => flyToEntity(aiBuildingsRef.current.get(aiBuildingId), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(35), Cesium.Math.toRadians(-28), 220)),
      flyToAiFloorUnit: (aiFloorUnitId) => flyToEntity(aiFloorUnitsRef.current.get(aiFloorUnitId), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(40), Cesium.Math.toRadians(-24), 120)),
      flyToGnssPoint: (controlPointId) => flyToEntity(gnssPointsRef.current.get(controlPointId), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(30), Cesium.Math.toRadians(-35), 80)),
      flyToInfrastructure: (infrastructureId) => flyToEntity(infraEntitiesRef.current.get(infrastructureId), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(30), Cesium.Math.toRadians(-32), 160)),
      // Close, oblique framing (matching the AI-candidate-building fly-to scale)
      // so the DEMO_VISUAL_HEIGHT extrusion's walls are clearly visible on
      // selection — the previous 500m "whole parcel" distance was tuned for a
      // flat footprint and reads as a dot now that it stands upright.
      flyToTngisParcel: (sourceRecordId) => flyToEntity(tngisParcelRef.current.get(sourceRecordId), new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-38), 180)),
      // Pull freshly-extracted AI buildings into the running viewer (called by
      // the AI Building Extraction page after an inference completes).
      refreshAiBuildings: (areaId) => ensureAiBuildings(areaId || activeAreaRef.current),
      // Re-scan every locality for 3D building coverage (idempotent).
      refreshBuildings: () => ensureAllBuildings(),
      buildingStats: () => {
        let visible = 0
        for (const e of buildingShellRef.current.values()) if (e.show) visible += 1
        const available = (selRef.current.localities || []).reduce((s, l) => s + (Number(l.counts?.buildings) || 0), 0)
        return { available: Math.max(available, buildingShellRef.current.size), loaded: buildingShellRef.current.size, visible }
      },
      // Same for Phase 4 AI floor-plan units.
      refreshAiFloorUnits: (areaId) => ensureAiFloorUnits(areaId || activeAreaRef.current),
      // Same for Phase 6 GNSS/CORS control points.
      refreshGnssControlPoints: (areaId) => ensureGnssControlPoints(areaId || activeAreaRef.current),
      // Same for Phase 8 underground infrastructure.
      refreshUndergroundInfrastructure: (areaId) => ensureUndergroundInfrastructure(areaId || activeAreaRef.current),
      // Pull freshly-fetched TNGIS public-source parcels into the running viewer
      // (called by the TNGIS Parcels page after a fetch completes).
      refreshTngisParcels: (areaId) => ensureTngisParcels(areaId || activeAreaRef.current),
    }
  }

  // Load a locality's data into the shared scene and make it the active area —
  // WITHOUT moving the camera. Used when a selected entity lives in another
  // locality: the entity's own flyTo* then does the camera work.
  async function loadArea(areaId) {
    if (!liveViewer()) return
    const loc = localityOf(areaId)
    if (!loc) return
    activeAreaRef.current = areaId
    cityViewRef.current = false
    await ensureAreaLayers(areaId)
    await ensureAiBuildings(areaId) // idempotent — picks up any newly-extracted AI buildings
    await ensureAiFloorUnits(areaId) // idempotent — picks up any newly-segmented AI floor-plan units
    await ensureGnssControlPoints(areaId) // idempotent — picks up any newly-imported GNSS/CORS control points
    await ensureUndergroundInfrastructure(areaId) // idempotent — picks up any newly-imported underground infrastructure
    await ensureTngisParcels(areaId) // idempotent — picks up any newly-fetched TNGIS parcels
    if (!liveViewer()) return
    lodRef.current = 'area'
    applyLayerVisibility()
  }

  // Same viewer, same scene — load a locality and move the camera to its overview.
  async function flyToArea(areaId, duration = 1.6) {
    await loadArea(areaId)
    const viewer = liveViewer()
    if (!viewer) return
    const loc = localityOf(areaId)
    if (!loc) return
    const h = loc.cameraHeightM || 1500
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(loc.base.lon, loc.base.lat - h * 6e-6, h),
      orientation: { heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-40), roll: 0 },
      duration,
    })
    viewer.scene.requestRender()
  }

  function flyToCity(duration = 1.6) {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    const c = selRef.current.mapApi.current?.__cityView || CHENNAI_CITY_VIEW
    cityViewRef.current = true
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.cameraHeightM || 26000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
      duration,
    })
    lodRef.current = 'city'
    applyLayerVisibility()
    viewer.scene.requestRender()
  }

  // Lightweight camera-only move to the active locality's overview — no data
  // load, no visibility churn (used when the selection collapses to overview).
  function flyToOverview(duration = 1.4) {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    if (cityViewRef.current) return // parked at Chennai overview — don't yank down to an area
    const loc = localityOf(selRef.current.area?.id || activeAreaRef.current)
    if (!loc) return
    const h = loc.cameraHeightM || 1500
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(loc.base.lon, loc.base.lat - h * 6e-6, h),
      orientation: { heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-40), roll: 0 },
      duration,
    })
  }

  /* --------------------------------------------------- selection reaction */
  useEffect(() => {
    applySelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.selection, sel.isolated])

  // Area changes coming from the TopBar / AreaSelector drive the same camera —
  // but only when the user is at the area overview. When an entity is selected,
  // applySelection() owns the camera (it switches locality itself and then
  // focuses the entity); flying to the area overview here would fight it.
  useEffect(() => {
    if (!ready) return
    if (sel.area?.id && sel.area.id !== activeAreaRef.current && sel.selection?.mode === 'overview') {
      flyToArea(sel.area.id, 1.8)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.area?.id, ready])

  // Resolve which locality a selected entity lives in (cached). Deep links,
  // the Buildings table and the sidebar can all select an entity that belongs
  // to a locality other than the one the camera is currently over — without
  // this the entity is filtered out by `areaOk()` and never focused.
  async function localityForSelection(selection) {
    const { mode, buildingId, infrastructureId, ulpin, propertyId } = selection
    const cache = localityCacheRef.current
    try {
      if ((mode === 'building' || mode === 'floor' || mode === 'unit') && buildingId) {
        const key = `building:${buildingId}`
        if (!cache.has(key)) {
          const res = await api.building(buildingId)
          cache.set(key, res?.building?.locality || null)
        }
        return cache.get(key)
      }
      if (mode === 'unit' && !buildingId && propertyId) {
        const key = `unit:${propertyId}`
        if (!cache.has(key)) {
          const res = await api.unit(propertyId)
          cache.set(key, res?.building?.locality || res?.hierarchy?.building?.locality || null)
        }
        return cache.get(key)
      }
      if (mode === 'infrastructure' && infrastructureId) {
        const key = `infra:${infrastructureId}`
        if (!cache.has(key)) {
          const res = await api.infrastructure(infrastructureId)
          cache.set(key, res?.locality || null)
        }
        return cache.get(key)
      }
      if (mode === 'parcel' && ulpin) {
        const key = `parcel:${ulpin}`
        if (!cache.has(key)) {
          // GET /api/parcels/:ulpin nests locality under `.parcel.locality`
          // (unlike /api/infrastructure/:id and /api/buildings/:id, which are
          // flat/nested-under-their-own-key respectively) — reading the
          // non-existent `res.locality` here silently resolved to null for
          // EVERY parcel, so `loadArea()` below was skipped whenever the
          // selected parcel's locality differed from the already-active one:
          // its entity never got created, and flyToParcel had nothing to fly
          // to (falling back to Cesium's raw default global camera).
          const res = await api.parcel(ulpin)
          cache.set(key, res?.parcel?.locality || null)
        }
        return cache.get(key)
      }
    } catch {
      /* fall through — a failed lookup just means no area switch */
    }
    return null
  }

  // Serialise selection passes. init() and the [sel.selection] effect can both
  // trigger one, and each pass now awaits network round-trips (locality lookup,
  // loadArea) — letting two interleave leaves activeAreaRef and entity
  // visibility in a torn state (both localities visible, camera stuck).
  const applyLockRef = useRef(Promise.resolve())
  function applySelection() {
    const run = applyLockRef.current.then(applySelectionPass).catch(() => {})
    applyLockRef.current = run
    return run
  }

  async function applySelectionPass() {
    if (!liveViewer()) return
    const { selection } = selRef.current
    const { mode, buildingId, propertyId } = selection

    // Switch the camera/data to the selected entity's locality first, so the
    // rest of this pass loads, shows and focuses it in the right place.
    if (['building', 'floor', 'unit', 'infrastructure', 'parcel'].includes(mode)) {
      const targetArea = await localityForSelection(selection)
      if (targetArea && targetArea !== activeAreaRef.current && localityOf(targetArea)) {
        await loadArea(targetArea) // data + activeArea only — the entity flyTo below moves the camera
        if (!liveViewer()) return
        selRef.current.syncArea?.(targetArea) // keep the top-bar locality in step (no extra camera move: activeAreaRef already matches)
      }
    }

    if ((mode === 'building' || mode === 'floor' || mode === 'unit') && buildingId) {
      await ensureUnits(buildingId)
    }
    if (mode === 'floor' && buildingId && selection.floorNumber != null) {
      await ensureFloorVolume(buildingId, selection.floorNumber)
    }
    if (mode === 'ai-building' && selection.aiBuildingId) {
      await ensureAiBuildings(activeAreaRef.current)
    }
    if (mode === 'ai-floor-unit' && selection.aiFloorUnitId) {
      await ensureAiFloorUnits(activeAreaRef.current)
    }
    if (mode === 'gnss-point' && selection.controlPointId) {
      await ensureGnssControlPoints(activeAreaRef.current)
    }
    if (mode === 'infrastructure' && selection.infrastructureId) {
      await ensureUndergroundInfrastructure(activeAreaRef.current)
    }
    if (mode === 'tngis-parcel' && selection.sourceRecordId) {
      await ensureTngisParcels(activeAreaRef.current)
    }
    // Temporary DEMO_VISUALIZATION extrusion for the selected parcel — exactly
    // one at a time; clears itself whenever the selection isn't a parcel.
    if (mode === 'parcel' && selection.ulpin) {
      await updateSelectedParcelExtrusion(selection.ulpin)
    } else if (selectedParcelExtrusionRef.current) {
      liveViewer()?.entities.remove(selectedParcelExtrusionRef.current)
      selectedParcelExtrusionRef.current = null
    }
    const viewer = liveViewer()
    if (!viewer) return

    refreshDetailVisibility()

    // fly camera
    const mapApi = selRef.current.mapApi.current
    if (mode === 'unit' && propertyId) mapApi.flyToUnit?.(propertyId)
    else if ((mode === 'building' || mode === 'floor') && buildingId) mapApi.flyToBuilding?.(buildingId)
    else if (mode === 'parcel') mapApi.flyToParcel?.(selection.ulpin)
    else if (mode === 'ai-building' && selection.aiBuildingId) mapApi.flyToAiBuilding?.(selection.aiBuildingId)
    else if (mode === 'ai-floor-unit' && selection.aiFloorUnitId) mapApi.flyToAiFloorUnit?.(selection.aiFloorUnitId)
    else if (mode === 'gnss-point' && selection.controlPointId) mapApi.flyToGnssPoint?.(selection.controlPointId)
    else if (mode === 'infrastructure' && selection.infrastructureId) mapApi.flyToInfrastructure?.(selection.infrastructureId)
    else if (mode === 'tngis-parcel' && selection.sourceRecordId) mapApi.flyToTngisParcel?.(selection.sourceRecordId)
    else if (mode === 'coimbatore-demo') mapApi.flyToCoimbatoreDemo?.()
    else if (mode === 'overview') flyToOverview(1.4)

    viewer.scene.requestRender()
  }

  // Pure visibility pass — no camera moves, no data loads. Safe to call from
  // layer toggles, LOD changes and area switches without recursion.
  function refreshDetailVisibility() {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    const { selection, isolated, layers: L } = selRef.current
    const { mode, buildingId, floorNumber, propertyId } = selection
    const lod = lodRef.current
    const activeArea = activeAreaRef.current
    const areaOk = (ent) => !ent.__area || ent.__area === '__city' || ent.__area === activeArea

    // City-overview boundaries: always present; active one emphasised.
    for (const [id, pair] of cityAreaRef.current) {
      const on = id === activeArea
      pair.fill.polygon.material = on ? COL.areaFillActive : COL.areaFill
      pair.line.polyline.material = on ? COL.areaLineActive : COL.areaLine
      pair.fill.show = true
      pair.line.show = true
    }

    // Generic overlay/base groups: gated by layer switch + active area + LOD.
    for (const [key, ents] of Object.entries(groupsRef.current)) {
      if (key === 'units3d' || key === 'commonAreas' || key === 'buildings' || key === 'floorVolumes' || key === 'aiFloorUnits' || key === 'gnssControlPoints' || key === 'undergroundInfrastructure' || key === 'tngisParcels') continue
      const layerOn = L[key] ?? true
      for (const ent of ents || []) {
        ent.show = layerOn && areaOk(ent) && lod !== 'city'
      }
    }

    const detailOk = lod !== 'city'

    // Prototype floor volume: visible only for the actively-selected floor.
    for (const [k, ent] of floorVolumeRef.current) {
      const [bId, fNum] = k.split('|')
      ent.show =
        detailOk &&
        areaOk(ent) &&
        (L.floors3d ?? true) &&
        mode === 'floor' &&
        bId === buildingId &&
        Number(fNum) === floorNumber
    }

    // 3D building shells. City-wide: EVERY loaded building is a 3D structure in
    // THIS viewer. At the city overview LOD it is lightweight massing for every
    // locality; at area/building LOD only the active locality's buildings show,
    // as before. The selected building is emphasised (gold shell + raised
    // outline), never the whole city hidden.
    const cityLod = lod === 'city'
    for (const [id, ent] of buildingShellRef.current) {
      const isActive = id === buildingId && mode !== 'overview' && mode !== 'parcel'
      const areaVisible = cityLod ? true : areaOk(ent)
      ent.show = (L.buildings ?? true) && areaVisible && !(isolated && id !== buildingId)
      // Building Labels layer — only at close (building) zoom, own toggle.
      if (ent.label) ent.label.show = Boolean(ent.show) && (L.buildingLabels ?? true) && lod === 'building'
      // Phase 5 — optional height-quality overlay: only buildings with an
      // ACCEPTED elevation-derived height are recoloured; everything else
      // keeps its normal shell colour.
      const elevActive = L.elevationHeightQuality && valueOf(ent.properties?.elevationOverrideActive)
      if (elevActive) {
        const level = valueOf(ent.properties?.elevationConfidenceLevel)
        ent.polygon.material = level === 'HIGH' ? COL.elevationHigh : level === 'MEDIUM' ? COL.elevationMedium : COL.elevationLow
      } else {
        ent.polygon.material = isActive ? COL.buildingShellSel : (ent.__baseMaterial || COL.buildingShell)
      }
      ent.polygon.outlineColor = isActive ? Cesium.Color.fromCssColorString('#f2b807') : COL.outline
    }
    recomputeBuildingStats()

    // parcels highlight
    for (const [ulpin, ent] of parcelEntityRef.current) {
      const isSel = mode === 'parcel' && ulpin === selection.ulpin
      ent.show = (L.parcels ?? true) && detailOk && areaOk(ent)
      ent.polygon.outline = false
      ent.polygon.material = isSel
        ? Cesium.Color.fromCssColorString('#f2b807').withAlpha(0.22)
        : Cesium.Color.fromCssColorString(LAND_USE_COLORS[ent.properties?.landUse?.getValue?.()] || '#3f7fd6').withAlpha(0.16)
    }

    // units
    for (const [pid, ent] of unitEntitiesRef.current) {
      const p = ent.properties
      const bId = valueOf(p.buildingId)
      const fNum = valueOf(p.floorNumber)
      const usage = valueOf(p.usage)
      let show = false
      let material = usage === 'Commercial' ? COL.unitCommercial : COL.unit

      if (bId === buildingId && (mode === 'building' || mode === 'floor' || mode === 'unit')) {
        show = true
        if (mode === 'floor' && fNum !== floorNumber) show = false
        if (mode === 'unit') {
          if (pid === propertyId) {
            material = COL.unitSelected
          } else if (isolated) {
            show = false
          } else {
            material = COL.unitDim
          }
        }
      }
      if (isolated && pid !== propertyId) show = false
      ent.show = show && detailOk && areaOk(ent) && L.units3d
      ent.polygon.material = material
      ent.polygon.outlineColor = pid === propertyId ? Cesium.Color.fromCssColorString('#f2b807') : COL.outline
    }

    // common areas visible with their building unless isolating a unit
    for (const ent of groupsRef.current.commonAreas || []) {
      const bId = valueOf(ent.properties.buildingId)
      ent.show =
        L.commonAreas &&
        detailOk &&
        areaOk(ent) &&
        bId === buildingId &&
        (mode === 'building' || mode === 'floor') &&
        !isolated
    }

    // Phase 4 — AI floor-plan units: own layer, OFF by default. Progressive:
    // only at building-level zoom (not city / area) so the Chennai-wide view and
    // LOD are untouched. The explicitly-selected unit is always shown; isolation
    // hides the rest (existing show/hide pattern, picking preserved).
    for (const [id, ent] of aiFloorUnitsRef.current) {
      const isSel = mode === 'ai-floor-unit' && id === selection.aiFloorUnitId
      let show = (L.aiFloorUnits ?? false) && detailOk && areaOk(ent) && lod === 'building'
      if (mode === 'ai-floor-unit' && !isSel && isolated) show = false
      if (isSel) show = detailOk && areaOk(ent)
      ent.show = show
      if (ent.polygon) {
        ent.polygon.material = isSel
          ? COL.aiFloorUnitSel
          : ent.__review ? COL.aiReview : COL.aiFloorUnit
        ent.polygon.outlineColor = isSel
          ? Cesium.Color.fromCssColorString('#f2b807')
          : COL.aiFloorUnitLine
      }
    }

    // Phase 8 — underground infrastructure: own layer, OFF by default. Visible
    // at area + building zoom (never at the city overview). The selected asset
    // is highlighted gold; isolation hides the rest. Depth-unknown records keep
    // their faded style so they never look like surveyed depth.
    for (const [id, ent] of infraEntitiesRef.current) {
      const isSel = mode === 'infrastructure' && id === selection.infrastructureId
      let show = (L.undergroundInfrastructure ?? false) && detailOk && areaOk(ent)
      if (isolated && !isSel) show = false
      ent.show = show
      const typeColor = COL.infra[valueOf(ent.properties?.type)] || COL.infra.OTHER
      const baseColor = ent.__depthUnknown ? COL.infraUnknownDepth : typeColor
      if (ent.polyline) {
        ent.polyline.material = isSel
          ? COL.infraSelected
          : ent.__depthUnknown
            ? new Cesium.PolylineDashMaterialProperty({ color: COL.infraUnknownDepth, dashLength: 12 })
            : valueOf(ent.properties?.isOfficial)
              ? typeColor
              : new Cesium.PolylineDashMaterialProperty({ color: typeColor, dashLength: 24 })
        ent.polyline.width = isSel ? 10 : Math.max(3, Math.min(14, (valueOf(ent.properties?.diameterM) || valueOf(ent.properties?.widthM) || 0.3) * 12))
      }
      if (ent.cylinder) ent.cylinder.material = (isSel ? COL.infraSelected : baseColor).withAlpha(0.6)
      if (ent.polygon) {
        ent.polygon.material = (isSel ? COL.infraSelected : baseColor).withAlpha(0.35)
        ent.polygon.outlineColor = isSel ? COL.infraSelected : typeColor
      }
    }

    // Phase 6 — GNSS/CORS control points: own layer, OFF by default. Visible
    // at area + building zoom (never at the city overview), coloured by
    // validationStatus; the selected point is highlighted.
    for (const [id, ent] of gnssPointsRef.current) {
      const isSel = mode === 'gnss-point' && id === selection.controlPointId
      ent.show = (L.gnssControlPoints ?? false) && detailOk && areaOk(ent)
      if (ent.point) {
        const status = valueOf(ent.properties?.validationStatus)
        ent.point.color = isSel
          ? COL.gnssSelected
          : status === 'ERROR' ? COL.gnssError : status === 'WARNING' ? COL.gnssWarning : COL.gnssValid
        ent.point.pixelSize = isSel ? 14 : 10
      }
    }

    // Coimbatore — the ONE demonstration property: always shown (see
    // buildCoimbatoreDemoProperty), only its selected-state colour changes.
    if (coimbatoreEntityRef.current) {
      const isSel = mode === 'coimbatore-demo'
      const ent = coimbatoreEntityRef.current
      if (ent.point) {
        ent.point.color = isSel ? COL.coimbatoreDemoSelected : COL.coimbatoreDemo
        ent.point.pixelSize = isSel ? 18 : 14
      }
    }

    // TNGIS / Tamil Nilam — public-source parcels: own layer, OFF by default.
    // Visible at area + building zoom (never at the city overview). The selected
    // parcel is highlighted gold. Every polygon of a MultiPolygon shares the
    // sourceRecordId, so all of a parcel's rings highlight together.
    for (const ent of groupsRef.current.tngisParcels || []) {
      const id = valueOf(ent.properties?.sourceRecordId)
      const isSel = mode === 'tngis-parcel' && id === selection.sourceRecordId
      ent.show = (L.tngisParcels ?? false) && detailOk && areaOk(ent)
      // Selection is shown by the gold fill; the per-parcel ground polyline keeps
      // every boundary crisp and individually distinguishable.
      if (ent.polygon) ent.polygon.material = isSel ? COL.tngisBuildingSel : COL.tngisBuilding
      if (ent.polyline) ent.polyline.material = isSel ? COL.tngisParcelSel : COL.tngisParcelLine
    }
    recomputeTngisStats()
  }

  /* ----------------------------------------------------- layer visibility */
  useEffect(() => {
    applyLayerVisibility()
    viewerRef.current?.scene.requestRender()
    // Turning the TNGIS Parcels layer ON while already zoomed in must load the
    // current viewport immediately (no camera move to wait for).
    if (sel.layers?.tngisParcels && ready) {
      tngisLastBboxRef.current = ''
      loadTngisViewport()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.layers])

  // When the authoritative locality registry (with per-locality building counts)
  // arrives, load any newly-known locality's buildings + refresh the coverage
  // counters. Idempotent — already-loaded buildings are skipped.
  useEffect(() => {
    if (!ready) return
    ensureAllBuildings().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sel.localities])

  function applyLayerVisibility() {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    const L = selRef.current.layers
    viewer.scene.globe.show = L.terrain
    if (viewer.imageryLayers.get(0)) viewer.imageryLayers.get(0).show = L.imagery
    refreshDetailVisibility()
    viewer.scene.requestRender()
  }

  /* --------------------------------------------------------------- render */
  return (
    <div className="relative h-full w-full" data-testid="cesium-map">
      <div ref={hostRef} className="h-full w-full" />

      {ready && buildingStats.loaded > 0 && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-slate-200 bg-surface/95 px-3 py-2 text-[11px] shadow-sm"
          data-testid="building-coverage"
        >
          <p className="font-bold uppercase tracking-wider text-slate-500">Chennai 3D Buildings</p>
          <div className="data-mono mt-1 flex gap-3 text-slate-700">
            <span data-testid="buildings-available">Available: {buildingStats.available.toLocaleString('en-IN')}</span>
            <span data-testid="buildings-loaded">Loaded: {buildingStats.loaded.toLocaleString('en-IN')}</span>
            <span data-testid="buildings-visible">Visible: {buildingStats.visible.toLocaleString('en-IN')}</span>
          </div>
        </div>
      )}

      {ready && sel.layers?.tngisParcels && (
        <div
          className="pointer-events-none absolute bottom-20 left-3 z-10 rounded-lg border border-brass/30 bg-surface/95 px-3 py-2 text-[11px] shadow-sm"
          data-testid="tngis-coverage"
        >
          <p className="font-bold uppercase tracking-wider text-brass">TNGIS Parcels · Official Source</p>
          <div className="data-mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-700">
            <span data-testid="tngis-loaded">Loaded: {tngisStats.loaded.toLocaleString('en-IN')}</span>
            <span data-testid="tngis-visible">Visible: {tngisStats.visible.toLocaleString('en-IN')}</span>
            {tngisStats.inViewFromSource != null && (
              <span data-testid="tngis-in-view">In view (source): {tngisStats.inViewFromSource.toLocaleString('en-IN')}{tngisStats.truncated ? '+' : ''}</span>
            )}
          </div>
          {tngisStats.loaded === 0 && (
            <p className="mt-0.5 text-[10px] text-slate-500">Zoom in over Chennai to stream official parcels for the view.</p>
          )}
        </div>
      )}

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-paper/85 text-sm text-slate-600">
          Loading Chennai 3D scene…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-paper/85 p-6 text-center">
          <div>
            <p className="font-bold text-slate-900">3D map unavailable</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}
