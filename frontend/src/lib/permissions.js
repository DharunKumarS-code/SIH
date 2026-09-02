// Client-side mirror of backend/src/config/rbac.js — used only for optimistic
// UI gating before GET /api/auth/me returns the authoritative list. The backend
// always re-checks on every request.
export const PERMISSIONS = {
  Citizen: ['parcel:search', 'parcel:view-public', 'property:view-public', 'service:create', 'service:track', 'gis:view', 'report:view-own'],
  'Land Officer': ['parcel:search', 'parcel:view', 'parcel:verify', 'ror:view', 'ror:update', 'property:view', 'property:verify', 'encumbrance:view', 'registration:view', 'dispute:view', 'service:process', 'gis:view', 'audit:view-own', 'report:view'],
  'Survey Officer': ['parcel:search', 'parcel:view', 'parcel:boundary-review', 'survey:update', 'property:view', 'gis:view', 'ai:run', 'change-detection:review', 'report:view'],
  'Planning Officer': ['parcel:search', 'parcel:view', 'building-approval:view', 'building-approval:update', 'landuse:view', 'landuse:update', 'masterplan:view', 'property:view', 'gis:view', 'report:view'],
  'Revenue Officer': ['parcel:search', 'parcel:view', 'tax:view', 'tax:update', 'property:view', 'gis:view', 'report:view'],
  Administrator: ['*'],
}

export const permissionsFor = (role) => PERMISSIONS[role] || []
