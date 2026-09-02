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

const get = (url, params) => unwrap(http.get(url, { params }))
const post = (url, body) => unwrap(http.post(url, body))

export const api = {
  // auth
  login: (username, password) => post('/auth/login', { username, password }),
  register: (payload) => post('/auth/register', payload),
  me: () => get('/auth/me'),

  // land
  parcels: (params) => get('/parcels', params),
  parcel: (ulpin) => get(`/parcels/${encodeURIComponent(ulpin)}`),
  verifyParcel: (ulpin) => post(`/parcels/${encodeURIComponent(ulpin)}/verify`),
  ulpins: () => get('/ulpins'),

  // property hierarchy
  buildings: (params) => get('/buildings', params),
  building: (id) => get(`/buildings/${encodeURIComponent(id)}`),
  buildingFloors: (id) => get(`/buildings/${encodeURIComponent(id)}/floors`),
  floor: (id) => get(`/floors/${encodeURIComponent(id)}`),
  units: (params) => get('/units', params),
  unit: (propertyId) => get(`/units/${encodeURIComponent(propertyId)}`),
  verifyUnit: (propertyId) => post(`/units/${encodeURIComponent(propertyId)}/verify`),
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
  gisParcels: () => get('/gis/parcels'),
  gisBuildings: () => get('/gis/buildings'),
  gisUnits: (params) => get('/gis/units', params),
  gisCommonAreas: (params) => get('/gis/common-areas', params),
  gisLayer: (layer) => get(`/gis/layer/${layer}`),

  // dashboards
  dashboard: () => get('/dashboard/stats'),
  analytics: () => get('/analytics'),

  // disputes
  disputes: (params) => get('/disputes', params),
  dispute: (id) => get(`/disputes/${encodeURIComponent(id)}`),

  // ai
  aiStatus: () => get('/ai/status'),
  aiRun: (feature, payload) => post(`/ai/${feature}`, payload),

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
