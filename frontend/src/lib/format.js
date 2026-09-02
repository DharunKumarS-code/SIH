export const inr = (n) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`

export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))

export const dateShort = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Status -> badge style (spec section 37)
export const STATUS_STYLES = {
  Verified: 'bg-ok/15 text-ok border-ok/30',
  Registered: 'bg-ok/15 text-ok border-ok/30',
  Approved: 'bg-ok/15 text-ok border-ok/30',
  Paid: 'bg-ok/15 text-ok border-ok/30',
  Clear: 'bg-ok/15 text-ok border-ok/30',
  Completed: 'bg-ok/15 text-ok border-ok/30',
  Pending: 'bg-warn/15 text-warn border-warn/30',
  Due: 'bg-warn/15 text-warn border-warn/30',
  'Partially Paid': 'bg-warn/15 text-warn border-warn/30',
  Conditional: 'bg-warn/15 text-warn border-warn/30',
  'Under Review': 'bg-info/15 text-info border-info/30',
  'Under Construction': 'bg-info/15 text-info border-info/30',
  'Under Mediation': 'bg-info/15 text-info border-info/30',
  Submitted: 'bg-info/15 text-info border-info/30',
  Open: 'bg-danger/15 text-danger border-danger/30',
  Rejected: 'bg-danger/15 text-danger border-danger/30',
  Disputed: 'bg-danger/15 text-danger border-danger/30',
  'In Court': 'bg-danger/15 text-danger border-danger/30',
  Encumbered: 'bg-danger/15 text-danger border-danger/30',
  Active: 'bg-danger/15 text-danger border-danger/30',
}
export const statusStyle = (s) => STATUS_STYLES[s] || 'bg-white/5 text-slate-300 border-white/15'

export const LAND_USE_COLORS = {
  'Primary Residential': '#3f7fd6',
  'Mixed Residential': '#4fb0c9',
  Commercial: '#d99b3f',
  Institutional: '#a86fd1',
  'Open Space': '#4fbf7f',
}

export const CHART_COLORS = ['#3f7fd6', '#38c9d6', '#f2b807', '#a86fd1', '#4fbf7f', '#e4566e', '#8a97ad']
