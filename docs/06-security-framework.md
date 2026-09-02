# 06 — Security Framework

| Control | Implementation |
| --- | --- |
| Authentication | JWT (`jsonwebtoken`), `Authorization: Bearer` header. Token holds `sub`, `username`, `role`, `name`; `JWT_EXPIRES_IN` default `8h`. |
| Password storage | `bcryptjs`, cost 10 (seed accounts cost 8 for fast boot). Never returned by the API. |
| Authorisation | Role + permission middleware (`requireAuth`, `requireRole`, `requirePermission`) — see `07`. |
| Input validation | Zod schemas via `middleware/validate.js` on body/params/query; 400 with flattened issues. |
| Transport / headers | `helmet` (CSP-friendly defaults), `compression`. |
| CORS | Explicit allow-list from `CORS_ORIGIN` (default `http://localhost:5173`). |
| Rate limiting | `express-rate-limit`: `/api/auth` 30 req/min, `/api` 600 req/min per IP. |
| Secrets | `.env` only, git-ignored; `.env.example` documents every key. No credentials, tokens or keys in source. |
| Audit trail | Every mutating officer action recorded (`08` / `41`). |
| Error handling | Central handler; 5xx messages are generic in production, stack only in dev. No blank screens (React error boundary + inline error states). |
| Frontend token storage | `localStorage` (`landstack.token`); cleared on logout or a real 401. |

## Not implemented (prototype scope)

Refresh tokens / rotation, MFA, account lockout, CSRF tokens (API is
bearer-only, not cookie-based), field-level encryption, secret manager
integration, WAF. These are noted for a production build.
