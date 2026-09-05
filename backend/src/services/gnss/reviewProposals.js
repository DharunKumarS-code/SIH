// Geometry review-proposal workflow (spec section 13 — NON-NEGOTIABLE).
// Existing parcel geometry is NEVER overwritten automatically. A proposed
// adjustment is always recorded as its own PENDING_REVIEW object; only an
// explicit ACCEPT by an authorized reviewer (change-detection:review) ever
// writes to the parcels collection, and it is not reversible from here (spec
// doesn't require reversal for parcel geometry the way Phase 5 does for
// building height, but the original geometry is preserved on the proposal
// document forever for audit).

import { db } from '../../store/index.js'
import { recordAudit } from '../auditService.js'
import { GNSS_DISCLAIMER } from './config.js'

let seq = Date.now() % 100000
const nextProposalId = () => {
  seq += 1
  return `GNSSPROP-${String(seq).padStart(6, '0')}`
}

export async function createProposal({ parcelId, ulpin, proposedGeometry, controlPointIds, deviations, reason, user }) {
  const parcel = await db.collection('parcels').findOne(ulpin ? { ulpin } : { parcelId })
  if (!parcel) throw Object.assign(new Error(`No parcel found for ${ulpin || parcelId}`), { status: 404 })

  const doc = {
    proposalId: nextProposalId(),
    parcelId: parcel.parcelId,
    ulpin: parcel.ulpin,
    originalGeometry: parcel.geometry,
    proposedGeometry: proposedGeometry || null,
    controlPoints: controlPointIds || [],
    deviations: deviations || null,
    reason: reason || null,
    createdBy: user?.username || null,
    createdAt: new Date().toISOString(),
    reviewer: null,
    reviewStatus: 'PENDING_REVIEW',
    reviewedAt: null,
    isDemo: true,
    disclaimer: GNSS_DISCLAIMER,
  }
  await db.collection('geometryReviewProposals').create(doc)
  return doc
}

export async function listProposals(filter = {}) {
  return db.collection('geometryReviewProposals').find(filter, { sort: { createdAt: -1 } })
}

export async function getProposal(proposalId) {
  return db.collection('geometryReviewProposals').findOne({ proposalId })
}

/**
 * ACCEPT applies proposedGeometry onto the parcel's own geometry — the ONLY
 * code path in Phase 6 permitted to touch `parcels.geometry`, and only ever
 * reached via an explicit, permissioned reviewer action.
 */
export async function reviewProposal(proposalId, action, user, ip = null) {
  const proposal = await db.collection('geometryReviewProposals').findOne({ proposalId })
  if (!proposal) return null
  if (proposal.reviewStatus !== 'PENDING_REVIEW') return proposal

  if (action === 'ACCEPT') {
    if (!proposal.proposedGeometry) {
      throw Object.assign(new Error('This proposal has no proposedGeometry to apply.'), { status: 400 })
    }
    const before = await db.collection('parcels').findOne({ parcelId: proposal.parcelId })
    await db.collection('parcels').updateOne({ parcelId: proposal.parcelId }, {
      geometry: proposal.proposedGeometry,
      geometryReviewedAt: new Date().toISOString(),
      geometryReviewedBy: user?.username || null,
      geometrySourceProposalId: proposal.proposalId,
    })
    await recordAudit({
      user: user?.username,
      action: 'PARCEL_GEOMETRY_PROPOSAL_ACCEPTED',
      entityType: 'Parcel',
      entityId: proposal.parcelId,
      before: { geometry: before?.geometry },
      after: { geometry: proposal.proposedGeometry },
      ip,
    })
  }

  const updated = await db.collection('geometryReviewProposals').updateOne({ proposalId }, {
    reviewStatus: action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
    reviewer: user?.username || null,
    reviewedAt: new Date().toISOString(),
  })
  return updated
}
