import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useSelection } from '../../context/SelectionContext.jsx'
import { applyGrading } from '../../lib/cesiumGrading.js'
import { api } from '../../lib/api.js'
import { CHENNAI_BASE, PARCEL_ULPIN } from '../../lib/constants.js'
import { LAND_USE_COLORS } from '../../lib/format.js'

const CESIUM_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN

const ring = (geometry) => {
  const coords = geometry?.coordinates?.[0] || []
  const flat = []
  for (const [lon, lat] of coords) flat.push(lon, lat)
  return flat
}
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

const COL = {
  buildingShell: Cesium.Color.fromCssColorString('#8b97ad').withAlpha(0.28),
  buildingShellSel: Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.12),
  unit: Cesium.Color.fromCssColorString('#9aa7bd').withAlpha(0.92),
  unitCommercial: Cesium.Color.fromCssColorString('#d99b3f').withAlpha(0.9),
  unitSelected: Cesium.Color.fromCssColorString('#f2b807'),
  unitDim: Cesium.Color.fromCssColorString('#9aa7bd').withAlpha(0.08),
  common: Cesium.Color.fromCssColorString('#38c9d6').withAlpha(0.5),
  outline: Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.6),
}

export function Cesium3DMap() {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const gradingCleanupRef = useRef(null)
  const handlerRef = useRef(null)
  const groupsRef = useRef({}) // layerKey -> Entity[]
  const unitEntitiesRef = useRef(new Map()) // propertyId -> Entity
  const loadedBuildingsRef = useRef(new Set())
  const buildingShellRef = useRef(new Map()) // buildingId -> Entity
  const parcelEntityRef = useRef(new Map()) // ulpin -> Entity

  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const sel = useSelection()
  const selRef = useRef(sel)
  selRef.current = sel

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

      await loadBaseLayers(viewer)
      if (cancelled) return

      flyToOverview(viewer, 0)
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
      gradingCleanupRef.current?.()
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
      viewerRef.current = null
      window.__map = { ready: false }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------ base data */
  async function loadBaseLayers(viewer) {
    const groups = groupsRef.current
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
      })
      ;(groups[layerKey] ||= []).push(ent)
    }

    try {
      const parcels = await api.gisParcels()
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
      const buildings = await api.gisBuildings()
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

    // overlays
    try {
      const roads = await api.gisLayer('roads')
      for (const f of roads.features || []) addLine('roads', f.geometry, Cesium.Color.fromCssColorString('#c9d2e3').withAlpha(0.75), 3)
    } catch { /* ignore */ }
    try {
      const utils = await api.gisLayer('utilities')
      const uColor = { 'Water Supply': '#4fa9ff', 'Sewer Line': '#9b7b4f', Electricity: '#f2b807', Drainage: '#4fbf9f', 'Gas Pipeline': '#e4566e', 'Fiber Network': '#a86fd1' }
      for (const f of utils.features || []) {
        const key = { 'Water Supply': 'waterSupply', 'Sewer Line': 'sewerLines', Electricity: 'electricity', Drainage: 'drainage', 'Gas Pipeline': 'gasPipeline', 'Fiber Network': 'fiberNetwork' }[f.properties.type]
        addLine(key || 'utilities', f.geometry, Cesium.Color.fromCssColorString(uColor[f.properties.type] || '#8b97ad'), 2)
      }
    } catch { /* ignore */ }
    try {
      const env = await api.gisLayer('environment')
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
      const bounds = await api.gisLayer('boundaries')
      const map = { 'Corporation Boundary': 'corporationBoundary', 'Zone Boundary': 'zoneBoundary', 'Ward Boundary': 'wardBoundary' }
      for (const f of bounds.features || []) {
        const key = map[f.properties.level] || 'zoneBoundary'
        addPolygon(key, f.geometry, { material: Cesium.Color.TRANSPARENT, outline: false, clamp: true, properties: { kind: 'boundary', ...f.properties } })
        addLine(key, { coordinates: (f.geometry.coordinates[0] || []) }, Cesium.Color.fromCssColorString('#4784f5').withAlpha(0.5), 2)
      }
    } catch { /* ignore */ }
    try {
      const mp = await api.gisLayer('master-plan')
      for (const f of mp.features || []) addPolygon('masterPlan', f.geometry, { material: Cesium.Color.fromCssColorString('#a86fd1').withAlpha(0.08), clamp: true, properties: { kind: 'masterplan', ...f.properties } })
    } catch { /* ignore */ }
    try {
      const dsp = await api.gisLayer('disputes')
      for (const f of dsp.features || []) {
        if (f.geometry?.type !== 'Point') continue
        const [lon, lat] = f.geometry.coordinates
        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 60),
          point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#e4566e'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
          properties: { kind: 'dispute', ...f.properties },
        })
        ;(groups.disputes ||= []).push(ent)
      }
    } catch { /* ignore */ }

    applyLayerVisibility()
    viewer.scene.requestRender()
  }

  async function ensureUnits(buildingId) {
    if (!buildingId || loadedBuildingsRef.current.has(buildingId)) return
    loadedBuildingsRef.current.add(buildingId)
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    try {
      const [units, commons] = await Promise.all([
        api.gisUnits({ buildingId }),
        api.gisCommonAreas({ buildingId }),
      ])
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
        ;(groupsRef.current.commonAreas ||= []).push(ent)
      }
    } catch (e) {
      console.warn('unit load failed', e)
    }
  }

  /* --------------------------------------------------------------- picking */
  function installPicker(viewer) {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handlerRef.current = handler
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position)
      const props = picked?.id?.properties
      if (!props) return
      const kind = props.kind?.getValue?.() ?? props.kind
      const s = selRef.current
      if (kind === 'unit') {
        s.selectUnit({
          propertyId: valueOf(props.propertyId),
          buildingId: valueOf(props.buildingId),
          floorNumber: valueOf(props.floorNumber),
          ulpin: valueOf(props.ulpin) || PARCEL_ULPIN,
        })
      } else if (kind === 'building') {
        s.selectBuilding(valueOf(props.buildingId), valueOf(props.ulpin))
      } else if (kind === 'parcel') {
        s.selectParcel(valueOf(props.ulpin))
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }
  const valueOf = (p) => (p?.getValue ? p.getValue(Cesium.JulianDate.now()) : p)

  /* ------------------------------------------------------------- camera api */
  function registerMapApi(viewer) {
    const api2 = selRef.current.mapApi
    api2.current = {
      resetView: () => flyToOverview(viewer, 1.4),
      topView: () => {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(CHENNAI_BASE.lon, CHENNAI_BASE.lat, 1400),
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
    }
  }

  function flyToOverview(viewer, duration = 1.4) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(CHENNAI_BASE.lon, CHENNAI_BASE.lat - 0.006, 620),
      orientation: { heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-32), roll: 0 },
      duration,
    })
  }

  /* --------------------------------------------------- selection reaction */
  useEffect(() => {
    applySelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.selection, sel.isolated])

  async function applySelection() {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    const { selection, isolated } = selRef.current
    const { mode, buildingId, floorNumber, propertyId } = selection

    if ((mode === 'building' || mode === 'floor' || mode === 'unit') && buildingId) {
      await ensureUnits(buildingId)
    }

    // building shells: hide the active building's shell so its units are visible
    for (const [id, ent] of buildingShellRef.current) {
      const active = id === buildingId && mode !== 'overview' && mode !== 'parcel'
      ent.show = selRef.current.layers.buildings && !(isolated && id !== buildingId)
      ent.polygon.material = active ? COL.buildingShellSel : COL.buildingShell
    }

    // parcels highlight
    for (const [ulpin, ent] of parcelEntityRef.current) {
      const isSel = mode === 'parcel' && ulpin === selection.ulpin
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
      ent.show = show && selRef.current.layers.units3d
      ent.polygon.material = material
      ent.polygon.outlineColor = pid === propertyId ? Cesium.Color.fromCssColorString('#f2b807') : COL.outline
    }

    // common areas visible with their building unless isolating a unit
    for (const ent of groupsRef.current.commonAreas || []) {
      const bId = valueOf(ent.properties.buildingId)
      ent.show =
        selRef.current.layers.commonAreas &&
        bId === buildingId &&
        (mode === 'building' || mode === 'floor') &&
        !isolated
    }

    // fly camera
    const mapApi = selRef.current.mapApi.current
    if (mode === 'unit' && propertyId) mapApi.flyToUnit?.(propertyId)
    else if ((mode === 'building' || mode === 'floor') && buildingId) mapApi.flyToBuilding?.(buildingId)
    else if (mode === 'parcel') mapApi.flyToParcel?.(selection.ulpin)
    else if (mode === 'overview') flyToOverview(viewer, 1.4)

    viewer.scene.requestRender()
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
    for (const [key, ents] of Object.entries(groupsRef.current)) {
      const visible = L[key] ?? true
      for (const ent of ents || []) {
        // units3d / buildings / commonAreas visibility is also governed by applySelection;
        // here we only force-hide when the layer is switched off.
        if (!visible) ent.show = false
        else if (key !== 'units3d' && key !== 'commonAreas' && key !== 'buildings') ent.show = true
      }
    }
    applySelection()
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
