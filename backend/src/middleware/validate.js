import { badRequest } from '../utils/http.js'

/**
 * validate({ body, params, query }) — each value is a Zod schema. On failure
 * responds 400 with the flattened issues. Parsed/coerced values replace the
 * originals so downstream handlers get clean input.
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const key of ['body', 'params', 'query']) {
      if (schemas[key]) {
        const result = schemas[key].safeParse(req[key])
        if (!result.success) {
          return next(
            badRequest('Validation failed', result.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            }))),
          )
        }
        req[key] = result.data
      }
    }
    next()
  } catch (err) {
    next(err)
  }
}
