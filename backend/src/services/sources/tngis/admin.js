// ---------------------------------------------------------------------------
// TNGIS public administrative hierarchy (District -> Taluk -> Village -> Survey).
// Every entry carries the government LGD code. Read-only, lazy — a caller asks
// for one level at a time; nothing is bulk-fetched.
// ---------------------------------------------------------------------------

import { adminMaster } from './client.js'

const str = (v) => (v == null ? null : String(v))
const rows = (r) => (Array.isArray(r?.data) ? r.data : [])

export async function listDistricts() {
  const r = await adminMaster('district', { request_type: 'district' }, 'admin:district')
  return rows(r)
    .map((d) => ({
      districtCode: str(d.district_code),
      lgdDistrictCode: str(d.district_lgd_code),
      name: d.district_english_name || null,
      tamilName: d.district_tamil_name || null,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

export async function listTaluks(districtCode) {
  const dc = String(districtCode)
  const r = await adminMaster(
    'taluk',
    { district_code: dc, request_type: 'taluk' },
    `admin:taluk:${dc}`,
  )
  return rows(r)
    .map((t) => ({
      districtCode: dc,
      talukCode: str(t.taluk_code),
      lgdTalukCode: str(t.taluk_lgd_code),
      name: t.taluk_english_name || null,
      tamilName: t.taluk_tamil_name || null,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

export async function listVillages(districtCode, talukCode) {
  const dc = String(districtCode)
  const tc = String(talukCode)
  const r = await adminMaster(
    'village',
    { district_code: dc, taluk_code: tc, request_type: 'revenue_village' },
    `admin:village:${dc}:${tc}`,
  )
  return rows(r)
    .map((v) => ({
      districtCode: dc,
      talukCode: tc,
      villageCode: str(v.village_code),
      lgdVillageCode: str(v.village_lgd_code),
      name: v.village_english_name || null,
      tamilName: v.village_tamil_name || null,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

export async function listSurveyNumbers(districtCode, talukCode, villageCode, { areaType = 'rural' } = {}) {
  const dc = String(districtCode)
  const tc = String(talukCode)
  const vc = String(villageCode)
  const r = await adminMaster(
    'survey_number',
    {
      district_code: dc,
      taluk_code: tc,
      revenue_village_code: vc,
      area_type: areaType,
      data_type: 'cadastral',
      request_type: 'survey_number',
    },
    `admin:survey:${dc}:${tc}:${vc}`,
  )
  return rows(r)
    .map((s) => str(s.survey_number ?? s))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
