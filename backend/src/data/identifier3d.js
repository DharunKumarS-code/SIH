// ---------------------------------------------------------------------------
// Phase 9 — deterministic DEMO fixtures for the Proposed 3D Property Identifier.
//
// EVERYTHING here is synthetic DEMO / RESEARCH data:
//   status = PROPOSED   ·   source = DEMO   ·   isOfficial = false
//   legalStatus = NOT_ESTABLISHED   ·   ownershipStatus = NOT_PROVIDED
//
// The Official ULPIN carried in each record is the parcel's own prototype
// identifier (ulpinStatus DEMO_NOT_OFFICIAL) — a real government ULPIN is
// NEVER fabricated. One record per locality deliberately sets officialULPIN
// = null to exercise the "Official ULPIN: NOT AVAILABLE" path.
//
// Geometry versions are REFERENCE records (no geometry is copied). For the
// B01 / F02 unit in each locality a v1 -> v2 supersession chain is seeded so
// the history / immutability UI has something real to show.
// ---------------------------------------------------------------------------

import { deriveVolumeId } from '../services/geometry3d/volume.js'
import { formatCanonical, IDENTIFIER_LABEL } from '../services/identifier3d/format.js'
import { IDENTIFIER_DISCLAIMER, conceptualVolumetricRights } from '../services/identifier3d/constants.js'

// Every seeded parcel is DEMO in this prototype (see landData/provenance.js and
// docs/13). The seed hardcodes that rather than importing the landData chain,
// which would create a store <-> seed circular import. The LIVE resolver
// (resolve.js) still computes the parcel's real provenance on every read.
const SEED_ULPIN_STATUS = 'DEMO_NOT_OFFICIAL'

const NOW = '2026-01-01T00:00:00.000Z'
let idSeq = 0
let verSeq = 0
const nextIdentifierId = () => `P3DI-DEMO-${String(++idSeq).padStart(5, '0')}`
const nextVersionId = () => `GVER-DEMO-${String(++verSeq).padStart(5, '0')}`

