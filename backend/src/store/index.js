// Storage facade. Boots the in-memory demo store immediately, then (optionally)
// upgrades to MongoDB if MONGODB_URI is set and reachable. Controllers only ever
// call `db.collection(name)` — they never know or care which backend is live.

import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { buildSeed, SEED_META } from '../data/seed.js'
import { createMemoryStore } from './memory.js'
import { createMongoStore } from './mongo.js'

const seed = buildSeed()

let active = createMemoryStore(seed)
let status = {
  mode: 'demo',
  mongoConfigured: Boolean(env.mongoUri),
  mongoConnected: false,
  message: env.mongoUri
    ? 'MongoDB configured — attempting connection…'
    : 'No MONGODB_URI set — running on built-in seeded demo dataset.',
  seededCollections: Object.keys(seed),
  meta: SEED_META,
}

export const db = {
  collection: (name) => active.collection(name),
  get status() {
    return status
  },
  get mode() {
    return active.mode
  },
  seed,
}

export async function connectStore() {
  if (!env.mongoUri) {
    console.log('[store] running on in-memory demo dataset (no MONGODB_URI)')
    return status
  }
  try {
    mongoose.set('strictQuery', false)
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 6000 })
    const mongoStore = createMongoStore()

    // Mirror seed into any empty collection so the demo works on a fresh cluster.
    let mirrored = 0
    if (env.seedOnBoot) {
      for (const [name, docs] of Object.entries(seed)) {
        const col = mongoStore.collection(name)
        const existing = await col.count({})
        if (existing === 0 && docs.length) {
          await col.insertMany(docs)
          mirrored += docs.length
        }
      }
    }

    active = mongoStore
    status = {
      ...status,
      mode: 'mongo',
      mongoConnected: true,
      message: `Connected to MongoDB (${mongoose.connection.host}). ${mirrored} demo documents mirrored.`,
    }
    console.log(`[store] ${status.message}`)
  } catch (err) {
    status = {
      ...status,
      mode: 'demo',
      mongoConnected: false,
      message: `MongoDB unavailable (${err.message.split('\n')[0]}) — using demo dataset.`,
    }
    console.warn(`[store] ${status.message}`)
  }
  return status
}

export async function disconnectStore() {
  if (mongoose.connection.readyState) await mongoose.disconnect()
}
