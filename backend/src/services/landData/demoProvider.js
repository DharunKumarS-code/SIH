// ---------------------------------------------------------------------------
// DemoDataProvider — serves the synthetic prototype parcels.
//
// Every record it returns is tagged verificationStatus = DEMO and
// ulpinStatus = DEMO_NOT_OFFICIAL. The `provenance` block is COMPUTED here from
// the parcel's own fields + the locality registry, so no extra fields need to
// be persisted in MongoDB.
// ---------------------------------------------------------------------------

import { db } from '../../store/index.js'
import { getLocality } from '../../data/localities.js'
import { VERIFICATION_STATUS, ULPIN_STATUS } from './provenance.js'

export const name = 'DemoDataProvider'

// When this process materialised the demo dataset.
const RETRIEVED_AT = new Date().toISOString()

/** Build the provenance block for a demo parcel. */
export function demoProvenance(parcel) {
  const loc = parcel?.locality ? getLocality(parcel.locality) : null
  return {
    ulpinStatus: ULPIN_STATUS.DEMO_NOT_OFFICIAL,
    verificationStatus: VERIFICATION_STATUS.DEMO,
    isOfficialUlpin: false,
    sourceOrganization: 'LAND STACK prototype (synthetic)',
    sourceDataset: `seed:localities/${parcel?.locality || 'unknown'}`,
    sourceUrl: null,
    recordType: loc?.recordType || null, // e.g. 'TSLR' for Chennai Town Survey
    adminLevel: loc?.adminLevel || null,
    retrievedAt: RETRIEVED_AT,
    disclaimer:
      'Synthetic demo parcel using realistic Chennai coordinates. This identifier is NOT an official Government of India ULPIN.',
  }
}

/** Ensure a subdivision number exists even on older seeded docs. */
export const subdivisionOf = (parcel) =>
  parcel?.subdivisionNumber || parcel?.subDivision || (parcel?.surveyNumber ? `${parcel.surveyNumber}/1` : null)

/**
 * @returns {Promise<{status, provider, record?, provenance?}>}
 */
export async function lookup({ ulpin } = {}) {
  if (!ulpin) return { status: VERIFICATION_STATUS.UNAVAILABLE, provider: name, reason: 'No ULPIN supplied.' }
  const parcel = await db.collection('parcels').findOne({ ulpin })
  if (!parcel) return { status: VERIFICATION_STATUS.UNAVAILABLE, provider: name, reason: `No demo parcel for ${ulpin}.` }
  return {
    status: VERIFICATION_STATUS.DEMO,
    provider: name,
    record: { ...parcel, subdivisionNumber: subdivisionOf(parcel) },
    provenance: demoProvenance(parcel),
  }
}
