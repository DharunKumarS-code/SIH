// Data-shaping layer for the downloadable "3D Property Certificate" (parcel /
// building / unit). Pure functions only — no fetching, no rendering. Each
// builder takes exactly the data the existing PropertySidebar cards already
// hold in memory (see components/layout/PropertySidebar.jsx) and normalises
// it into one CertificateData shape consumed by both the on-screen preview
// (components/certificate/PropertyCertificateModal.jsx) and the PDF writer
// (lib/certificatePdf.js).
//
// Hard rule throughout this file: every field falls back to "Not Available" /
// null instead of guessing. Nothing here invents an owner, a survey number, a
// registration reference or an official ULPIN — it only re-labels data the
// rest of the app already fetched and displays elsewhere in the sidebar.

import { verificationBadge, isOfficial } from './provenance.js'
import { volumeMetrics } from './volume.js'
import { formatUlpinDisplay } from './format.js'

export const NA = 'Not Available'

// The shared app-wide verification vocabulary (lib/provenance.js) uses the
// word "Demo" in its badge text and raw status codes — accurate everywhere
// else it's used, but the Smart Property Card is held to a stricter
// no-"Demo" wording rule. This maps ONLY the card's own display text; it
// never touches provenance.js or the verificationStatus value itself (still
// used for badge colour / logic), so nothing else in the app is affected.
const CARD_STATUS_WORD = {
  OFFICIAL: 'Official',
  DEMO: 'Prototype',
  UNVERIFIED: 'Unverified',
  UNAVAILABLE: 'Unavailable',
  AI_DEMO: 'AI Generated',
}

const CARD_STATUS_LABEL = {
  OFFICIAL: 'Official ULPIN — Government Source',
  DEMO: 'Prototype Identifier — Not an Official ULPIN',
  UNVERIFIED: 'Unverified — not confirmed against a government system',
  UNAVAILABLE: 'Official data unavailable via public channels',
  AI_DEMO: 'AI Generated — Not an Official ULPIN',
}

/** Display-safe verification status word (e.g. "Verification: Prototype"). */
export function cardStatusWord(status) {
  return CARD_STATUS_WORD[status] || status || NA
}