function geometryVersionDoc({ volumeId, geometryVersion, previousVersion, status, source, reason, unit, building }) {
  const isOfficial = source === 'AUTHORIZED' || source === 'OFFICIAL'
  return {
    geometryVersionId: nextVersionId(),
    entityType: 'VOLUME',
    // Keyed to the globally-unique unit propertyId — the Phase-2 volumeId is
    // only unique within a building. `geometryRef` keeps the volumeId.
    entityId: unit.propertyId,
    geometryVersion,
    previousVersion: previousVersion || null,
    status,
    source,
    reason: reason || null,
    provenance: 'Application-generated geometry version reference (DEMO).',
    verificationStatus: isOfficial ? source : 'DEMO',
    isOfficial,
    geometryRef: { kind: 'VOLUME', id: volumeId, unitPropertyId: unit.propertyId, buildingId: building.buildingId },
    supersededBy: status === 'SUPERSEDED' ? 'v2' : undefined,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function identifierDoc({ loc, parcel, building, floor, unit, volumeId, geometryVersion, withUlpin }) {
  const officialULPIN = withUlpin ? parcel.ulpin.toUpperCase() : null
  // When there is no Official ULPIN, the canonical's parcel-key is the parcel's
  // internal prototype reference (spec section 6) so the identifier stays
  // globally unique — NOT the NA sentinel (which would collide across localities).
  const parcelKey = officialULPIN || parcel.parcelId.toUpperCase()
  const canonical = formatCanonical({
    officialULPIN: parcelKey,
    buildingSegment: building.buildingSegment,
    floorSegment: floor.floorSegment,
    unitSegment: `U${String(unit.apartmentNumber).toUpperCase()}`,
    volumeId,
    geometryVersion,
  })
  return {
    identifierId: nextIdentifierId(),
    canonicalIdentifier: canonical,
    label: IDENTIFIER_LABEL,
    officialULPIN,
    officialULPINStatus: withUlpin ? SEED_ULPIN_STATUS : 'NOT_AVAILABLE',
    officialULPINVerified: false, // no seeded parcel has a government-verified ULPIN
    internalParcelRef: withUlpin ? null : parcel.parcelId,
    parcelId: parcel.parcelId,
    buildingId: building.buildingId,
    buildingSegment: building.buildingSegment,
    floorId: floor.floorId,
    floorSegment: floor.floorSegment,
    unitId: unit.unitId,
    propertyId: unit.propertyId,
    unitSegment: `U${String(unit.apartmentNumber).toUpperCase()}`,
    volumeId,
    geometryVersion,
    status: 'PROPOSED',
    source: 'DEMO',
    verificationStatus: 'DEMO',
    isOfficial: false,
    provenance: 'Deterministic DEMO research / prototype cross-hierarchy reference — not a government identifier.',
    legalStatus: 'NOT_ESTABLISHED',
    ownershipStatus: 'NOT_PROVIDED',
    rightsStatus: 'NOT_ESTABLISHED',
    encumbranceStatus: 'NOT_PROVIDED',
    conceptualVolumetricRights: conceptualVolumetricRights(volumeId),
    geometryStatus: 'VALID', // recomputed live on read; VALID for the clean demo hierarchy
    locality: loc.id,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    disclaimer: IDENTIFIER_DISCLAIMER,
  }
}

/**
 * @param {object} loc        locality registry entry
 * @param {object[]} parcels  the locality's parcels (index 0 = primary)
 * @param {object[]} buildings, floors, units  the locality's built docs
 * @returns {{ proposed3DPropertyIdentifiers: object[], geometryVersions: object[] }}
 */
export function buildLocalityIdentifiers(loc, parcels, buildings, floors, units) {
  const identifiers = []
  const versions = []
  const parcel = parcels[0]
  const byNum = [...buildings].sort((a, b) => a.buildingNumber - b.buildingNumber)
  const b1 = byNum[0]
  const b2 = byNum[1] || byNum[0]
  const floorsOf = (b, n) => floors.find((f) => f.buildingId === b.buildingId && f.floorNumber === n)
  const unitOn = (b, floorNumber, offset = 0) => units
    .filter((u) => u.buildingId === b.buildingId && u.floorNumber === floorNumber)
    .sort((a, c) => String(a.apartmentNumber).localeCompare(String(c.apartmentNumber)))[offset]

  // ---- A: B01 / F02 / first unit — v1 -> v2 supersession chain ----
  const fA = floorsOf(b1, 2)
  const uA = unitOn(b1, 2, 0)
  if (fA && uA) {
    const volA = deriveVolumeId('unit', uA)
    versions.push(geometryVersionDoc({ volumeId: volA, geometryVersion: 'v1', previousVersion: null, status: 'SUPERSEDED', source: 'DEMO', reason: 'Initial demo geometry.', unit: uA, building: b1 }))
    versions.push(geometryVersionDoc({ volumeId: volA, geometryVersion: 'v2', previousVersion: 'v1', status: 'ACTIVE', source: 'UPLOADED_SURVEY', reason: 'Unit geometry refined from an uploaded survey (demo).', unit: uA, building: b1 }))
    identifiers.push(identifierDoc({ loc, parcel, building: b1, floor: fA, unit: uA, volumeId: volA, geometryVersion: 'v2', withUlpin: true }))
  }

  // ---- B: B01 / F01 / first unit — v1 ACTIVE ----
  const fB = floorsOf(b1, 1)
  const uB = unitOn(b1, 1, 0)
  if (fB && uB) {
    const volB = deriveVolumeId('unit', uB)
    versions.push(geometryVersionDoc({ volumeId: volB, geometryVersion: 'v1', previousVersion: null, status: 'ACTIVE', source: 'DEMO', reason: 'Initial demo geometry.', unit: uB, building: b1 }))
    identifiers.push(identifierDoc({ loc, parcel, building: b1, floor: fB, unit: uB, volumeId: volB, geometryVersion: 'v1', withUlpin: true }))
  }

  // ---- C: B02 / F01 / first unit — v1 ACTIVE ----
  const fC = floorsOf(b2, 1)
  const uC = unitOn(b2, 1, 0)
  if (fC && uC && b2.buildingId !== b1.buildingId) {
    const volC = deriveVolumeId('unit', uC)
    versions.push(geometryVersionDoc({ volumeId: volC, geometryVersion: 'v1', previousVersion: null, status: 'ACTIVE', source: 'DEMO', reason: 'Initial demo geometry.', unit: uC, building: b2 }))
    identifiers.push(identifierDoc({ loc, parcel, building: b2, floor: fC, unit: uC, volumeId: volC, geometryVersion: 'v1', withUlpin: true }))
  }

  // ---- D: B01 / F03 / first unit — officialULPIN = null (NOT AVAILABLE) ----
  const fD = floorsOf(b1, 3)
  const uD = unitOn(b1, 3, 0)
  if (fD && uD) {
    const volD = deriveVolumeId('unit', uD)
    versions.push(geometryVersionDoc({ volumeId: volD, geometryVersion: 'v1', previousVersion: null, status: 'ACTIVE', source: 'DEMO', reason: 'Initial demo geometry.', unit: uD, building: b1 }))
    identifiers.push(identifierDoc({ loc, parcel, building: b1, floor: fD, unit: uD, volumeId: volD, geometryVersion: 'v1', withUlpin: false }))
  }

  return { proposed3DPropertyIdentifiers: identifiers, geometryVersions: versions }
}
