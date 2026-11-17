import { MulterError } from 'multer'
import { ApiError } from '../utils/http.js'

export function notFound(req, res) {
  res.status(404).json({ ok: false, error: { message: `Route not found: ${req.method} ${req.originalUrl}` } })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Multer upload errors (oversized file, unexpected field, too many files)
  // are client errors — surface them as 413/400 with multer's own message
  // instead of a generic 500.
  if (err instanceof MulterError) {
    err.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    err.details = { code: err.code, ...(err.field ? { field: err.field } : {}) }
  }
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
