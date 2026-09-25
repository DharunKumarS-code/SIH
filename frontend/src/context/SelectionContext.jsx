import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { PARCEL_ULPIN, DEFAULT_AREA_ID, LOCALITIES_FALLBACK, CHENNAI_CITY_VIEW, CHENNAI_REGIONS, COIMBATORE_DEMO_PROPERTY } from '../lib/constants.js'
import { api } from '../lib/api.js'

const SelectionContext = createContext(null)

// Layer visibility model (spec section 13). Keys map 1:1 to LayerManager rows
// and to entity groups the Cesium map maintains.
export const DEFAULT_LAYERS = {
  // base
  parcels: true,
  ulpinBoundaries: true,
  buildings: true, // city-wide 3D building massing in the one Cesium viewer
  buildingLabels: true, // building id labels — LOD-gated to close zoom
  roads: true,
  imagery: true,
  terrain: true,
  // governance overlays
  recordOfRights: true,
  registration: true,
  buildingPermissions: true,
  landUse: true,
  encumbrances: true,
  propertyTax: true,
  disputes: true,
  masterPlan: true,
  // utility & infra
  waterSupply: false,
  sewerLines: false,
  electricity: false,
  drainage: false,
  gasPipeline: false,
  fiberNetwork: false,
  // environment & restrictions
  waterBodies: true,
  ecoZones: true,
  heritageZones: true,
  coastalZone: true,
  // administrative
  corporationBoundary: true,
  zoneBoundary: true,
  wardBoundary: true,
  // 3D property
  bldg3d: true,
  floors3d: true,
  units3d: true,
  commonAreas: true,
  parking: true,
  // AI extraction (Phase 3) — additive, OFF by default so it never affects the
  // existing map / LOD until a user explicitly turns it on.
  aiBuildings: false,
  // AI floor-plan units (Phase 4) — additive, OFF by default.
  aiFloorUnits: false,
  // Elevation / LiDAR height-quality overlay (Phase 5) — additive, OFF by
  // default. Recolors buildings that have an ACCEPTED elevation-derived
  // height by confidence; never renders raw point clouds.
  elevationHeightQuality: false,
  // GNSS/CORS control points (Phase 6) — additive, OFF by default. Never
  // renders raw survey observations at city scale; per-locality only.
  gnssControlPoints: false,
  // Underground 3D infrastructure (Phase 8) — additive, OFF by default so it
  // never affects the existing map / LOD until a user turns it on. Rendered in
  // the SAME Chennai-wide Cesium viewer; loaded per-locality.
  undergroundInfrastructure: false,
  // TNGIS / Tamil Nilam public-source parcels — additive, OFF by default. Only
  // parcels the user has explicitly fetched (District→Taluk→Village→Survey) are
  // ever rendered; nothing is bulk-loaded. Rendered in the SAME Cesium viewer.
  tngisParcels: false,
}

const areaFromLocality = (loc) => ({
  id: loc.id,
  name: loc.name,
  label: loc.label,
  ulpin: loc.ulpinPrimary,
  base: loc.base,
  zone: loc.zone,
  cameraHeightM: loc.cameraHeightM,
})

const DEFAULT_LOCALITY =
  LOCALITIES_FALLBACK.find((l) => l.id === DEFAULT_AREA_ID) || LOCALITIES_FALLBACK[0]

