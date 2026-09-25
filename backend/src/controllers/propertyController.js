import { db } from '../store/index.js'
import { asyncHandler, ok, list, notFoundError } from '../utils/http.js'
import { parseProtoPropertyId, PROTOTYPE_ID_LABEL } from '../services/idService.js'
import { recordAudit } from '../services/auditService.js'
import { unitVolume, floorVolume, buildingVolume, validateUnitVolume } from '../services/geometry3d/index.js'
import { generateUnique3DUlpin } from '../services/threeDUlpin.js'
import { buildingHeightProvenance } from './landController.js'

/* ---------------------------------------------------------------- buildings */

export const listBuildings = asyncHandler(async (req, res) => {
  const filter = req.query.ulpin ? { ulpin: req.query.ulpin } : {}
  list(res, await db.collection('buildings').find(filter, { sort: { buildingNumber: 1 } }))
})

export const getBuilding = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building) throw notFoundError(`No building ${buildingId}`)
  const [floors, approval, commonAreas, unitCount] = await Promise.all([
    db.collection('floors').find({ buildingId }, { sort: { floorNumber: 1 } }),
    db.collection('buildingApprovals').findOne({ buildingId }),
    db.collection('commonAreas').find({ buildingId }),
    db.collection('propertyUnits').count({ buildingId }),
  ])
  const hp = buildingHeightProvenance(building)
  // Latest deterministic topology finding for this building, if any (spec §23).
  const topoResult = await db.collection('topologyValidationResults')
    .find({}, { sort: { createdAt: -1 }, limit: 1 })
    .then((rows) => rows[0])
    .catch(() => null)
  const topologyFindings = (topoResult?.findings || []).filter(
    (f) => f.entityType === 'BUILDING' && (f.entityId === buildingId || String(f.entityId || '').includes(buildingId)),
  )

  ok(res, {
    building: {
      ...building,
      volume: buildingVolume(building),
      // ---- height provenance (spec section 5) — honest, never fabricated ----
      heightSource: hp.heightSource,
      heightProvenance: hp.heightProvenance,
      heightVerification: hp.heightVerification,
      officialUlpin: building.officialUlpin || null,
    },
    approval,
    commonAreas,
    floors: floors.map((f) => ({ ...f, volume: floorVolume(f, building) })),
    unitCount,
    topology: {
      status: topologyFindings.some((f) => f.status === 'ERROR') ? 'ERROR'
        : topologyFindings.some((f) => f.status === 'WARNING') ? 'WARNING'
          : topoResult ? 'VALID' : 'NOT_RUN',
      findings: topologyFindings.slice(0, 10),
    },
  })
})

// 3D ULPIN — Land-Officer-only, idempotent. This is a system-generated
// application identifier, never an officially issued government ULPIN; it
// never touches `building.ulpin` / `building.officialUlpin`.
export const generateBuildingThreeDUlpin = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const building = await db.collection('buildings').findOne({ buildingId })
  if (!building) throw notFoundError(`No building ${buildingId}`)

  if (building.threeDUlpinStatus === 'GENERATED' && building.threeDUlpin) {
    return ok(res, { building, alreadyGenerated: true })
  }

  const threeDUlpin = await generateUnique3DUlpin()
  const patch = {
    threeDUlpin,
    threeDUlpinStatus: 'GENERATED',
    threeDUlpinGeneratedBy: req.user?.username || null,
    threeDUlpinGeneratedAt: new Date().toISOString(),
  }
  const updated = await db.collection('buildings').updateOne({ buildingId }, patch)
  await recordAudit({
    user: req.user?.username,
    action: 'THREE_D_ULPIN_GENERATED',
    entityType: 'Building',
    entityId: buildingId,
    before: { threeDUlpin: building.threeDUlpin || null },
    after: { threeDUlpin },
    ip: req.ip,
  })
  ok(res, { building: updated, alreadyGenerated: false })
})

/* ------------------------------------------------------------------- floors */

export const listFloors = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const [floors, building] = await Promise.all([
    db.collection('floors').find({ buildingId }, { sort: { floorNumber: 1 } }),
    db.collection('buildings').findOne({ buildingId }),
  ])
  if (!floors.length) throw notFoundError(`No floors for building ${buildingId}`)
  list(res, floors.map((f) => ({ ...f, volume: floorVolume(f, building) })))
})

export const getFloor = asyncHandler(async (req, res) => {
  const { floorId } = req.params
  const floor = await db.collection('floors').findOne({ floorId })
  if (!floor) throw notFoundError(`No floor ${floorId}`)
  const [units, building] = await Promise.all([
    db.collection('propertyUnits').find({ floorId }, { sort: { apartmentNumber: 1 } }),
    db.collection('buildings').findOne({ buildingId: floor.buildingId }),
  ])
  ok(res, {
    floor: { ...floor, volume: floorVolume(floor, building) },
    units: units.map((u) => ({
      propertyId: u.propertyId,
      unitId: u.unitId,
      apartmentNumber: u.apartmentNumber,
      name: u.name,
      usage: u.usage,
      bedrooms: u.bedrooms,
      status: u.status,
      gridCol: u.gridCol ?? null,
      gridRow: u.gridRow ?? null,
      carpetAreaSqft: u.carpetAreaSqft,
      volume: unitVolume(u),
      owner: u.owner?.name,
    })),
  })
})

/* -------------------------------------------------------------------- units */

