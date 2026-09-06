// Phase 9 — leaf constants for the Proposed 3D Property Identifier. No imports,
// so this is safe to pull into the seed builder without a circular dependency
// on the store.

export const IDENTIFIER_DISCLAIMER =
  'PROPOSED 3D PROPERTY IDENTIFIER. This identifier is a research / prototype reference created by this ' +
  'application to link an official parcel ULPIN, building, floor, unit and 3D volume. It is NOT an ' +
  'officially approved Government of India or Tamil Nadu 3D ULPIN format and does not replace the ' +
  'official parcel-level ULPIN. Volumetric rights, ownership, restrictions and encumbrances are shown ' +
  'only when supported by authoritative data. Demonstration and research records are not legally authoritative.'

export const STANDARDIZATION_NOTE =
  'No government body has approved a 3D / volumetric ULPIN standard for this project. If an authoritative ' +
  '3D cadastral standard is published later, this proposed format would be superseded by it. Until then ' +
  'the Official ULPIN remains parcel-level only.'

// Legal-status vocabulary (spec section 21). DEMO / PROPOSED / RESEARCH values
// must NEVER read as legally authoritative.
export const LEGAL_STATUS_VALUES = ['OFFICIAL', 'AUTHORIZED', 'PROPOSED', 'NOT_PROVIDED', 'NOT_ESTABLISHED', 'UNVERIFIED', 'DEMO']

/** Conceptual (placeholder) volumetric-rights container (spec section 20). */
export function conceptualVolumetricRights(volumeId) {
  return {
    volumeId: volumeId || null,
    label: 'Conceptual Volumetric Rights (Proposed Rights Association)',
    rights: [], // references / placeholders for AUTHORIZED data only
    restrictions: [],
    encumbrances: [],
    note:
      'Placeholders for authorized data. No statement of legal rights, ownership, title, lease, easement, ' +
      'mortgage or government restriction is made unless authoritative legal data is attached.',
  }
}