export function SelectionProvider({ children }) {
  // ONE Chennai-wide environment. `area` says which locality the camera is over;
  // `selection` is the parcel -> building -> floor -> unit drill-down within it.
  const [localities, setLocalities] = useState(LOCALITIES_FALLBACK)
  const localitiesRef = useRef(LOCALITIES_FALLBACK)
  useEffect(() => {
    localitiesRef.current = localities
  }, [localities])
  const [area, setArea] = useState(areaFromLocality(DEFAULT_LOCALITY))
  const [selection, setSelection] = useState({
    mode: 'overview', // overview | parcel | building | floor | unit
    ulpin: DEFAULT_LOCALITY.ulpinPrimary,
    buildingId: null,
    floorNumber: null,
    propertyId: null,
  })
  const [isolated, setIsolated] = useState(false)
  const [layers, setLayers] = useState(DEFAULT_LAYERS)
  const [transparency, setTransparency] = useState(0.35) // dimmed-context alpha

  // The Cesium map registers imperative helpers here (flyTo*, resetView, ...).
  const mapApi = useRef({})

  // Pull the real registry (counts + city view) once; fall back silently.
  useEffect(() => {
    let live = true
    api
      .gisLocalities()
      .then((d) => {
        if (!live || !Array.isArray(d?.localities) || !d.localities.length) return
        setLocalities(d.localities)
        if (d.city) mapApi.current.__cityView = d.city
        setArea((a) => {
          const match = d.localities.find((l) => l.id === a.id)
          return match ? areaFromLocality(match) : a
        })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const selectArea = useCallback((id) => {
    const loc = localitiesRef.current.find((l) => l.id === id)
    if (!loc) return
    setArea(areaFromLocality(loc))
    setIsolated(false)
    setSelection({
      mode: 'overview',
      ulpin: loc.ulpinPrimary,
      buildingId: null,
      floorNumber: null,
      propertyId: null,
    })
    mapApi.current.flyToArea?.(id)
  }, [])

  // Move the "current locality" marker without disturbing the active drill-down
  // selection. Used by the 3D map when a selected entity (deep link, Buildings
  // table, sidebar link) lives in a different locality than the camera.
  const syncArea = useCallback((id) => {
    setArea((a) => {
      if (a?.id === id) return a
      const loc = localitiesRef.current.find((l) => l.id === id)
      return loc ? areaFromLocality(loc) : a
    })
  }, [])

  const cityView = useCallback(() => {
    setIsolated(false)
    setSelection((s) => ({ ...s, mode: 'overview', buildingId: null, floorNumber: null, propertyId: null }))
    mapApi.current.flyToCity?.()
  }, [])

  // Chennai coverage regions (North / Central / South / OMR). Same one camera,
  // same viewer — only the view moves; the TNGIS viewport loader then streams
  // that region's official parcels as the user zooms in.
  const flyToRegion = useCallback((regionId) => {
    const r = CHENNAI_REGIONS.find((x) => x.id === regionId)
    if (!r) return
    // Pure camera move — deliberately does NOT touch `selection` so it never
    // triggers the map's selection-reaction effect (which would fly the camera
    // straight back to the active locality's overview).
    setIsolated(false)
    mapApi.current.flyToLonLat?.(r.lon, r.lat, r.height)
  }, [])

  const selectParcel = useCallback((ulpin) => {
    setIsolated(false)
    setSelection({ mode: 'parcel', ulpin, buildingId: null, floorNumber: null, propertyId: null })
  }, [])

  const selectBuilding = useCallback((buildingId, ulpin) => {
    setIsolated(false)
    setSelection((s) => ({
      mode: 'building',
      ulpin: ulpin || s.ulpin,
      buildingId,
      floorNumber: null,
      propertyId: null,
    }))
  }, [])

  const selectFloor = useCallback((buildingId, floorNumber, ulpin) => {
    setIsolated(false)
    setSelection((s) => ({
      mode: 'floor',
      ulpin: ulpin || s.ulpin,
      buildingId: buildingId || s.buildingId,
      floorNumber,
      propertyId: null,
    }))
  }, [])

  const selectUnit = useCallback((ref) => {
    setSelection((s) => ({
      mode: 'unit',
      ulpin: ref.ulpin || s.ulpin || PARCEL_ULPIN,
      buildingId: ref.buildingId,
      floorNumber: ref.floorNumber ?? null,
      propertyId: ref.propertyId,
    }))
  }, [])

  // Phase 3 — an AI-extracted (candidate) building. Additive selection mode;
  // reuses the same viewer, camera and sidebar.
  const selectAiBuilding = useCallback((aiBuildingId) => {
    setIsolated(false)
    setSelection({ mode: 'ai-building', aiBuildingId, ulpin: null, buildingId: null, floorNumber: null, propertyId: null })
    mapApi.current.flyToAiBuilding?.(aiBuildingId)
  }, [])

  // Phase 4 — an AI floor-plan-derived apartment/unit. Additive selection mode;
  // reuses the same viewer, camera and sidebar.
  const selectAiFloorUnit = useCallback((aiFloorUnitId) => {
    setIsolated(false)
    setSelection({ mode: 'ai-floor-unit', aiFloorUnitId, ulpin: null, buildingId: null, floorNumber: null, propertyId: null })
    mapApi.current.flyToAiFloorUnit?.(aiFloorUnitId)
  }, [])

  // Phase 6 — a GNSS/CORS control point. Additive selection mode; reuses the
  // same viewer, camera and sidebar.
  const selectGnssPoint = useCallback((controlPointId) => {
    setIsolated(false)
    setSelection({ mode: 'gnss-point', controlPointId, ulpin: null, buildingId: null, floorNumber: null, propertyId: null })
    mapApi.current.flyToGnssPoint?.(controlPointId)
  }, [])

  // Phase 8 — an underground infrastructure object. Additive selection mode;
  // reuses the same viewer, camera and sidebar (spec sections 29-30).
  const selectInfrastructure = useCallback((infrastructureId) => {
    setIsolated(false)
    setSelection({ mode: 'infrastructure', infrastructureId, ulpin: null, buildingId: null, floorNumber: null, propertyId: null })
    mapApi.current.flyToInfrastructure?.(infrastructureId)
  }, [])

  // TNGIS / Tamil Nilam — a public-source parcel (by sourceRecordId). Additive
  // selection mode; reuses the same viewer, camera and sidebar.
  const selectTngisParcel = useCallback((sourceRecordId) => {
    setIsolated(false)
    setSelection({ mode: 'tngis-parcel', sourceRecordId, ulpin: null, buildingId: null, floorNumber: null, propertyId: null })
    mapApi.current.flyToTngisParcel?.(sourceRecordId)
  }, [])

  // Coimbatore — the ONE demonstration property (user-provided ODM textured
  // model). Deliberately NOT a locality: it never touches `localities` /
  // `CHENNAI_REGIONS` and is not fetched from the backend/TNGIS pipeline.
  // Additive selection mode; reuses the same viewer, camera and sidebar.
  const selectCoimbatoreDemo = useCallback(() => {
    setIsolated(false)
    setSelection({ mode: 'coimbatore-demo', ulpin: null, buildingId: null, floorNumber: null, propertyId: COIMBATORE_DEMO_PROPERTY.propertyId })
    mapApi.current.flyToCoimbatoreDemo?.()
  }, [])

  const reset = useCallback(() => {
    setIsolated(false)
    setSelection((s) => ({ mode: 'overview', ulpin: s.ulpin, buildingId: null, floorNumber: null, propertyId: null, aiBuildingId: null, aiFloorUnitId: null, infrastructureId: null, sourceRecordId: null }))
    mapApi.current.resetView?.()
  }, [])

  const toggleLayer = useCallback((key) => {
    setLayers((l) => ({ ...l, [key]: !l[key] }))
  }, [])

  const setLayerGroup = useCallback((keys, value) => {
    setLayers((l) => {
      const next = { ...l }
      keys.forEach((k) => {
        next[k] = value
      })
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      localities,
      area,
      selectArea,
      syncArea,
      cityView,
      cityViewTarget: CHENNAI_CITY_VIEW,
      flyToRegion,
      regions: CHENNAI_REGIONS,
      selection,
      isolated,
      setIsolated,
      layers,
      toggleLayer,
      setLayerGroup,
      transparency,
      setTransparency,
      mapApi,
      selectParcel,
      selectBuilding,
      selectFloor,
      selectUnit,
      selectAiBuilding,
      selectAiFloorUnit,
      selectGnssPoint,
      selectInfrastructure,
      selectTngisParcel,
      selectCoimbatoreDemo,
      reset,
    }),
    [
      localities,
      area,
      selectArea,
      syncArea,
      cityView,
      flyToRegion,
      selection,
      isolated,
      layers,
      transparency,
      toggleLayer,
      setLayerGroup,
      selectParcel,
      selectBuilding,
      selectFloor,
      selectUnit,
      selectAiBuilding,
      selectAiFloorUnit,
      selectGnssPoint,
      selectInfrastructure,
      selectTngisParcel,
      selectCoimbatoreDemo,
      reset,
    ],
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export const useSelection = () => {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider')
  return ctx
}
