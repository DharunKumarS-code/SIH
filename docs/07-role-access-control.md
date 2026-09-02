# 07 — Role-Based Access Control

Source of truth: `backend/src/config/rbac.js`. The frontend receives the current
user's permission list from `GET /api/auth/me` and uses it to show/hide
navigation and actions; the backend enforces it on every route.

## Roles & demo accounts

| Role | Demo login | Password |
| --- | --- | --- |
| Citizen | `citizen01` | `Citizen@123` |
| Land Officer | `land01` | `Officer@123` |
| Survey Officer | `survey01` | `Officer@123` |
| Planning Officer | `planning01` | `Officer@123` |
| Revenue Officer | `revenue01` | `Officer@123` |
| Administrator | `admin01` | `Admin@123` |

(Also served at `GET /api/system/demo-credentials` and shown on the login page.)

## Permission matrix (abridged)

| Permission | Citizen | Land | Survey | Planning | Revenue | Admin |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `parcel:search` / `gis:view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `parcel:view` (full) | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `parcel:verify` | | ✓ | | | | ✓ |
| `parcel:boundary-review` / `survey:update` | | | ✓ | | | ✓ |
| `ror:view` / `ror:update` | | ✓ | | | | ✓ |
| `property:verify` | | ✓ | | | | ✓ |
| `building-approval:view` / `:update` | | | | ✓ | | ✓ |
| `landuse:update` / `masterplan:view` | | | | ✓ | | ✓ |
| `tax:view` / `tax:update` | | | | | ✓ | ✓ |
| `ai:run` / `change-detection:review` | | | ✓ | | | ✓ |
| `service:create` / `service:track` | ✓ | | | | | ✓ |
| `service:process` | | ✓ | | | | ✓ |
| `audit:view-own` | | ✓ | | | | ✓ |
| Users & system config | | | | | | ✓ |

`Administrator` holds `*` (all permissions). `audit:view-own` returns only the
caller's own entries unless the caller is `Administrator`.

## Enforcement points

- `requireAuth` — valid token, loads `req.user`.
- `requireRole(...roles)` — coarse gate (e.g. `/api/users` → `Administrator`).
- `requirePermission(perm)` — fine gate (e.g. `/api/units/:id/verify` →
  `property:verify`).
- Frontend `useAuth().can(perm)` + `NAV` metadata (`perm` / `role`) hide
  disallowed navigation and buttons.

Verified by e2e: a Citizen sees only Dashboard / Land Parcels / ULPIN Search /
3D Map / Buildings / Explorer / Analytics / Services / Settings; a Land Officer
additionally sees Land Records, etc.
