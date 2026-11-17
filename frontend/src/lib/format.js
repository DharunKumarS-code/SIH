export const inr = (n) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`

export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))

// Formats an ULPIN for display only: uppercase, hyphens/spaces stripped —
// e.g. the prototype's "TN-CHN-123456789" reads as "TNCHN123456789" (still
// exactly 14 characters). Purely presentational: the underlying stored
// value, composite IDs (buildingId/propertyId/...) and services/idService.js
// parsing are never touched by this. No-op on null/empty (e.g. an
// unavailable Official ULPIN stays unavailable).
export const formatUlpinDisplay = (ulpin) => (ulpin ? String(ulpin).toUpperCase().replace(/[^A-Z0-9]/g, '') : ulpin)

// 3D ULPIN — a system-generated 3D property identifier (see
// backend/src/services/threeDUlpin.js for the generator/uniqueness check).
// Never an officially issued government ULPIN.
export const isValid3DUlpin = (value) => typeof value === 'string' && /^[A-Z0-9]{14}$/.test(value)

export const dateShort = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Status -> badge style (spec section 37)
export const STATUS_STYLES = {
  Verified: 'bg-ok/10 text-ok border-ok/30',
  Registered: 'bg-ok/10 text-ok border-ok/30',
  Approved: 'bg-ok/10 text-ok border-ok/30',
  Paid: 'bg-ok/10 text-ok border-ok/30',
  Clear: 'bg-ok/10 text-ok border-ok/30',
  Completed: 'bg-ok/10 text-ok border-ok/30',
  Pending: 'bg-warn/10 text-warn border-warn/30',
  Due: 'bg-warn/10 text-warn border-warn/30',
  'Partially Paid': 'bg-warn/10 text-warn border-warn/30',
  Conditional: 'bg-warn/10 text-warn border-warn/30',
  'Under Review': 'bg-info/10 text-info border-info/30',
  'Under Construction': 'bg-info/10 text-info border-info/30',
  'Under Mediation': 'bg-info/10 text-info border-info/30',
  Submitted: 'bg-info/10 text-info border-info/30',
  Open: 'bg-danger/10 text-danger border-danger/30',
  Rejected: 'bg-danger/10 text-danger border-danger/30',
  Disputed: 'bg-danger/10 text-danger border-danger/30',
  'In Court': 'bg-danger/10 text-danger border-danger/30',
  Encumbered: 'bg-danger/10 text-danger border-danger/30',
  Active: 'bg-danger/10 text-danger border-danger/30',
}
export const statusStyle = (s) => STATUS_STYLES[s] || 'bg-slate-50 text-slate-600 border-slate-300'

export const LAND_USE_COLORS = {
  'Primary Residential': '#3f7fd6',
  'Mixed Residential': '#4fb0c9',
  Commercial: '#d99b3f',
  Institutional: '#a86fd1',
  'Open Space': '#4fbf7f',
}

// Restrained, print-friendly chart palette for a government portal.
export const CHART_COLORS = ['#144382', '#0f766e', '#b45309', '#6b21a8', '#15803d', '#b91c1c', '#64748b']
// Same hues, lightened for the dark theme (each >= 4.5:1 on the dark surface).
export const CHART_COLORS_DARK = ['#6a9ce0', '#3ebeac', '#d99142', '#b48ee0', '#4abe7a', '#e06464', '#93a1b5']
