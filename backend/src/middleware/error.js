import { ApiError } from '../utils/http.js'

export function notFound(req, res) {
  res.status(404).json({ ok: false, error: { message: `Route not found: ${req.method} ${req.originalUrl}` } })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err instanceof ApiError ? err.status : err.status || 500
  const payload = {
    ok: false,
    error: {
      message: status === 500 ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  }
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err)
    if (process.env.NODE_ENV !== 'production') payload.error.stack = err.stack
  }
  res.status(status).json(payload)
}
