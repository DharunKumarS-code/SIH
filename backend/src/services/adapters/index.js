// ---------------------------------------------------------------------------
// Interoperability layer (§18, §47)
//
// Each department is reached through an adapter with an identical interface:
//
//     adapter.fetch(ulpin, context) -> standardized envelope
//
// The concrete adapters here are MOCK / DEMO INTEGRATIONS: they read the
// prototype's own seeded store and wrap it in the standard envelope so the
// architecture demonstrates cross-department interoperability. To integrate a
// real system (TNGLMS / Tamil Nilam / Registration / property-tax portals),
// replace one adapter with a real HTTP client that returns the SAME envelope.
// No government system is scraped or bypassed.
// ---------------------------------------------------------------------------

import { db } from '../../store/index.js'

const envelope = ({ source, ulpin, status = 'verified', data, mode = 'DEMO / MOCK INTEGRATION', extra = {} }) => ({
  source,
  integration: mode,
  ulpin,
  status,
  timestamp: new Date().toISOString(),
  data,
  ...extra,
})

class MockGovernmentAPIAdapter {
  constructor(source, collection) {
    this.source = source
    this.collection = collection
  }

  // eslint-disable-next-line class-methods-use-this
  async _rows(filter) {
    return db.collection(this.collection).find(filter)
  }
}

class LandRecordsAdapter extends MockGovernmentAPIAdapter {
  constructor() {
    super('TN Land Records (Tamil Nilam) — Demo Adapter', 'parcels')
  }

  async fetch(ulpin) {
    const parcel = await db.collection('parcels').findOne({ ulpin })
    const landUse = await db.collection('landUse').findOne({ ulpin })
    return envelope({
      source: this.source,
      ulpin,
      status: parcel ? (parcel.ownershipStatus === 'Verified' ? 'verified' : 'pending') : 'not-found',
      data: parcel
        ? {
            surveyNumber: parcel.surveyNumber,
            village: parcel.village,
            taluk: parcel.taluk,
            district: parcel.district,
            extentSqft: parcel.areaSqft,
            classification: parcel.classification,
            landUse: parcel.landUse,
            zoning: landUse,
            recordOfRights: {
              ownershipStatus: parcel.ownershipStatus,
              mutationStatus: parcel.registrationStatus,
            },
          }
        : null,
    })
  }
}

class RegistrationAdapter extends MockGovernmentAPIAdapter {
  constructor() {
    super('TN Registration Dept. (IGRS) — Demo Adapter', 'registrations')
  }

  async fetch(ulpin, { propertyId } = {}) {
    const filter = propertyId ? { propertyId } : { ulpin, scope: 'Parcel' }
    const rows = await this._rows(filter)
    return envelope({
      source: this.source,
      ulpin,
      status: rows.some((r) => r.status === 'Registered') ? 'verified' : 'pending',
      data: rows,
    })
  }
}

class PlanningAdapter extends MockGovernmentAPIAdapter {
  constructor() {
    super('CMDA Planning & Master Plan — Demo Adapter', 'buildingApprovals')
  }

  async fetch(ulpin, { buildingId } = {}) {
    const approvals = await this._rows(buildingId ? { buildingId } : { ulpin })
    const masterPlan = await db.collection('masterPlans').find({})
    return envelope({
      source: this.source,
      ulpin,
      status: approvals.every((a) => a.status === 'Approved') ? 'verified' : 'partial',
      data: { approvals, masterPlanZones: masterPlan.map((m) => ({ zoneCode: m.zoneCode, zoneName: m.zoneName, description: m.description })) },
    })
  }
}

class PropertyTaxAdapter extends MockGovernmentAPIAdapter {
  constructor() {
    super('Greater Chennai Corporation — Property Tax — Demo Adapter', 'propertyTax')
  }

  async fetch(ulpin, { propertyId } = {}) {
    const rows = await this._rows(propertyId ? { propertyId } : { ulpin, scope: 'Parcel' })
    const due = rows.reduce((s, r) => s + (r.dueAmountRs || 0), 0)
    return envelope({
      source: this.source,
      ulpin,
      status: due === 0 ? 'verified' : 'attention',
      data: { assessments: rows, totalDueRs: due },
    })
  }
}

class DisputeAdapter extends MockGovernmentAPIAdapter {
  constructor() {
    super('Courts / Revenue Dispute Register — Demo Adapter', 'disputes')
  }

  async fetch(ulpin, { propertyId } = {}) {
    const rows = await this._rows(propertyId ? { $or: [{ propertyId }, { ulpin, scope: 'Parcel' }] } : { ulpin })
    return envelope({
      source: this.source,
      ulpin,
      status: rows.length === 0 ? 'clear' : 'flagged',
      data: rows,
    })
  }
}

class UtilityAdapter extends MockGovernmentAPIAdapter {
  constructor() {
    super('Utility Providers (Metro Water / TANGEDCO) — Demo Adapter', 'utilities')
  }

  async fetch(ulpin) {
    const rows = await this._rows({})
    return envelope({
      source: this.source,
      ulpin,
      status: 'informational',
      data: rows.map((r) => ({ type: r.type, operator: r.operator, status: r.status })),
    })
  }
}

export const adapters = {
  LandRecords: new LandRecordsAdapter(),
  Registration: new RegistrationAdapter(),
  Planning: new PlanningAdapter(),
  PropertyTax: new PropertyTaxAdapter(),
  Disputes: new DisputeAdapter(),
  Utilities: new UtilityAdapter(),
}

/** Aggregate every department's view of a ULPIN into one interoperable record. */
export async function unifiedRecord(ulpin, context = {}) {
  const entries = await Promise.all(
    Object.entries(adapters).map(async ([key, adapter]) => {
      try {
        return [key, await adapter.fetch(ulpin, context)]
      } catch (err) {
        return [key, { source: adapter.source, ulpin, status: 'error', error: err.message, timestamp: new Date().toISOString() }]
      }
    }),
  )
  return {
    ulpin,
    generatedAt: new Date().toISOString(),
    integrationMode: 'DEMO / MOCK INTEGRATION',
    departments: Object.fromEntries(entries),
  }
}
