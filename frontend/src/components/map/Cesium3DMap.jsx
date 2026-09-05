import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useSelection } from '../../context/SelectionContext.jsx'
import { applyGrading } from '../../lib/cesiumGrading.js'
import { api } from '../../lib/api.js'
import { PARCEL_ULPIN, DEFAULT_AREA_ID, CHENNAI_CITY_VIEW } from '../../lib/constants.js'
import { LAND_USE_COLORS } from '../../lib/format.js'

const CESIUM_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN

const ring = (geometry) => {
  const coords = geometry?.coordinates?.[0] || []
  const flat = []
  for (const [lon, lat] of coords) flat.push(lon, lat)
  return flat
}
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// Camera-height bands that gate progressive detail. ONE scene, ONE camera —
// selecting an area only moves the camera and flips visibility.
const LOD = { CITY: 5200, AREA: 750 } // > CITY: city  | CITY..AREA: area  | < AREA: building/unit

const COL = {
  buildingShell: Cesium.Color.fromCssColorString('#8b97ad').withAlpha(0.28),
  buildingShellSel: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.12),
  unit: Cesium.Color.fromCssColorString('#9aa7bd').withAlpha(0.92),
  unitCommercial: Cesium.Color.fromCssColorString('#d99b3f').withAlpha(0.9),
  unitSelected: Cesium.Color.fromCssColorString('#f2b807'),
  unitDim: Cesium.Color.fromCssColorString('#9aa7bd').withAlpha(0.08),
  common: Cesium.Color.fromCssColorString('#38c9d6').withAlpha(0.5),
  outline: Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.6),
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
}

