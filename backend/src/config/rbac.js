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
    'infrastructure:read', // Phase 8 — view-only underground infrastructure
    '3didentifier:read', // Phase 9 — view-only proposed 3D property identifier
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
    'infrastructure:read', // Phase 8 — view-only
    '3didentifier:read', // Phase 9 — view-only
    '3dulpin:create', // system-generated 3D property identifier (Land Officer only)
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
    // Phase 8 — underground 3D infrastructure mapping
    'infrastructure:read',
    'infrastructure:upload',
    'infrastructure:validate',
    'infrastructure:review',
    // Phase 9 — proposed 3D property identifier
    '3didentifier:read',
    '3didentifier:create',
    '3didentifier:validate',
    '3didentifier:review',
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
    'infrastructure:read', // Phase 8 — view-only
    '3didentifier:read', // Phase 9 — view-only
  ],
  'Revenue Officer': [
    'parcel:search',
    'parcel:view',
    'tax:view',
    'tax:update',
    'property:view',
    'gis:view',
    'report:view',
    'infrastructure:read', // Phase 8 — view-only
    '3didentifier:read', // Phase 9 — view-only
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
