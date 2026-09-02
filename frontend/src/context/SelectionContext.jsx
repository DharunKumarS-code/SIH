import { createContext, useContext, useMemo, useRef, useState, useCallback } from 'react'
import { PARCEL_ULPIN } from '../lib/constants.js'

const SelectionContext = createContext(null)

// Layer visibility model (spec section 13). Keys map 1:1 to LayerManager rows
// and to entity groups the Cesium map maintains.
export const DEFAULT_LAYERS = {
  // base
  parcels: true,
  ulpinBoundaries: true,
  buildings: true,
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
}

export function SelectionProvider({ children }) {
  const [selection, setSelection] = useState({
    mode: 'overview', // overview | parcel | building | floor | unit
    ulpin: PARCEL_ULPIN,
    buildingId: null,
    floorNumber: null,
    propertyId: null,
  })
  const [isolated, setIsolated] = useState(false)
  const [layers, setLayers] = useState(DEFAULT_LAYERS)
  const [transparency, setTransparency] = useState(0.35) // dimmed-context alpha

  // The Cesium map registers imperative helpers here (flyTo*, resetView, ...).
  const mapApi = useRef({})

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
    setSelection({
      mode: 'unit',
      ulpin: ref.ulpin || PARCEL_ULPIN,
      buildingId: ref.buildingId,
      floorNumber: ref.floorNumber ?? null,
      propertyId: ref.propertyId,
    })
  }, [])

  const reset = useCallback(() => {
    setIsolated(false)
    setSelection({ mode: 'overview', ulpin: PARCEL_ULPIN, buildingId: null, floorNumber: null, propertyId: null })
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
      reset,
    }),
    [selection, isolated, layers, transparency, toggleLayer, setLayerGroup, selectParcel, selectBuilding, selectFloor, selectUnit, reset],
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export const useSelection = () => {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider')
  return ctx
}