// AI buildings have no surveyed height — extrude with a clearly-flagged
// ESTIMATED / DEMO value only (heightStatus stays UNAVAILABLE in the record).
const ESTIMATED_AI_HEIGHT_M = 24
// AI floor-plan units without a floor z-range: a thin ESTIMATED/DEMO slab only.
const ESTIMATED_AI_UNIT_HEIGHT_M = 3

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
  const buildingShellRef = useRef(new Map()) // buildingId -> Entity
  const parcelEntityRef = useRef(new Map()) // ulpin -> Entity
  const aiBuildingsRef = useRef(new Map()) // aiBuildingId -> Entity (Phase 3, AI_DEMO)
  const aiFloorUnitsRef = useRef(new Map()) // aiFloorUnitId -> Entity (Phase 4, AI_DEMO)
  const gnssPointsRef = useRef(new Map()) // controlPointId -> Entity (Phase 6, GNSS/CORS DEMO)
  const cityAreaRef = useRef(new Map()) // areaId -> { fill, line }
  const activeAreaRef = useRef(DEFAULT_AREA_ID)
  const lodRef = useRef('area')
  const cityViewRef = useRef(false) // true while the camera is parked at the Chennai overview

  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

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
      if (cancelled) return

      registerMapApi(viewer)
      installPicker(viewer)
      installLod(viewer)

      // ONE Chennai-wide scene: a cheap city-overview layer that is always
      // resident, then demand-load the starting locality's detail.
      buildCityOverview(viewer)
      const startArea = selRef.current.area?.id || DEFAULT_AREA_ID
      activeAreaRef.current = startArea
      await ensureAreaLayers(startArea)
      if (cancelled) return

      flyToArea(startArea, 0)
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
      for (const f of buildings.features || []) {
        const base = finite(f.properties.baseElevationM) ? f.properties.baseElevationM : 0
        const top = finite(f.properties.heightM) ? base + f.properties.heightM : base + 30
        const ent = addPolygon('buildings', f.geometry, {
          material: COL.buildingShell,
          outline: true,
          height: base,
          extrudedHeight: top,
          properties: { kind: 'building', ...f.properties },
        })
        if (ent) buildingShellRef.current.set(f.properties.buildingId, ent)
      }
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

  async function ensureUnits(buildingId) {
    if (!buildingId || loadedBuildingsRef.current.has(buildingId)) return
    loadedBuildingsRef.current.add(buildingId)
    if (!liveViewer()) return
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
        ent.__area = areaId
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
        ent.__area = areaId
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
      } else if (kind === 'parcel') {
        s.selectParcel(valueOf(props.ulpin))
      } else if (kind === 'ai-building') {
        s.selectAiBuilding(valueOf(props.aiBuildingId))
      } else if (kind === 'ai-floor-unit') {
        s.selectAiFloorUnit(valueOf(props.aiFloorUnitId))
      } else if (kind === 'gnss-point') {
        s.selectGnssPoint(valueOf(props.controlPointId))
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
    lodCleanupRef.current = () => {
      if (raf) cancelAnimationFrame(raf)
      viewer.camera.changed.removeEventListener(onChange)
    }
  }

  /* ------------------------------------------------------------- camera api */
  function registerMapApi(viewer) {
    const api2 = selRef.current.mapApi
    api2.current = {
      ...api2.current,
      resetView: () => flyToArea(activeAreaRef.current, 1.4),
      flyToArea: (areaId, duration) => flyToArea(areaId, duration),
      flyToCity: () => flyToCity(1.6),
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
      flyToParcel: (ulpin) => {
        const ent = parcelEntityRef.current.get(ulpin)
        if (ent) viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 600) }).catch(() => {})
      },
      flyToBuilding: (buildingId) => {
        const ent = buildingShellRef.current.get(buildingId)
        if (ent) viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(35), Cesium.Math.toRadians(-30), 260) }).catch(() => {})
      },
      flyToUnit: (propertyId) => {
        const ent = unitEntitiesRef.current.get(propertyId)
        if (ent) viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(40), Cesium.Math.toRadians(-22), 90) }).catch(() => {})
      },
      flyToAiBuilding: (aiBuildingId) => {
        const ent = aiBuildingsRef.current.get(aiBuildingId)
        if (ent) viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(35), Cesium.Math.toRadians(-28), 220) }).catch(() => {})
      },
      flyToAiFloorUnit: (aiFloorUnitId) => {
        const ent = aiFloorUnitsRef.current.get(aiFloorUnitId)
        if (ent) viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(40), Cesium.Math.toRadians(-24), 120) }).catch(() => {})
      },
      flyToGnssPoint: (controlPointId) => {
        const ent = gnssPointsRef.current.get(controlPointId)
        if (ent) viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(30), Cesium.Math.toRadians(-35), 80) }).catch(() => {})
      },
      // Pull freshly-extracted AI buildings into the running viewer (called by
      // the AI Building Extraction page after an inference completes).
      refreshAiBuildings: (areaId) => ensureAiBuildings(areaId || activeAreaRef.current),
      // Same for Phase 4 AI floor-plan units.
      refreshAiFloorUnits: (areaId) => ensureAiFloorUnits(areaId || activeAreaRef.current),
      // Same for Phase 6 GNSS/CORS control points.
      refreshGnssControlPoints: (areaId) => ensureGnssControlPoints(areaId || activeAreaRef.current),
    }
  }

  // Same viewer, same scene — just move the camera to a locality and load it.
  async function flyToArea(areaId, duration = 1.6) {
    if (!liveViewer()) return
    const loc = localityOf(areaId)
    if (!loc) return
    activeAreaRef.current = areaId
    cityViewRef.current = false
    await ensureAreaLayers(areaId)
    await ensureAiBuildings(areaId) // idempotent — picks up any newly-extracted AI buildings
    await ensureAiFloorUnits(areaId) // idempotent — picks up any newly-segmented AI floor-plan units
    await ensureGnssControlPoints(areaId) // idempotent — picks up any newly-imported GNSS/CORS control points
    const viewer = liveViewer()
    if (!viewer) return
    const h = loc.cameraHeightM || 1500
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(loc.base.lon, loc.base.lat - h * 6e-6, h),
      orientation: { heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-34), roll: 0 },
      duration,
    })
    lodRef.current = 'area'
    applyLayerVisibility()
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
      orientation: { heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-34), roll: 0 },
      duration,
    })
  }

  /* --------------------------------------------------- selection reaction */
  useEffect(() => {
    applySelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.selection, sel.isolated])

  // Area changes coming from the TopBar / AreaSelector drive the same camera.
  useEffect(() => {
    if (!ready) return
    if (sel.area?.id && sel.area.id !== activeAreaRef.current) {
      flyToArea(sel.area.id, 1.8)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.area?.id, ready])

  async function applySelection() {
    if (!liveViewer()) return
    const { selection } = selRef.current
    const { mode, buildingId, propertyId } = selection

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
      if (key === 'units3d' || key === 'commonAreas' || key === 'buildings' || key === 'floorVolumes' || key === 'aiFloorUnits' || key === 'gnssControlPoints') continue
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

    // building shells: hide the active building's shell so its units are visible
    for (const [id, ent] of buildingShellRef.current) {
      const active = id === buildingId && mode !== 'overview' && mode !== 'parcel'
      ent.show =
        L.buildings && detailOk && areaOk(ent) && !(isolated && id !== buildingId)
      // Phase 5 — optional height-quality overlay: only buildings with an
      // ACCEPTED elevation-derived height are recoloured; everything else
      // keeps its normal shell colour.
      const elevActive = L.elevationHeightQuality && valueOf(ent.properties?.elevationOverrideActive)
      if (elevActive) {
        const level = valueOf(ent.properties?.elevationConfidenceLevel)
        ent.polygon.material = level === 'HIGH' ? COL.elevationHigh : level === 'MEDIUM' ? COL.elevationMedium : COL.elevationLow
      } else {
        ent.polygon.material = active ? COL.buildingShellSel : COL.buildingShell
      }
    }

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
  }

  /* ----------------------------------------------------- layer visibility */
  useEffect(() => {
    applyLayerVisibility()
    viewerRef.current?.scene.requestRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.layers])

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
      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-navy-950/60 text-sm text-slate-300">
          Loading Chennai 3D scene…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-navy-950/80 p-6 text-center">
          <div>
            <p className="font-bold text-white">3D map unavailable</p>
            <p className="mt-1 max-w-sm text-sm text-slate-400">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}
