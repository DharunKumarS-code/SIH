// ---------------------------------------------------------------------------
// GovernmentDataProvider — the plug-in point for REAL Government of India /
// Tamil Nadu ULPIN parcel data.
//
// As of Phase 1 no such source is officially and legally accessible to this
// application (see provenance.js / docs/13). Until `GOV_LAND_API_URL` is set to
// an officially sanctioned endpoint, every lookup returns UNAVAILABLE.
//
// This provider MUST NEVER fabricate a ULPIN or return geometry it did not
// receive from a real authoritative source.
// ---------------------------------------------------------------------------

import { env } from '../../config/env.js'
import {
  OFFICIAL_SOURCES,
  CHENNAI_ULPIN_AVAILABILITY,
  VERIFICATION_STATUS,
  ULPIN_STATUS,
  ULPIN_SPEC,
} from './provenance.js'

export const name = 'GovernmentDataProvider'

/** Static description of what official sources exist and their availability. */
export function describe() {
  return {
    provider: name,
    configured: Boolean(env.govLandApiUrl),
    ulpinSpec: ULPIN_SPEC,
    chennai: CHENNAI_ULPIN_AVAILABILITY,
    sources: OFFICIAL_SOURCES,
  }
}

/**
 * Look up a parcel from an authoritative government source.
 * @returns {Promise<{status, provider, reason?, record?, provenance?, sources}>}
 */
export async function lookup(_query) {
  if (!env.govLandApiUrl) {
    return {
      status: VERIFICATION_STATUS.UNAVAILABLE,
      provider: name,
      reason:
        'No officially accessible public ULPIN parcel service is configured. ' +
        'Every official channel (DoLR ULPIN portal, Tamil Nilam GI Viewer, TNGIS GeoServer, ' +
        'TNGLMS, eServices Patta/FMB/TSLR) requires an Aadhaar OTP, a CAPTCHA, or a registered login, ' +
        'which this application does not bypass.',
      ulpinStatus: ULPIN_STATUS.UNAVAILABLE,
      sources: OFFICIAL_SOURCES,
    }
  }
  // Future: an officially sanctioned endpoint has been configured.
  return fetchFromSource(_query)
}

/**
 * Reserved for a real integration once an official endpoint is sanctioned and
 * `GOV_LAND_API_URL` is set. Intentionally not implemented — returning
 * UNAVAILABLE is correct until a real contract exists. Never returns synthetic
 * data.
 */
async function fetchFromSource(_query) {
  return {
    status: VERIFICATION_STATUS.UNAVAILABLE,
    provider: name,
    reason:
      'GOV_LAND_API_URL is set but no official integration is implemented yet. ' +
      'Implement fetchFromSource() against the sanctioned endpoint before relying on this path.',
    ulpinStatus: ULPIN_STATUS.UNAVAILABLE,
    sources: OFFICIAL_SOURCES,
  }
}
