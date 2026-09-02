// Explicit seeding utility. `connectStore()` already mirrors the demo dataset
// into an empty MongoDB on boot; run this to (re)seed on demand and print a
// summary. With no MONGODB_URI it just reports the in-memory dataset size.

import { connectStore, disconnectStore, db } from '../store/index.js'

const run = async () => {
  const status = await connectStore()
  console.log(`\n[seed] store mode: ${status.mode}`)
  console.log(`[seed] ${status.message}\n`)
  for (const name of Object.keys(db.seed)) {
    const n = await db.collection(name).count({})
    console.log(`  ${name.padEnd(20)} ${n}`)
  }
  console.log('\n[seed] done.')
  await disconnectStore()
  process.exit(0)
}

run().catch((e) => {
  console.error('[seed] failed:', e)
  process.exit(1)
})
