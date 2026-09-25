import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE || '' // '' -> Vite proxy in dev

export const http = axios.create({ baseURL: `${baseURL}/api`, timeout: 20000 })

let token = null
try {
  token = localStorage.getItem('landstack.token')
} catch {
  /* storage unavailable */
}
if (token) http.defaults.headers.common.Authorization = `Bearer ${token}`

export function setAuthToken(next) {
  token = next
  try {
    if (next) localStorage.setItem('landstack.token', next)
    else localStorage.removeItem('landstack.token')
  } catch {
    /* ignore */
  }
  if (next) http.defaults.headers.common.Authorization = `Bearer ${next}`
  else delete http.defaults.headers.common.Authorization
}

// Unwrap the { ok, data, meta } envelope; surface a readable error message.
const unwrap = (p) =>
  p.then((r) => r.data?.data ?? r.data).catch((err) => {
    const msg = err.response?.data?.error?.message || err.message || 'Request failed'
    const e = new Error(msg)
    e.status = err.response?.status
    e.details = err.response?.data?.error?.details
    throw e
  })

const get = (url, params, config) => unwrap(http.get(url, { params, ...config }))
const post = (url, body) => unwrap(http.post(url, body))

export const api = {
  // auth
  login: (username, password) => post('/auth/login', { username, password }),
  register: (payload) => post('/auth/register', payload),
  me: () => get('/auth/me'),

  // land
  parcels: (params) => get('/parcels', params),
  parcel: (ulpin) => get(`/parcels/${encodeURIComponent(ulpin)}`),
  parcelProvenance: (ulpin) => get(`/parcels/${encodeURIComponent(ulpin)}/provenance`),
  verifyParcel: (ulpin) => post(`/parcels/${encodeURIComponent(ulpin)}/verify`),
  landSources: () => get('/land-sources'),
  governanceOverview: () => get('/governance/overview'), // Phase 10
  ulpins: () => get('/ulpins'),

  // property hierarchy
  buildings: (params) => get('/buildings', params),
  building: (id) => get(`/buildings/${encodeURIComponent(id)}`),
  buildingFloors: (id) => get(`/buildings/${encodeURIComponent(id)}/floors`),
  generateBuildingThreeDUlpin: (id) => post(`/buildings/${encodeURIComponent(id)}/generate-3d-ulpin`),
  floor: (id) => get(`/floors/${encodeURIComponent(id)}`),
  units: (params) => get('/units', params),
  unit: (propertyId) => get(`/units/${encodeURIComponent(propertyId)}`),
  verifyUnit: (propertyId) => post(`/units/${encodeURIComponent(propertyId)}/verify`),
  generateUnitThreeDUlpin: (propertyId) => post(`/units/${encodeURIComponent(propertyId)}/generate-3d-ulpin`),
  commonAreas: (params) => get('/common-areas', params),

  // governance
  ror: (ulpin) => get(`/ror/${encodeURIComponent(ulpin)}`),
  registration: (ulpin, propertyId) => get(`/registration/${encodeURIComponent(ulpin)}`, { propertyId }),
  encumbrance: (ulpin, propertyId) => get(`/encumbrance/${encodeURIComponent(ulpin)}`, { propertyId }),
  propertyTax: (ulpin, propertyId) => get(`/property-tax/${encodeURIComponent(ulpin)}`, { propertyId }),
  buildingApproval: (buildingId) => get(`/building-approval/${encodeURIComponent(buildingId)}`),
  landUseZone: (ulpin) => get(`/land-use/${encodeURIComponent(ulpin)}`),
  masterPlan: () => get('/master-plan'),
  interop: (ulpin, propertyId) => get(`/interop/${encodeURIComponent(ulpin)}`, { propertyId }),

  // gis
  gisLocalities: () => get('/gis/localities'),
  gisParcels: (params) => get('/gis/parcels', params),
  gisBuildings: (params) => get('/gis/buildings', params),
  gisUnits: (params) => get('/gis/units', params),
  gisCommonAreas: (params) => get('/gis/common-areas', params),
  gisLayer: (layer, params) => get(`/gis/layer/${layer}`, params),
  gisAiBuildings: (params) => get('/gis/ai-buildings', params),
  gisAiFloorUnits: (params) => get('/gis/ai-floor-units', params),
  gisUndergroundInfrastructure: (params) => get('/gis/underground-infrastructure', params),
  gisTngisParcels: (params) => get('/gis/tngis-parcels', params),
  // Chennai-wide viewport (BBOX) parcel loader — bbox="minLon,minLat,maxLon,maxLat".
  // Accepts an AbortController signal so a superseded pan cancels its request.
  gisTngisParcelsBbox: (params, config) => get('/gis/tngis-parcels/bbox', params, config),

  // dashboards
  dashboard: () => get('/dashboard/stats'),
  analytics: () => get('/analytics'),

  // disputes
  disputes: (params) => get('/disputes', params),
  dispute: (id) => get(`/disputes/${encodeURIComponent(id)}`),

  // ai
  aiStatus: () => get('/ai/status'),
  aiRun: (feature, payload) => post(`/ai/${feature}`, payload),

  // ai — building-footprint extraction (Phase 3)
  aiInferBuildings: (formData) =>
    unwrap(http.post('/ai/buildings/infer', formData, { timeout: 60000 })),
  aiBuildingsList: (params) => get('/ai/buildings', params),
  aiBuilding: (id) => get(`/ai/buildings/${encodeURIComponent(id)}`),
  aiBuildingReview: (id, reviewStatus) =>
    unwrap(http.patch(`/ai/buildings/${encodeURIComponent(id)}/review`, { reviewStatus })),
  aiJob: (id) => get(`/ai/jobs/${encodeURIComponent(id)}`),

  // ai — floor-plan & apartment/unit segmentation (Phase 4)
  aiInferFloorPlan: (formData) =>
    unwrap(http.post('/ai/floorplans/infer', formData, { timeout: 90000 })),
  aiFloorPlans: (params) => get('/ai/floorplans', params),
  aiFloorPlan: (id) => get(`/ai/floorplans/${encodeURIComponent(id)}`),
  aiFloorPlanRooms: (id) => get(`/ai/floorplans/${encodeURIComponent(id)}/rooms`),
  aiFloorPlanUnits: (id) => get(`/ai/floorplans/${encodeURIComponent(id)}/units`),
  aiFloorPlanValidation: (id) => get(`/ai/floorplans/${encodeURIComponent(id)}/validation`),
  aiFloorPlanStatus: (id) => get(`/ai/floorplans/${encodeURIComponent(id)}/status`),
  aiFloorPlanReview: (id, reviewStatus) =>
    unwrap(http.patch(`/ai/floorplans/${encodeURIComponent(id)}/review`, { reviewStatus })),
  aiFloorUnit: (id) => get(`/ai/floor-units/${encodeURIComponent(id)}`),
  aiFloorUnitReview: (id, reviewStatus) =>
    unwrap(http.patch(`/ai/floor-units/${encodeURIComponent(id)}/review`, { reviewStatus })),

  // ai — elevation / LiDAR / DEM / DSM (Phase 5)
  elevationConfig: () => get('/elevation/config'),
  elevationUpload: (formData) =>
    unwrap(http.post('/elevation/upload', formData, { timeout: 60000 })),
  elevationProcess: (formData) =>
    unwrap(http.post('/elevation/process', formData, { timeout: 90000 })),
  elevationDatasets: (params) => get('/elevation/datasets', params),
  elevationDataset: (id) => get(`/elevation/datasets/${encodeURIComponent(id)}`),
  elevationDatasetStatus: (id) => get(`/elevation/datasets/${encodeURIComponent(id)}/status`),
  elevationCoverage: (params) => get('/elevation/coverage', params),
  elevationBuildingHeight: (buildingId) => get(`/elevation/buildings/${encodeURIComponent(buildingId)}/height`),
  elevationBuildingQuality: (buildingId) => get(`/elevation/buildings/${encodeURIComponent(buildingId)}/quality`),
  elevationReview: (buildingId, action) =>
    unwrap(http.patch(`/elevation/buildings/${encodeURIComponent(buildingId)}/review`, { action })),
  elevationRevert: (buildingId) =>
    unwrap(http.post(`/elevation/buildings/${encodeURIComponent(buildingId)}/revert`)),

  // gnss — GNSS/CORS high-precision spatial control (Phase 6)
  gnssConfig: () => get('/gnss/config'),
  gnssValidate: (formData) => unwrap(http.post('/gnss/control-points/validate', formData, { timeout: 30000 })),
  gnssImport: (formData) => unwrap(http.post('/gnss/control-points/import', formData, { timeout: 30000 })),
  gnssControlPoints: (params) => get('/gnss/control-points', params),
  gnssControlPoint: (id) => get(`/gnss/control-points/${encodeURIComponent(id)}`),
  gnssControlPointValidation: (id) => get(`/gnss/control-points/${encodeURIComponent(id)}/validation`),
  gnssControlPointElevationResidual: (id) => get(`/gnss/control-points/${encodeURIComponent(id)}/elevation-residual`),
  gnssParcelControlPoints: (ulpin) => get(`/gnss/parcels/${encodeURIComponent(ulpin)}/control-points`),
  gnssParcelBoundaryVerification: (ulpin) => get(`/gnss/parcels/${encodeURIComponent(ulpin)}/boundary-verification`),
  gnssBoundaryAnalysis: (payload) => post('/gnss/boundary-analysis', payload),
  gnssTransform: (payload) => post('/gnss/transform', payload),
  gnssReview: (controlPointId, action) => post('/gnss/review', { controlPointId, action }),
  gnssCreateProposal: (payload) => post('/gnss/proposals', payload),
  gnssProposals: (params) => get('/gnss/proposals', params),
  gnssProposal: (id) => get(`/gnss/proposals/${encodeURIComponent(id)}`),
  gnssReviewProposal: (id, action) => unwrap(http.patch(`/gnss/proposals/${encodeURIComponent(id)}/review`, { action })),
  gisGnssControlPoints: (params) => get('/gis/gnss-control-points', params),

  // topology — intelligent 2D/3D topology validation engine (Phase 7)
  topologyConfig: () => get('/topology/config'),
  topologyValidateAll: (params) => unwrap(http.post('/topology/validate', {}, { params })),
  topologyValidateArea: (areaId, params) => unwrap(http.post(`/topology/validate/area/${encodeURIComponent(areaId)}`, {}, { params })),
  topologyValidateParcel: (ulpin, params) => unwrap(http.post(`/topology/validate/parcel/${encodeURIComponent(ulpin)}`, {}, { params })),
  topologyValidateBuilding: (buildingId, params) => unwrap(http.post(`/topology/validate/building/${encodeURIComponent(buildingId)}`, {}, { params })),
  topologyValidateFloor: (floorId, params) => unwrap(http.post(`/topology/validate/floor/${encodeURIComponent(floorId)}`, {}, { params })),
  topologyValidateUnit: (propertyId, params) => unwrap(http.post(`/topology/validate/unit/${encodeURIComponent(propertyId)}`, {}, { params })),
  topologyResults: (params) => get('/topology/results', params),
  topologyResult: (id, params) => get(`/topology/results/${encodeURIComponent(id)}`, params),
  topologySummary: (params) => get('/topology/summary', params),
  topologyReviewFinding: (runId, validationId, action) =>
    unwrap(http.patch(`/topology/results/${encodeURIComponent(runId)}/findings/${encodeURIComponent(validationId)}/review`, { action })),

  // underground — Phase 8: underground 3D infrastructure mapping
  infrastructureConfig: () => get('/infrastructure/config'),
  infrastructureSummary: (params) => get('/infrastructure/summary', params),
  infrastructureList: (params) => get('/infrastructure', params),
  infrastructure: (id) => get(`/infrastructure/${encodeURIComponent(id)}`),
  infrastructureRelations: (id) => get(`/infrastructure/${encodeURIComponent(id)}/relations`),
  infrastructureElevation: (id) => get(`/infrastructure/${encodeURIComponent(id)}/elevation`),
  infrastructureUploadValidate: (formData) => unwrap(http.post('/infrastructure/upload', formData, { timeout: 30000 })),
  infrastructureImport: (formData) => unwrap(http.post('/infrastructure/import', formData, { timeout: 30000 })),
  infrastructureValidate: (payload) => post('/infrastructure/validate', payload),
  infrastructureCollisions: (payload) => post('/infrastructure/collisions', payload),
  infrastructureReview: (id, action) => unwrap(http.patch(`/infrastructure/${encodeURIComponent(id)}/review`, { action })),

  // 3d-identifiers — Phase 9: Proposed 3D Property Identifier
  identifierConfig: () => get('/3d-identifiers/config'),
  identifierList: (params) => get('/3d-identifiers', params),
  identifier: (id) => get(`/3d-identifiers/${encodeURIComponent(id)}`),
  identifierHierarchy: (id) => get(`/3d-identifiers/${encodeURIComponent(id)}/hierarchy`),
  identifierGeometry: (id) => get(`/3d-identifiers/${encodeURIComponent(id)}/geometry`),
  identifierVersions: (id) => get(`/3d-identifiers/${encodeURIComponent(id)}/versions`),
  identifierSearch: (q) => get('/3d-identifiers/search', { q }),
  identifierValidate: (payload) => post('/3d-identifiers/validate', payload),
  identifierCreate: (payload) => post('/3d-identifiers', payload),
  identifierAddVersion: (id, payload) => post(`/3d-identifiers/${encodeURIComponent(id)}/versions`, payload),
  identifierReviewVersion: (id, payload) => unwrap(http.patch(`/3d-identifiers/${encodeURIComponent(id)}/versions/review`, payload)),
  identifierRevalidate: (id) => post(`/3d-identifiers/${encodeURIComponent(id)}/revalidate`),
  ulpinIdentifiers: (ulpin) => get(`/ulpins/${encodeURIComponent(ulpin)}/3d-identifiers`),

  // TNGIS / Tamil Nilam — PUBLIC-source parcel geometry (no authenticated / ULPIN endpoint)
  tngisConfig: () => get('/tngis/config'),
  tngisDistricts: () => get('/tngis/districts'),
  tngisTaluks: (districtCode) => get('/tngis/taluks', { districtCode }),
  tngisVillages: (districtCode, talukCode) => get('/tngis/villages', { districtCode, talukCode }),
  tngisSurveyNumbers: (districtCode, talukCode, villageCode) => get('/tngis/survey-numbers', { districtCode, talukCode, villageCode }),
  tngisParcels: (params) => get('/tngis/parcels', params),
  tngisParcel: (id) => get(`/tngis/parcels/${encodeURIComponent(id)}`),
  tngisParcelRelations: (id) => get(`/tngis/parcels/${encodeURIComponent(id)}/relations`),
  tngisFetchParcel: (payload) => post('/tngis/parcels/fetch', payload),
  tngisValidateTopology: (id) => post(`/tngis/parcels/${encodeURIComponent(id)}/validate-topology`),

  // services / workflow
  services: (params) => get('/services', params),
  service: (id) => get(`/services/${encodeURIComponent(id)}`),
  createService: (payload) => post('/services', payload),
  advanceService: (id, payload) => post(`/services/${encodeURIComponent(id)}/advance`, payload),

  // reports / admin / system
  report: (params) => get('/reports', params),
  users: () => get('/users'),
  audit: (params) => get('/audit', params),
  systemStatus: () => get('/system/status'),
  demoCredentials: () => get('/system/demo-credentials'),
  notifications: () => get('/notifications'),
  markNotificationRead: (id) => post(`/notifications/${encodeURIComponent(id)}/read`),
  search: (q) => get('/search', { q }),
}
