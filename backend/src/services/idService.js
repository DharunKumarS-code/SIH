// ---------------------------------------------------------------------------
// Prototype 3D Property Identifier
// ---------------------------------------------------------------------------
// The PARCEL ULPIN (e.g. "TN-CHN-123456789") is treated as the officially
// issued land-parcel identifier for the prototype.
//
// Apartment / unit identifiers are DERIVED, prototype-only "3D Property IDs":
//
//   <ULPIN>-B<bb>-F<ff>-U<unit>
//   TN-CHN-123456789-B01-F02-U201
//
//   B01  = Building 01   (2-digit, zero-padded)
//   F02  = Floor 02      (2-digit; F00 = Ground)
//   U201 = Unit 201      (as printed on the door; not re-padded)
//
// These are NEVER official ULPINs — always label them
// "Prototype 3D Property Identifier".
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0')

export const PARCEL_ULPIN = 'TN-CHN-123456789'

/** Build a building segment, e.g. 1 -> "B01". */
export const buildingSegment = (buildingNumber) => `B${pad2(buildingNumber)}`

/** Build a floor segment. floorNumber 0 => "F00" (Ground). */
export const floorSegment = (floorNumber) => `F${pad2(floorNumber)}`

/** Build a unit segment from the printed apartment number, e.g. "201" -> "U201". */
export const unitSegment = (apartmentNumber) => `U${String(apartmentNumber)}`

/**
 * Compose a full prototype 3D Property Identifier.
 * @param {string} ulpin            Parent parcel ULPIN
 * @param {number} buildingNumber   1-based building index
 * @param {number} floorNumber      0 = Ground, 1..n = upper floors
 * @param {string|number} apartmentNumber  Printed apartment number (e.g. 201)
 */
export function makeProtoPropertyId(ulpin, buildingNumber, floorNumber, apartmentNumber) {
  return [
    ulpin,
    buildingSegment(buildingNumber),
    floorSegment(floorNumber),
    unitSegment(apartmentNumber),
  ].join('-')
}

const PROTO_RE =
  /^(?<ulpin>[A-Z]{2}-[A-Z]{3}-\d{6,12})-B(?<b>\d{2})-F(?<f>\d{2})-U(?<u>\w+)$/

/**
 * Parse a prototype 3D Property Identifier back into parts.
 * Returns null if the string is not a valid prototype id.
 */
export function parseProtoPropertyId(id) {
  const m = PROTO_RE.exec(String(id || '').trim().toUpperCase())
  if (!m) return null
  return {
    ulpin: m.groups.ulpin,
    buildingNumber: Number(m.groups.b),
    buildingSegment: `B${m.groups.b}`,
    floorNumber: Number(m.groups.f),
    floorSegment: `F${m.groups.f}`,
    unitId: `U${m.groups.u}`,
    apartmentNumber: m.groups.u,
  }
}

export const PROTOTYPE_ID_LABEL = 'Prototype 3D Property Identifier'