export const listUnits = asyncHandler(async (req, res) => {
  const { buildingId, floorId, floorNumber, ulpin, status, usage, limit } = req.query
  const filter = {}
  if (buildingId) filter.buildingId = buildingId
  if (floorId) filter.floorId = floorId
  if (floorNumber != null) filter.floorNumber = Number(floorNumber)
  if (ulpin) filter.ulpin = ulpin
  if (status) filter.status = status
  if (usage) filter.usage = usage
  const rows = await db.collection('propertyUnits').find(filter, {
    sort: { buildingNumber: 1, floorNumber: 1, apartmentNumber: 1 },
    limit: limit ? Number(limit) : undefined,
  })
  list(res, rows, { total: await db.collection('propertyUnits').count(filter) })
})

async function assembleUnit(unit) {
  const [building, floor, registration, encumbrance, tax, documents, disputes] = await Promise.all([
    db.collection('buildings').findOne({ buildingId: unit.buildingId }),
    db.collection('floors').findOne({ floorId: unit.floorId }),
    db.collection('registrations').findOne({ propertyId: unit.propertyId }),
    db.collection('encumbrances').findOne({ propertyId: unit.propertyId }),
    db.collection('propertyTax').findOne({ propertyId: unit.propertyId }),
    db.collection('documents').find({ propertyId: unit.propertyId }),
    db.collection('disputes').find({ propertyId: unit.propertyId }),
  ])
  const volume = unitVolume(unit)
  const validation = validateUnitVolume(unit, building)
  if (volume) volume.status = validation.status
  return {
    unit: { ...unit, volume },
    volume,
    validation,
    idKind: PROTOTYPE_ID_LABEL,
    hierarchy: {
      ulpin: unit.ulpin,
      ulpinKind: 'Official parcel ULPIN (prototype)',
      building: building ? { id: building.buildingId, name: building.name, segment: building.buildingSegment } : null,
      floor: floor
        ? { id: floor.floorId, number: floor.floorNumber, label: floor.label, segment: floor.floorSegment, volume: floorVolume(floor, building) }
        : null,
      unit: { id: unit.unitId, apartmentNumber: unit.apartmentNumber, propertyId: unit.propertyId, volumeId: volume?.volumeId || null },
    },
    building: building ? { ...building, volume: buildingVolume(building) } : null,
    floor: floor ? { ...floor, volume: floorVolume(floor, building) } : null,
    governance: {
      registration: registration || null,
      encumbrance: encumbrance || null,
      propertyTax: tax || null,
    },
    documents,
    disputes,
  }
}

export const getUnit = asyncHandler(async (req, res) => {
  const { propertyId } = req.params
  const unit = await db.collection('propertyUnits').findOne({ propertyId })
  if (!unit) {
    const parsed = parseProtoPropertyId(propertyId)
    throw notFoundError(
      parsed
        ? `No unit ${propertyId} (parcel ${parsed.ulpin}, building B${String(parsed.buildingNumber).padStart(2, '0')}, floor F${String(parsed.floorNumber).padStart(2, '0')})`
        : `"${propertyId}" is not a valid Prototype 3D Property Identifier`,
    )
  }
  ok(res, await assembleUnit(unit))
})

export const verifyUnit = asyncHandler(async (req, res) => {
  const { propertyId } = req.params
  const unit = await db.collection('propertyUnits').findOne({ propertyId })
  if (!unit) throw notFoundError()
  const updated = await db.collection('propertyUnits').updateOne({ propertyId }, { status: 'Verified' })
  await recordAudit({
    user: req.user?.username,
    action: 'PROPERTY_VERIFIED',
    entityType: 'PropertyUnit',
    entityId: propertyId,
    before: { status: unit.status },
    after: { status: 'Verified' },
    ip: req.ip,
  })
  ok(res, { unit: updated })
})

// 3D ULPIN — Land-Officer-only, idempotent (see generateBuildingThreeDUlpin
// above for the shared rationale). Never touches `unit.ulpin`.
export const generateUnitThreeDUlpin = asyncHandler(async (req, res) => {
  const { propertyId } = req.params
  const unit = await db.collection('propertyUnits').findOne({ propertyId })
  if (!unit) throw notFoundError(`No unit ${propertyId}`)

  if (unit.threeDUlpinStatus === 'GENERATED' && unit.threeDUlpin) {
    return ok(res, { unit, alreadyGenerated: true })
  }

  const threeDUlpin = await generateUnique3DUlpin()
  const patch = {
    threeDUlpin,
    threeDUlpinStatus: 'GENERATED',
    threeDUlpinGeneratedBy: req.user?.username || null,
    threeDUlpinGeneratedAt: new Date().toISOString(),
  }
  const updated = await db.collection('propertyUnits').updateOne({ propertyId }, patch)
  await recordAudit({
    user: req.user?.username,
    action: 'THREE_D_ULPIN_GENERATED',
    entityType: 'PropertyUnit',
    entityId: propertyId,
    before: { threeDUlpin: unit.threeDUlpin || null },
    after: { threeDUlpin },
    ip: req.ip,
  })
  ok(res, { unit: updated, alreadyGenerated: false })
})

/* ------------------------------------------------------------ common areas */

export const listCommonAreas = asyncHandler(async (req, res) => {
  const filter = req.query.buildingId ? { buildingId: req.query.buildingId } : {}
  list(res, await db.collection('commonAreas').find(filter))
})
