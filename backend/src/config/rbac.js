// Role -> permission matrix. Permissions are coarse-grained verbs the API
// checks with requirePermission(); the frontend uses the same list (served at
// GET /api/auth/me) to show/hide nav and actions.

export const ROLES = [
  'Citizen',
  'Land Officer',
  'Survey Officer',
  'Planning Officer',
  'Revenue Officer',
  'Administrator',
]

export const PERMISSIONS = {
  Citizen: [
    'parcel:search',
    'parcel:view-public',
    'property:view-public',
    'service:create',
    'service:track',
    'gis:view',
    'report:view-own',
  ],
  'Land Officer': [
    'parcel:search',
    'parcel:view',
    'parcel:verify',
    'ror:view',
    'ror:update',
    'property:view',
    'property:verify',
    'encumbrance:view',
    'registration:view',
    'dispute:view',
    'service:process',
    'gis:view',
    'audit:view-own',
    'report:view',
    'topology:read', // Phase 7 — view-only
  ],
  'Survey Officer': [
    'parcel:search',
    'parcel:view',
    'parcel:boundary-review',
    'survey:update',
    'property:view',
    'gis:view',
    'ai:run',
    'change-detection:review',
    'report:view',
    // Phase 7 — topology validation engine
    'topology:read',
    'topology:validate',
    'topology:review',
  ],
  'Planning Officer': [
    'parcel:search',
    'parcel:view',
    'building-approval:view',
    'building-approval:update',
    'landuse:view',
    'landuse:update',
    'masterplan:view',
    'property:view',
    'gis:view',
    'report:view',
    'topology:read', // Phase 7 — view-only
  ],
  'Revenue Officer': [
    'parcel:search',
    'parcel:view',
    'tax:view',
    'tax:update',
    'property:view',
    'gis:view',
    'report:view',
  ],
  Administrator: ['*'],
}

export function permissionsFor(role) {
  return PERMISSIONS[role] || []
}

export function can(role, permission) {
  const p = permissionsFor(role)
  return p.includes('*') || p.includes(permission)
}
