// Mongo-backed collection store. Same interface as the in-memory store so the
// rest of the app is storage-agnostic. Schemas are intentionally permissive
// (strict: false) — this is a prototype whose canonical shape lives in
// data/seed.js and docs/03-data-schema.md — but each collection keeps a real
// index on its natural key(s) for realistic query performance.

import mongoose from 'mongoose'

const { Schema } = mongoose

const KEYS = {
  users: ['username'],
  owners: ['id'],
  ulpins: ['ulpin'],
  parcels: ['ulpin', 'parcelId'],
  buildings: ['buildingId', 'ulpin'],
  floors: ['floorId', 'buildingId'],
  propertyUnits: ['propertyId', 'buildingId', 'floorId', 'ulpin'],
  commonAreas: ['commonAreaId', 'buildingId'],
  registrations: ['registrationId', 'ulpin', 'propertyId'],
  encumbrances: ['encumbranceId', 'ulpin', 'propertyId'],
  buildingApprovals: ['approvalId', 'buildingId'],
  propertyTax: ['taxId', 'ulpin', 'propertyId'],
  landUse: ['ulpin'],
  masterPlans: ['planId'],
  utilities: ['utilityId', 'type'],
  environment: ['id', 'kind'],
  boundaries: ['id', 'level'],
  roads: ['id'],
  disputes: ['disputeId', 'ulpin', 'propertyId'],
  documents: ['docId', 'ulpin', 'propertyId', 'buildingId'],
  serviceRequests: ['requestId', 'raisedBy'],
  notifications: ['notificationId', 'forRole'],
  auditLogs: ['logId', 'entityId'],
  // Phase 3 — AI building-footprint extraction (additive; separate from `buildings`).
  aiBuildings: ['aiBuildingId', 'jobId', 'parentParcelId', 'locality'],
  aiJobs: ['jobId'],
}

function modelFor(name) {
  if (mongoose.models[name]) return mongoose.models[name]
  const schema = new Schema({}, { strict: false, collection: name, timestamps: true })
  for (const k of KEYS[name] || []) schema.index({ [k]: 1 })
  return mongoose.model(name, schema)
}

class MongoCollection {
  constructor(name) {
    this.name = name
    this.model = modelFor(name)
  }

  async find(filter = {}, { sort, limit, skip = 0, projection } = {}) {
    let q = this.model.find(filter, projection).lean()
    if (sort) q = q.sort(sort)
    if (skip) q = q.skip(skip)
    if (limit != null) q = q.limit(limit)
    const rows = await q.exec()
    return rows.map(strip)
  }

  async findOne(filter = {}, { projection } = {}) {
    const row = await this.model.findOne(filter, projection).lean().exec()
    return row ? strip(row) : null
  }

  async count(filter = {}) {
    return this.model.countDocuments(filter).exec()
  }

  async create(doc) {
    const row = await this.model.create(doc)
    return strip(row.toObject())
  }

  async insertMany(rows) {
    if (!rows.length) return 0
    await this.model.insertMany(rows, { ordered: false })
    return rows.length
  }

  async updateOne(filter, patch) {
    await this.model.updateOne(filter, { $set: patch }).exec()
    return this.findOne(filter)
  }

  async deleteOne(filter) {
    const res = await this.model.deleteOne(filter).exec()
    return res.deletedCount || 0
  }

  async deleteMany(filter = {}) {
    const res = await this.model.deleteMany(filter).exec()
    return res.deletedCount || 0
  }

  async distinct(field, filter = {}) {
    return this.model.distinct(field, filter).exec()
  }
}

function strip(row) {
  if (!row) return row
  delete row._id
  delete row.__v
  delete row.createdAt
  delete row.updatedAt
  return row
}

export function createMongoStore() {
  const cache = new Map()
  return {
    mode: 'mongo',
    collection(name) {
      if (!cache.has(name)) cache.set(name, new MongoCollection(name))
      return cache.get(name)
    },
    collectionNames: () => Object.keys(KEYS),
  }
}
