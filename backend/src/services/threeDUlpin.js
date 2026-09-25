// ---------------------------------------------------------------------------
// 3D ULPIN — a system-generated, persistent 3D property identifier that a
// Land Officer can generate for a building or unit. This is DELIBERATELY
// separate from the Phase 9 "Proposed 3D Property Identifier"
// (services/identifier3d/*, collection `proposed3DPropertyIdentifiers`,
// canonical form `3DPR:...`) — a different workflow, for a different role,
// with its own "never call this 3D ULPIN or Official ULPIN" guardrail. The
// 3D ULPIN here is NEVER an official government-issued identifier; it only
// identifies this application's own 3D property record.
//
// Format: exactly 14 uppercase alphanumeric characters (A-Z, 0-9) — the same
// shape as the real government ULPIN (see docs/13-official-ulpin-data-
// investigation.md), but this value is entirely system-generated and must
// never be presented as an officially issued ULPIN.
// ---------------------------------------------------------------------------

import { randomInt } from 'crypto'
import { db } from '../store/index.js'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const LENGTH = 14
const THREE_D_ULPIN_RE = /^[A-Z0-9]{14}$/

/** Single source of truth for the 3D ULPIN shape. */
export function isValid3DUlpin(value) {
  return typeof value === 'string' && THREE_D_ULPIN_RE.test(value)
}

function generateCandidate() {
  let out = ''
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

async function existsAnywhere(candidate) {
  const [building, unit] = await Promise.all([
    db.collection('buildings').findOne({ threeDUlpin: candidate }),
    db.collection('propertyUnits').findOne({ threeDUlpin: candidate }),
  ])
  return Boolean(building || unit)
}

/**
 * Generate a 3D ULPIN that collides with nothing already stored on a
 * building or unit. The keyspace (36^14) makes a collision astronomically
 * unlikely, but this still checks and retries rather than trusting luck —
 * server-side uniqueness, independent of which store (Mongo or in-memory
 * demo) is active.
 */
export async function generateUnique3DUlpin() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCandidate()
    // eslint-disable-next-line no-await-in-loop
    if (!(await existsAnywhere(candidate))) return candidate
  }
  throw new Error('Could not generate a unique 3D ULPIN after 10 attempts')
}