/** Display-safe verification badge sentence for the card's Verification panel. */
export function cardStatusLabel(status, fallbackLabel) {
  return CARD_STATUS_LABEL[status] || fallbackLabel || NA
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

function ringOf(geometry) {
  const ring = geometry?.coordinates?.[0]
  return Array.isArray(ring) && ring.length >= 4 ? ring : null
}

function centroidOf(centroid) {
  const c = centroid?.coordinates
  return Array.isArray(c) && c.length === 2 && finite(c[0]) && finite(c[1]) ? { lon: c[0], lat: c[1] } : null
}

/** Best available boundary/footprint geometry for the "Spatial Information"
 * map, labelled honestly by what it actually is — never presented as a
 * surveyed parcel boundary unless it genuinely is the parcel's own geometry. */
function boundaryOf({ parcelGeometry, buildingGeometry, unitGeometry }) {
  const parcelRing = ringOf(parcelGeometry)
  if (parcelRing) return { ring: parcelRing, kind: 'parcel', label: 'Parcel Boundary' }
  const buildingRing = ringOf(buildingGeometry)
  if (buildingRing) return { ring: buildingRing, kind: 'building', label: 'Building Footprint (illustrative — parcel boundary not loaded in this view)' }
  const unitRing = ringOf(unitGeometry)
  if (unitRing) return { ring: unitRing, kind: 'unit', label: 'Unit Footprint (illustrative — parcel boundary not loaded in this view)' }
  return null
}

/** Safe, in-app deep link (never an external URL) used for the QR code. */
export function certificateDeepLink({ ulpin, buildingId, propertyId }) {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
  const q = new URLSearchParams()
  if (propertyId) q.set('unit', propertyId)
  else if (buildingId) q.set('building', buildingId)
  if (ulpin) q.set('ulpin', ulpin)
  return `${origin}/map?${q.toString()}`
}

// Chennai-wide fact already established elsewhere in the app (see
// lib/provenance.js LAND_SOURCES_FALLBACK / ParcelCard): no parcel in this
// prototype has an officially verified ULPIN source, so every parcel id shown
// anywhere in the app — including on a building/unit certificate, where the
// full parcel provenance record isn't loaded — is honestly DEMO.
const CHENNAI_ULPIN_NOTE =
  'No officially and legally accessible public source verifies this ULPIN for Chennai. It is a prototype parcel identifier, not an official government ULPIN.'

function currentUserLine(generatedBy) {
  if (!generatedBy) return null
  const { name, role } = generatedBy
  return [name, role].filter(Boolean).join(' — ') || null
}

/** One stage of the ULPIN → Parcel → Building → Floor → Unit → 3D Volume
 * chain shown on the Smart Property Card. `id` is left null (rendered as
 * "Not Available") rather than guessed when a record doesn't reach that
 * stage — e.g. a parcel-level card has no Floor/Unit stage. */
function stage(key, label, id) {
  return { key, label, id: id || null }
}

function hierarchyChainFor({ ulpin, parcelId, buildingId, floorId, unitId, volumeId }) {
  return [
    stage('ulpin', 'ULPIN', ulpin),
    stage('parcel', 'Parcel', parcelId),
    stage('building', 'Building', buildingId),
    stage('floor', 'Floor', floorId),
    stage('unit', 'Unit', unitId),
    stage('volume', '3D Volume', volumeId),
  ]
}

const UDS_NOT_APPLICABLE_NOTE =
  'Undivided Share of Land (UDS) applies to an individual unit within a subdivided building, not to this record as a whole.'
const UDS_UNIT_NOTE =
  'Ownership share is a recorded attribute of this unit record. A certified Undivided Share of Land computation against surveyed parcel area is not implemented in this prototype.'

function baseEnvelope({ kind, generatedBy }) {
  return {
    kind,
    generatedAtISO: new Date().toISOString(),
    generatedByLine: currentUserLine(generatedBy),
  }
}

/* -------------------------------------------------------------------- parcel */

// `parcelData` is exactly the ParcelCard query payload: { parcel, provenance,
// providerChain, volumes, landUse, registration, encumbrance, propertyTax,
// disputes, buildings }.
export function buildParcelCertificate({ parcelData, generatedBy }) {
  const p = parcelData?.parcel
  if (!p) return null
  const prov = parcelData.provenance || {}
  const badge = verificationBadge(prov.verificationStatus)
  const official = isOfficial(prov.verificationStatus)
  const reg = parcelData.registration
  const enc = parcelData.encumbrance
  const disputes = parcelData.disputes || []
  const centroid = centroidOf(p.centroid)
  const boundary = boundaryOf({ parcelGeometry: p.geometry })

  return {
    ...baseEnvelope({ kind: 'parcel', generatedBy }),
    title: `Parcel ${p.ulpin || p.parcelId || ''}`.trim(),
    identity: {
      ulpin: p.ulpin ? formatUlpinDisplay(p.ulpin) : NA,
      ulpinKind: official ? 'Official ULPIN' : 'Prototype Parcel Identifier (Not an Official ULPIN)',
      verificationStatus: prov.verificationStatus || 'UNVERIFIED',
      verificationLabel: badge.text,
      isOfficial: official,
      dataSource: prov.sourceOrganization || 'Prototype dataset (synthetic prototype data)',
      recordId: p.parcelId || NA,
    },
    owner: {
      current: reg?.parties?.buyer ? [{ name: reg.parties.buyer, ownershipType: p.ownershipStatus || null }] : [],
      ownershipStatus: p.ownershipStatus || NA,
      previousHolders: reg?.parties?.seller ? [reg.parties.seller] : null,
      mutationDate: reg?.registeredOn || null,
      contactAvailable: false, // this API never returns owner contact details
    },
    parcel: {
      surveyNumber: p.surveyNumber || NA,
      subdivisionNumber: p.subdivisionNumber || p.subDivision || NA,
      areaSqft: finite(p.areaSqft) ? p.areaSqft : null,
      areaSqm: finite(p.areaSqm) ? p.areaSqm : null,
      landUse: p.landUse || NA,
      propertyType: p.classification || p.landUse || NA,
      district: p.district || NA,
      taluk: p.taluk || NA,
      village: p.village || p.locality || NA,
    },
    spatial: {
      centroid,
      crs: centroid ? 'EPSG:4326 (WGS 84)' : null,
      boundary,
      isDemoCoordinates: !official,
    },
    legal: {
      registrationRef: reg?.docNumber || NA,
      encumbranceStatus: enc?.status || enc?.type || NA,
      remarks: enc?.note || NA,
      litigationStatus: disputes.length
        ? `${disputes.length} recorded dispute${disputes.length > 1 ? 's' : ''} — ${disputes[0].type} (${disputes[0].status})`
        : 'None on record',
    },
    threeD: {
      buildingCount: parcelData.volumes?.buildings ?? null,
      floorCount: parcelData.volumes?.floors ?? null,
      unitCount: parcelData.volumes?.units ?? null,
      threeDUlpin: null,
      buildingId: null,
      floorId: null,
      unitId: null,
      volumeId: null,
      bounds: null,
      estVolumeM3: null,
      buildingHeightM: null,
      geometryStatus: NA,
    },
    provenance: {
      source: prov.sourceOrganization || 'Prototype dataset',
      verificationStatus: prov.verificationStatus || 'UNVERIFIED',
      recordVersion: null,
      disclaimer: prov.disclaimer || null,
    },
    hierarchyChain: hierarchyChainFor({ ulpin: p.ulpin, parcelId: p.parcelId }),
    uds: {
      available: false,
      sharePct: null,
      associatedParcel: p.ulpin ? formatUlpinDisplay(p.ulpin) : NA,
      note: UDS_NOT_APPLICABLE_NOTE,
    },
    qrUrl: certificateDeepLink({ ulpin: p.ulpin }),
  }
}

/* ------------------------------------------------------------------ building */

// `buildingData` is exactly the BuildingCard query payload: { building,
// approval, commonAreas, floors, unitCount, topology }.
export function buildBuildingCertificate({ buildingData, generatedBy }) {
  const b = buildingData?.building
  if (!b) return null
  const vm = b.volume ? volumeMetrics(b.volume) : null
  const centroid = centroidOf(b.centroid)
  const boundary = boundaryOf({ buildingGeometry: b.geometry })
  // A building normally has no official land-record fields of its own (see
  // the NA fallbacks below) — but a small number of buildings (currently
  // just the Coimbatore demonstration property, buildingId
  // 'COIMBATORE-DEMO-001') carry a real, user-supplied officialUlpin plus
  // district/taluk/village/survey/subdivision fields (see
  // backend/src/data/seed.js). When present, the certificate must present
  // the LAND identity as official even though the 3D geometry/volume below
  // stays a synthetic, unsurveyed reconstruction — the two are independent
  // provenance dimensions and must never be conflated.
  const officialLand = Boolean(b.officialUlpin)

  return {
    ...baseEnvelope({ kind: 'building', generatedBy }),
    title: `Building ${b.buildingId}`,
    identity: officialLand
      ? {
        ulpin: formatUlpinDisplay(b.officialUlpin),
        ulpinKind: 'Official ULPIN',
        verificationStatus: 'OFFICIAL',
        verificationLabel: verificationBadge('OFFICIAL').text,
        isOfficial: true,
        dataSource: 'Official government land record (user-supplied)',
        recordId: b.buildingId || NA,
      }
      : {
        ulpin: b.ulpin ? formatUlpinDisplay(b.ulpin) : NA,
        ulpinKind: 'Prototype Parcel Identifier (Not an Official ULPIN)',
        verificationStatus: 'DEMO',
        verificationLabel: verificationBadge('DEMO').text,
        isOfficial: false,
        dataSource: 'Prototype dataset (synthetic data)',
        recordId: b.buildingId || NA,
        note: CHENNAI_ULPIN_NOTE,
      },
    owner: {
      current: [],
      ownershipStatus: NA,
      previousHolders: null,
      mutationDate: null,
      contactAvailable: false,
    },
    parcel: {
      surveyNumber: b.surveyNumber || NA,
      subdivisionNumber: b.subdivisionNumber || b.subDivision || NA,
      areaSqft: null,
      areaSqm: null,
      landUse: NA,
      propertyType: b.constructionType ? `${b.constructionType} Building` : NA,
      district: b.district || NA,
      taluk: b.taluk || NA,
      village: b.village || b.locality || NA,
    },
    spatial: {
      centroid,
      crs: centroid ? 'EPSG:4326 (WGS 84)' : null,
      boundary,
      isDemoCoordinates: !officialLand,
    },
    legal: {
      registrationRef: NA,
      encumbranceStatus: NA,
      remarks: b.approvalStatus ? `Approval status: ${b.approvalStatus}` : NA,
      litigationStatus: 'None on record',
    },
    threeD: {
      buildingCount: null,
      floorCount: null,
      unitCount: null,
      threeDUlpin: b.threeDUlpin || null,
      buildingId: b.buildingId || NA,
      floorId: null,
      unitId: null,
      volumeId: b.volume?.volumeId || NA,
      bounds: b.volume || null,
      estVolumeM3: vm?.volumeM3 ?? null,
      buildingHeightM: finite(b.heightM) ? b.heightM : (vm?.heightM ?? null),
      totalFloors: b.totalFloors ?? b.floorsAboveGround ?? NA,
      totalUnits: b.unitCount ?? buildingData.unitCount ?? NA,
      geometryStatus: b.volume?.geometryStatus || NA,
      heightSource: b.heightSource || 'DEMO / PROCEDURAL',
      heightVerification: b.heightVerification || 'UNVERIFIED',
    },
    provenance: {
      source: 'Prototype dataset (synthetic building)',
      verificationStatus: 'DEMO',
      recordVersion: null,
      disclaimer: 'Synthetic prototype geometry — height and footprint are system-generated, not surveyed values.',
    },
    hierarchyChain: hierarchyChainFor({
      ulpin: officialLand ? b.officialUlpin : b.ulpin,
      parcelId: b.parcelId,
      buildingId: b.buildingId,
      volumeId: b.volume?.volumeId,
    }),
    uds: {
      available: false,
      sharePct: null,
      associatedParcel: (officialLand ? b.officialUlpin : b.ulpin) ? formatUlpinDisplay(officialLand ? b.officialUlpin : b.ulpin) : NA,
      note: UDS_NOT_APPLICABLE_NOTE,
    },
    qrUrl: certificateDeepLink({ ulpin: b.ulpin, buildingId: b.buildingId }),
  }
}

/* --------------------------------------------------------------------- unit */

// `unitData` is exactly the unit-view payload from GET /api/units/:propertyId
// (assembleUnit): { unit, volume, validation, hierarchy, building, floor,
// governance: { registration, encumbrance, propertyTax }, documents, disputes }.
export function buildUnitCertificate({ unitData, generatedBy }) {
  const u = unitData?.unit
  if (!u) return null
  const h = unitData.hierarchy || {}
  const g = unitData.governance || {}
  const vol = unitData.volume || u.volume || null
  const vm = volumeMetrics(vol)
  const disputes = unitData.disputes || []
  const centroid = centroidOf(u.centroid)
  const boundary = boundaryOf({ buildingGeometry: unitData.building?.geometry, unitGeometry: u.geometry })

  return {
    ...baseEnvelope({ kind: 'unit', generatedBy }),
    title: `Unit ${u.propertyId}`,
    identity: {
      ulpin: h.ulpin ? formatUlpinDisplay(h.ulpin) : NA,
      ulpinKind: 'Prototype Parcel Identifier (Not an Official ULPIN)',
      verificationStatus: 'DEMO',
      verificationLabel: verificationBadge('DEMO').text,
      isOfficial: false,
      dataSource: 'Prototype dataset (synthetic data)',
      recordId: u.propertyId || NA,
      note: CHENNAI_ULPIN_NOTE,
    },
    owner: {
      current: u.owner?.name ? [{ name: u.owner.name, ownershipType: u.owner.ownershipType, sharePct: u.owner.sharePct }] : [],
      ownershipStatus: u.status || NA,
      previousHolders: g.registration?.parties?.seller ? [g.registration.parties.seller] : null,
      mutationDate: g.registration?.registeredOn || null,
      contactAvailable: false, // this API never returns owner contact details
    },
    parcel: {
      surveyNumber: NA,
      subdivisionNumber: NA,
      areaSqft: finite(u.carpetAreaSqft) ? u.carpetAreaSqft : null,
      areaSqm: null,
      landUse: u.usage || NA,
      propertyType: u.propertyType || NA,
      district: NA,
      taluk: NA,
      village: unitData.building?.locality || NA,
    },
    spatial: {
      centroid,
      crs: centroid ? 'EPSG:4326 (WGS 84)' : null,
      boundary,
      isDemoCoordinates: true,
    },
    legal: {
      registrationRef: g.registration?.docNumber || NA,
      encumbranceStatus: g.encumbrance?.status || g.encumbrance?.type || NA,
      remarks: g.encumbrance?.note || NA,
      litigationStatus: disputes.length
        ? `${disputes.length} recorded dispute${disputes.length > 1 ? 's' : ''} — ${disputes[0].type} (${disputes[0].status})`
        : 'None on record',
    },
    threeD: {
      buildingCount: null,
      floorCount: null,
      unitCount: null,
      threeDUlpin: u.threeDUlpin || null,
      buildingId: h.building?.id || NA,
      totalFloors: unitData.building?.totalFloors ?? unitData.building?.floorsAboveGround ?? null,
      floorNumber: finite(h.floor?.number) ? h.floor.number : null,
      floorId: h.floor?.segment || (h.floor?.label ?? NA),
      unitId: h.unit?.id || NA,
      volumeId: vol?.volumeId || NA,
      bounds: vol || null,
      estVolumeM3: vm?.volumeM3 ?? null,
      buildingHeightM: null,
      floorLabel: u.floorLabel || h.floor?.label || NA,
      geometryStatus: unitData.validation?.status || NA,
    },
    provenance: {
      source: 'Prototype dataset (synthetic unit)',
      verificationStatus: 'DEMO',
      recordVersion: vol?.geometryVersion ?? null,
      disclaimer: 'Synthetic prototype 3D volume — not an official cadastral volume.',
    },
    hierarchyChain: hierarchyChainFor({
      ulpin: h.ulpin,
      parcelId: unitData.building?.parcelId,
      buildingId: h.building?.id,
      floorId: h.floor?.segment || h.floor?.label,
      unitId: h.unit?.id,
      volumeId: vol?.volumeId,
    }),
    uds: {
      available: finite(u.owner?.sharePct),
      sharePct: finite(u.owner?.sharePct) ? u.owner.sharePct : null,
      associatedParcel: h.ulpin ? formatUlpinDisplay(h.ulpin) : NA,
      note: UDS_UNIT_NOTE,
    },
    qrUrl: certificateDeepLink({ ulpin: h.ulpin, buildingId: h.building?.id, propertyId: u.propertyId }),
  }
}
