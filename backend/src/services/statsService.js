import { db } from '../store/index.js'

const tally = (rows, key) => {
  const out = {}
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key]
    out[k] = (out[k] || 0) + 1
  }
  return out
}
const toSeries = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value }))

export async function dashboardStats() {
  const [parcels, buildings, floors, units, registrations, approvals, disputes, tax, ulpins] = await Promise.all([
    db.collection('parcels').find({}),
    db.collection('buildings').find({}),
    db.collection('floors').find({}),
    db.collection('propertyUnits').find({}),
    db.collection('registrations').find({}),
    db.collection('buildingApprovals').find({}),
    db.collection('disputes').find({}),
    db.collection('propertyTax').find({}),
    db.collection('ulpins').find({}),
  ])

  const verifiedUnits = units.filter((u) => u.status === 'Verified').length
  const pendingApprovals = approvals.filter((a) => a.status !== 'Approved').length
  const activeTx = registrations.filter((r) => r.status === 'Pending').length + pendingApprovals
  const taxDue = tax.filter((t) => (t.dueAmountRs || 0) > 0).length

  return {
    isDemo: true,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalParcels: parcels.length,
      registeredBuildings: buildings.length,
      ulpinAssigned: ulpins.length,
      verifiedProperties: verifiedUnits,
      activeTransactions: activeTx,
      pendingApprovals,
      disputes: disputes.length,
      propertyTaxRecords: tax.length,
      totalFloors: floors.length,
      totalUnits: units.length,
    },
    charts: {
      landUseDistribution: toSeries(tally(parcels, 'landUse')),
      buildingStatus: toSeries(tally(buildings, 'constructionStatus')),
      approvalStatus: toSeries(tally(approvals, 'status')),
      propertyTypeDistribution: toSeries(tally(units, 'usage')),
      unitStatus: toSeries(tally(units, 'status')),
      disputeStatus: toSeries(tally(disputes, 'status')),
      registrationTrend: registrationTrend(registrations),
      unitsPerBuilding: buildings.map((b) => ({ name: b.shortName, value: b.unitCount })),
    },
  }
}

function registrationTrend(registrations) {
  const byYear = {}
  for (const r of registrations) {
    if (!r.registeredOn) continue
    const y = new Date(r.registeredOn).getFullYear()
    if (Number.isNaN(y)) continue
    byYear[y] = (byYear[y] || 0) + 1
  }
  return Object.entries(byYear)
    .map(([year, value]) => ({ name: String(year), value }))
    .sort((a, b) => Number(a.name) - Number(b.name))
}

export async function analyticsStats() {
  const [units, buildings, parcels, disputes, tax, approvals] = await Promise.all([
    db.collection('propertyUnits').find({}),
    db.collection('buildings').find({}),
    db.collection('parcels').find({}),
    db.collection('disputes').find({}),
    db.collection('propertyTax').find({}),
    db.collection('buildingApprovals').find({}),
  ])

  const bedroomMix = toSeries(tally(units.filter((u) => u.usage === 'Residential'), 'bedrooms'))
  const facingMix = toSeries(tally(units, 'facing'))
  const buildingDensity = buildings.map((b) => ({
    name: b.shortName,
    value: Math.round((b.unitCount / Math.max(b.footprintSqm, 1)) * 1000) / 10,
  }))
  const taxByStatus = toSeries(tally(tax, 'status'))
  const disputeByType = toSeries(tally(disputes, 'type'))
  const constructionGrowth = toSeries(
    tally(buildings, (b) => String(b.completionYear)),
  ).sort((a, b) => Number(a.name) - Number(b.name))

  return {
    isDemo: true,
    landUse: toSeries(tally(parcels, 'landUse')),
    bedroomMix,
    facingMix,
    buildingDensity,
    taxByStatus,
    disputeByType,
    constructionGrowth,
    approvalAnalytics: toSeries(tally(approvals, 'status')),
    heatmap: buildings.map((b) => ({
      buildingId: b.buildingId,
      lon: b.centroid.coordinates[0],
      lat: b.centroid.coordinates[1],
      weight: b.unitCount,
    })),
  }
}
