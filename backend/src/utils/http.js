export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (m, d) => new ApiError(400, m, d)
export const unauthorized = (m = 'Authentication required') => new ApiError(401, m)
export const forbidden = (m = 'You do not have permission to perform this action') => new ApiError(403, m)
export const notFoundError = (m = 'Resource not found') => new ApiError(404, m)

/** Wrap an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** Standard success envelope. */
export function ok(res, data, meta) {
  return res.json({ ok: true, data, ...(meta ? { meta } : {}) })
}

/** Standard list envelope with pagination info. */
export function list(res, items, { total, page, pageSize } = {}) {
  return res.json({
    ok: true,
    data: items,
    meta: {
      count: items.length,
      total: total ?? items.length,
      ...(page ? { page, pageSize } : {}),
    },
  })
}
