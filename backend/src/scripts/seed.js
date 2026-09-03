// Explicit seeding utility.
//
//   node src/scripts/seed.js            report the current dataset size
//   node src/scripts/seed.js --fresh    wipe every seeded collection and
//                                       re-insert the demo dataset (needed
//                                       after the seed shape changes, e.g. the
//                                       multi-locality `locality` field)
//
// `connectStore()` still mirrors the demo dataset into an EMPTY MongoDB on
// boot, but it never overwrites collections that already hold documents — so a
// changed seed shape requires `--fresh`. With no MONGODB_URI this just reports
// the in-memory dataset size.

import { connectStore, disconnectStore, db } from '../store/index.js'

const fresh = process.argv.includes('--fresh') || process.argv.includes('--force')

const run = async () => {
  const status = await connectStore()
  console.log(`\n[seed] store mode: ${status.mode}`)
  console.log(`[seed] ${status.message}\n`)

  if (fresh && status.mode === 'mongo') {
    console.log('[seed] --fresh: wiping and re-inserting every seeded collection\n')
    for (const [name, docs] of Object.entries(db.seed)) {
      const removed = await db.collection(name).deleteMany({})
      const inserted = docs.length ? await db.collection(name).insertMany(docs) : 0
      console.log(`  ${name.padEnd(20)} -${String(removed).padEnd(6)} +${inserted}`)
    }
    console.log('')
  } else if (fresh) {
    console.log('[seed] --fresh ignored: no MONGODB_URI, in-memory store is always fresh\n')
  }

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
