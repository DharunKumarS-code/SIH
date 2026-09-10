// ---------------------------------------------------------------------------
// TNGIS parcel orchestrator — resolve ONE parcel from the public source.
//
// Lazy and single-parcel by construction (spec sections 3, 10, 15, 16): the
// caller supplies exact district/taluk/village/survey codes; this fetches only
// that parcel's admin context + geometry + WFS attributes. There is no
// "fetch an area" or "fetch a district" path.
// ---------------------------------------------------------------------------

import { listTaluks, listVillages } from './admin.js'
import { listDistricts } from './admin.js'
import { getSurveyGeometry, getCadastralWfsFeature } from './geometry.js'
import { normalizeParcel } from './normalize.js'
import { TngisSourceUnavailable } from './client.js'

/** Look up the human names + LGD codes for a (district, taluk, village) triple. */
async function adminContext({ districtCode, talukCode, villageCode }) {
  const dc = String(districtCode)
  const tc = String(talukCode)
  const vc = String(villageCode)
  const [districts, taluks, villages] = await Promise.all([
    listDistricts().catch(() => []),
    listTaluks(dc).catch(() => []),
    listVillages(dc, tc).catch(() => []),
  ])
  const d = districts.find((x) => x.districtCode === dc) || {}
  const t = taluks.find((x) => x.talukCode === tc) || {}
  const v = villages.find((x) => x.villageCode === vc) || {}
  return {
    districtCode: dc,
    lgdDistrictCode: d.lgdDistrictCode || null,
    districtName: d.name || null,
    talukCode: tc,
    lgdTalukCode: t.lgdTalukCode || null,
    talukName: t.name || null,
    villageCode: vc,
    lgdVillageCode: v.lgdVillageCode || null,
    villageName: v.name || null,
  }
}

/**
 * Fetch + normalize one TNGIS parcel.
 * @param {object} q  { districtCode, talukCode, villageCode, surveyNumber, subDivision? }
 * @returns {Promise<object>} normalized record (spec section 18)
 * @throws {TngisSourceUnavailable} if the public source cannot be reached
 */
export async function fetchParcel(q) {
  const { districtCode, talukCode, villageCode, surveyNumber, subDivision = null } = q || {}
  if (!districtCode || !talukCode || !villageCode || !surveyNumber) {
    const err = new Error('districtCode, talukCode, villageCode and surveyNumber are required')
    err.code = 'TNGIS_BAD_QUERY'
    throw err
  }

  const retrievedAt = new Date().toISOString()
  const [admin, geom, wfs] = await Promise.all([
    adminContext({ districtCode, talukCode, villageCode }),
    getSurveyGeometry({ districtCode, talukCode, villageCode, surveyNumber }),
    getCadastralWfsFeature({ talukCode, villageCode, surveyNumber, subDivision }).catch(() => null),
  ])
  admin.surveyNumber = String(surveyNumber)
  admin.subDivision = subDivision

  if ((!geom || !geom.features?.length) && !wfs) {
    throw new TngisSourceUnavailable(
      `No public TNGIS geometry for district ${districtCode} / taluk ${talukCode} / village ${villageCode} / survey ${surveyNumber}.`,
    )
  }

  return normalizeParcel({ admin, geom, wfs, retrievedAt })
}
