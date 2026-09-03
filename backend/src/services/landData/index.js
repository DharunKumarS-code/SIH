// ---------------------------------------------------------------------------
// Land-data provider chain.
//
//   resolveParcel()  → tries GovernmentDataProvider (real, authoritative) first,
//                      falls back to DemoDataProvider (synthetic). The result
//                      always carries an explicit provenance block so the UI can
//                      label OFFICIAL / DEMO / UNVERIFIED / UNAVAILABLE.
//
//   listLandSources() → the register of official sources + Chennai availability.
// ---------------------------------------------------------------------------

import * as government from './governmentProvider.js'
import * as demo from './demoProvider.js'
import { VERIFICATION_STATUS } from './provenance.js'

export {
  VERIFICATION_STATUS,
  ULPIN_STATUS,
  OFFICIAL_SOURCES,
  ULPIN_SPEC,
  CHENNAI_ULPIN_AVAILABILITY,
} from './provenance.js'
export { demoProvenance, subdivisionOf } from './demoProvider.js'

const CHAIN = [government, demo]

/**
 * Resolve a parcel through the provider chain.
 * @param {{ ulpin?: string, district?, taluk?, village?, surveyNumber?, subdivision? }} query
 * @returns {Promise<{ record: object|null, provenance: object, providerChain: object[] }>}
 */
export async function resolveParcel(query = {}) {
  const providerChain = []
  let resolved = null

  for (const provider of CHAIN) {
    let outcome
    try {
      outcome = await provider.lookup(query)
    } catch (err) {
      outcome = { status: VERIFICATION_STATUS.UNAVAILABLE, provider: provider.name, reason: err.message }
    }
    providerChain.push({
      provider: outcome.provider || provider.name,
      status: outcome.status,
      reason: outcome.reason || null,
    })
    if (!resolved && outcome.record) {
      resolved = { record: outcome.record, provenance: outcome.provenance }
    }
  }

  if (resolved) return { ...resolved, providerChain }

  // Nothing matched anywhere.
  return {
    record: null,
    provenance: {
      verificationStatus: VERIFICATION_STATUS.UNAVAILABLE,
      disclaimer: 'No parcel found in any land-data provider.',
    },
    providerChain,
  }
}

/** The official-source register + overall Chennai ULPIN availability. */
export function listLandSources() {
  return government.describe()
}
