// Minimal query matcher shared by the in-memory store. Supports equality plus
// $in / $nin / $ne / $regex / $exists / $gt / $gte / $lt / $lte and top-level $or.

function matchValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof RegExp)) {
    for (const [op, val] of Object.entries(expected)) {
      switch (op) {
        case '$in':
          if (!Array.isArray(val) || !val.includes(actual)) return false
          break
        case '$nin':
          if (Array.isArray(val) && val.includes(actual)) return false
          break
        case '$ne':
          if (actual === val) return false
          break
        case '$exists':
          if (val ? actual === undefined : actual !== undefined) return false
          break
        case '$regex': {
          const re = val instanceof RegExp ? val : new RegExp(val, expected.$options || 'i')
          if (typeof actual !== 'string' || !re.test(actual)) return false
          break
        }
        case '$options':
          break
        case '$gt':
          if (!(actual > val)) return false
          break
        case '$gte':
          if (!(actual >= val)) return false
          break
        case '$lt':
          if (!(actual < val)) return false
          break
        case '$lte':
          if (!(actual <= val)) return false
          break
        default:
          return false
      }
    }
    return true
  }
  if (expected instanceof RegExp) {
    return typeof actual === 'string' && expected.test(actual)
  }
  return actual === expected
}

function get(obj, path) {
  if (path.indexOf('.') === -1) return obj?.[path]
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function matches(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$or') {
      if (!Array.isArray(expected) || !expected.some((f) => matches(doc, f))) return false
      continue
    }
    if (key === '$and') {
      if (!Array.isArray(expected) || !expected.every((f) => matches(doc, f))) return false
      continue
    }
    if (!matchValue(get(doc, key), expected)) return false
  }
  return true
}
