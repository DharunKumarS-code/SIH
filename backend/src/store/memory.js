// In-memory collection store — the default persistence layer. Fully functional
// with zero external services; the same interface is implemented by the Mongo
// adapter so controllers never branch on which one is active.

import { matches } from './match.js'

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

function applySort(arr, sort) {
  if (!sort) return arr
  const entries = Object.entries(sort)
  return [...arr].sort((a, b) => {
    for (const [k, dir] of entries) {
      const av = a[k]
      const bv = b[k]
      if (av === bv) continue
      return (av > bv ? 1 : -1) * (dir < 0 ? -1 : 1)
    }
    return 0
  })
}

class MemoryCollection {
  constructor(name, docs = []) {
    this.name = name
    this.docs = docs.map(clone)
  }

  async find(filter = {}, { sort, limit, skip = 0, projection } = {}) {
    let rows = this.docs.filter((d) => matches(d, filter))
    rows = applySort(rows, sort)
    if (skip) rows = rows.slice(skip)
    if (limit != null) rows = rows.slice(0, limit)
    rows = rows.map(clone)
    if (projection) rows = rows.map((r) => project(r, projection))
    return rows
  }

  async findOne(filter = {}, opts = {}) {
    const [row] = await this.find(filter, { ...opts, limit: 1 })
    return row || null
  }

  async count(filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length
  }

  async create(doc) {
    const row = clone(doc)
    this.docs.push(row)
    return clone(row)
  }

  async insertMany(rows) {
    rows.forEach((r) => this.docs.push(clone(r)))
    return rows.length
  }

  async updateOne(filter, patch) {
    const idx = this.docs.findIndex((d) => matches(d, filter))
    if (idx === -1) return null
    this.docs[idx] = { ...this.docs[idx], ...clone(patch) }
    return clone(this.docs[idx])
  }

  async deleteOne(filter) {
    const idx = this.docs.findIndex((d) => matches(d, filter))
    if (idx === -1) return 0
    this.docs.splice(idx, 1)
    return 1
  }

  async deleteMany(filter = {}) {
    const before = this.docs.length
    this.docs = this.docs.filter((d) => !matches(d, filter))
    return before - this.docs.length
  }

  async distinct(field, filter = {}) {
    const set = new Set()
    for (const d of this.docs) if (matches(d, filter)) set.add(d[field])
    return [...set]
  }
}

function project(row, projection) {
  const keys = Object.keys(projection)
  const including = keys.some((k) => projection[k])
  const out = {}
  if (including) {
    for (const k of keys) if (projection[k]) out[k] = row[k]
    return out
  }
  Object.assign(out, row)
  for (const k of keys) if (!projection[k]) delete out[k]
  return out
}

export function createMemoryStore(seed) {
  const collections = new Map()
  for (const [name, docs] of Object.entries(seed)) {
    collections.set(name, new MemoryCollection(name, docs))
  }
  return {
    mode: 'demo',
    collection(name) {
      if (!collections.has(name)) collections.set(name, new MemoryCollection(name, []))
      return collections.get(name)
    },
    collectionNames: () => [...collections.keys()],
  }
}
