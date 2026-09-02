// ---------------------------------------------------------------------------
// LAND STACK — synthetic Chennai (OMR / Sholinganallur) demo dataset.
//
// EVERYTHING in this file is DEMO DATA. It uses realistic Chennai coordinates
// and plausible values but represents NO real parcel, building, person, tax
// account, court case or government record. `isDemo: true` is stamped on the
// spatial layers so the UI can label them.
//
// Hierarchy produced:
//   Parcel (ULPIN)  ->  Building (B01..B05)  ->  Floor (F00..Fnn)  ->  Unit
//   + Common Areas per building
//   + governance records (RoR / registration / encumbrance / tax / approval)
//   + master plan / land use / utilities / disputes / documents
// ---------------------------------------------------------------------------

import bcrypt from 'bcryptjs'
import { rectRing, polygon, point, gridCells, ringAreaM2, mToDegLon, mToDegLat } from './geo.js'
import { makeProtoPropertyId, PARCEL_ULPIN } from '../services/idService.js'
import { DEMO_PEOPLE, DEMO_BANKS } from './names.js'

// deterministic RNG so ids / owners are stable across boots
function mulberry32(seed) {
  return function rng() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20260902)
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const int = (a, b) => a + Math.floor(rng() * (b - a + 1))
const pad2 = (n) => String(n).padStart(2, '0')

// Sholinganallur / OMR — primary demonstration parcel centre
const BASE = { lon: 80.22705, lat: 12.90045 }
const GROUND_ELEV = 8 // metres, approx local ground
const FLOOR_HEIGHT = 3.2

const FACINGS = ['East', 'West', 'North', 'South']

const BUILDINGS_CFG = [
  { n: 1, name: 'Sai Residency', floors: 10, cols: 3, rows: 2, w: 32, d: 22, offN: -70, offE: -55, year: 2021, status: 'Completed' },
  { n: 2, name: 'Ocean View Apartments', floors: 12, cols: 4, rows: 2, w: 42, d: 24, offN: -60, offE: 60, year: 2023, status: 'Completed' },
  { n: 3, name: 'Sunrise Heights', floors: 8, cols: 2, rows: 2, w: 26, d: 20, offN: 55, offE: -60, year: 2019, status: 'Completed' },
  { n: 4, name: 'Green Towers', floors: 14, cols: 3, rows: 2, w: 34, d: 24, offN: 60, offE: 70, year: 2024, status: 'Under Construction' },
  { n: 5, name: 'Pearl Residency', floors: 9, cols: 2, rows: 2, w: 24, d: 20, offN: 118, offE: 4, year: 2020, status: 'Completed' },
]

const COMMON_AREA_TYPES = [
  { type: 'Lobby', floor: 0 },
  { type: 'Staircase', floor: 0 },
  { type: 'Lift Core', floor: 0 },
  { type: 'Corridor', floor: 1 },
  { type: 'Parking', floor: 0 },
  { type: 'Garden', floor: 0 },
]

function offsetLonLat(lon, lat, eastM, northM) {
  return [lon + mToDegLon(eastM, lat), lat + mToDegLat(northM)]
}

export function buildSeed() {
  const now = new Date()
  const iso = (d) => new Date(d).toISOString()

  // ---- users (one per role) --------------------------------------------
  const rawUsers = [
    { username: 'citizen01', name: 'Priya Raj', role: 'Citizen', password: 'Citizen@123' },
    { username: 'land01', name: 'Land Officer (Sholinganallur)', role: 'Land Officer', password: 'Officer@123' },
    { username: 'survey01', name: 'Survey Officer (Div. 4)', role: 'Survey Officer', password: 'Officer@123' },
    { username: 'planning01', name: 'Planning Officer (CMDA)', role: 'Planning Officer', password: 'Officer@123' },
    { username: 'revenue01', name: 'Revenue Officer (Zone 15)', role: 'Revenue Officer', password: 'Officer@123' },
    { username: 'admin01', name: 'System Administrator', role: 'Administrator', password: 'Admin@123' },
  ]
  const users = rawUsers.map((u, i) => ({
    id: `usr-${pad2(i + 1)}`,
    username: u.username,
    name: u.name,
    email: `${u.username}@landstack.demo`,
    role: u.role,
    passwordHash: bcrypt.hashSync(u.password, 8),
    demoPassword: u.password, // surfaced only on GET /api/system/demo-credentials
    createdAt: iso(now),
  }))

  // ---- owners ---------------------------------------------------------
  const owners = DEMO_PEOPLE.map((name, i) => ({
    id: `own-${pad2(i + 1)}`,
    name,
    ownershipType: rng() > 0.75 ? 'Joint' : 'Individual',
    contact: `+91 9${int(100000000, 999999999)}`,
    isDemo: true,
  }))
  const anOwner = () => pick(owners)

  // ---- primary parcel + neighbours ----------------------------------
  const parcels = []
  const ulpins = []
  const landUse = []

  const primaryRing = rectRing(BASE.lon, BASE.lat, 270, 250)
  const primary = {
    ulpin: PARCEL_ULPIN,
    isOfficialUlpin: true,
    parcelId: 'PCL-CHN-SHLN-0001',
    surveyNumber: '231/5',
    subDivision: '231/5A',
    village: 'Sholinganallur',
    taluk: 'Sholinganallur',
    district: 'Chengalpattu',
    zone: 'Zone 15 (Sholinganallur)',
    ward: 'Ward 191',
    corporation: 'Greater Chennai Corporation',
    geometry: polygon(primaryRing),
    centroid: point(BASE.lon, BASE.lat),
    areaSqm: Math.round(ringAreaM2(primaryRing, BASE.lat)),
    areaSqft: Math.round(ringAreaM2(primaryRing, BASE.lat) * 10.7639),
    landUse: 'Primary Residential',
    classification: 'Residential (Apartment Complex)',
    ownershipStatus: 'Verified',
    registrationStatus: 'Registered',
    encumbranceStatus: 'Partly Encumbered',
    propertyTaxStatus: 'Paid',
    buildingStatus: '5 buildings, 4 completed / 1 under construction',
    status: 'Verified',
    isDemo: true,
  }
  parcels.push(primary)
  ulpins.push({
    ulpin: PARCEL_ULPIN,
    parcelId: primary.parcelId,
    kind: 'Parcel ULPIN',
    isOfficial: true,
    issuedOn: iso('2022-06-01'),
    issuingAuthority: 'Survey & Settlement Dept., Tamil Nadu (prototype reference)',
    status: 'Active',
  })
  landUse.push({
    ulpin: PARCEL_ULPIN,
    zone: 'Primary Residential',
    zoneCode: 'R1',
    permissibleFAR: 2.0,
    actualFAR: 1.85,
    maxHeightM: 45,
    notes: 'Apartment complex within permissible FAR (demo assessment).',
    isDemo: true,
  })

  const NEIGH_USES = ['Mixed Residential', 'Commercial', 'Institutional', 'Open Space', 'Primary Residential']
  for (let i = 0; i < 11; i += 1) {
    const ang = (i / 11) * Math.PI * 2
    const dist = 220 + int(0, 120)
    const [clon, clat] = offsetLonLat(BASE.lon, BASE.lat, Math.cos(ang) * dist, Math.sin(ang) * dist)
    const w = int(60, 140)
    const d = int(60, 140)
    const ring = rectRing(clon, clat, w, d)
    const use = NEIGH_USES[i % NEIGH_USES.length]
    const ul = `TN-CHN-1234567${pad2(90 + i)}`
    parcels.push({
      ulpin: ul,
      isOfficialUlpin: true,
      parcelId: `PCL-CHN-SHLN-${pad2(i + 2)}`,
      surveyNumber: `${int(200, 260)}/${int(1, 9)}`,
      village: 'Sholinganallur',
      taluk: 'Sholinganallur',
      district: 'Chengalpattu',
      zone: 'Zone 15 (Sholinganallur)',
      ward: `Ward ${190 + (i % 6)}`,
      corporation: 'Greater Chennai Corporation',
      geometry: polygon(ring),
      centroid: point(clon, clat),
      areaSqm: Math.round(ringAreaM2(ring, clat)),
      areaSqft: Math.round(ringAreaM2(ring, clat) * 10.7639),
      landUse: use,
      classification: use,
      ownershipStatus: pick(['Verified', 'Verified', 'Under Review']),
      registrationStatus: pick(['Registered', 'Registered', 'Pending']),
      encumbranceStatus: pick(['Nil', 'Nil', 'Mortgage']),
      propertyTaxStatus: pick(['Paid', 'Due', 'Paid']),
      buildingStatus: pick(['Vacant plot', '1 building', '2 buildings', 'Under construction']),
      status: pick(['Verified', 'Verified', 'Under Review']),
      isDemo: true,
    })
    ulpins.push({
      ulpin: ul,
      parcelId: `PCL-CHN-SHLN-${pad2(i + 2)}`,
      kind: 'Parcel ULPIN',
      isOfficial: true,
      issuedOn: iso('2022-06-01'),
      issuingAuthority: 'Survey & Settlement Dept., Tamil Nadu (prototype reference)',
      status: 'Active',
    })
    landUse.push({
      ulpin: ul,
      zone: use,
      zoneCode: use === 'Commercial' ? 'C2' : use === 'Institutional' ? 'I1' : use === 'Open Space' ? 'OS' : 'R2',
      permissibleFAR: use === 'Commercial' ? 3.25 : 2.0,
      actualFAR: Number((rng() * 1.6 + 0.4).toFixed(2)),
      maxHeightM: use === 'Commercial' ? 60 : 45,
      notes: 'Demo zoning assessment.',
      isDemo: true,
    })
  }

  // ---- buildings / floors / units / common areas -------------------
  const buildings = []
  const floors = []
  const units = []
  const commonAreas = []

  for (const cfg of BUILDINGS_CFG) {
    const [blon, blat] = offsetLonLat(BASE.lon, BASE.lat, cfg.offE, cfg.offN)
    const buildingSeg = `B${pad2(cfg.n)}`
    const buildingId = `${PARCEL_ULPIN}-${buildingSeg}`
    const totalFloors = cfg.floors // upper floors; plus ground (F00)
    const heightM = GROUND_ELEV + (totalFloors + 1) * FLOOR_HEIGHT
    const footRing = rectRing(blon, blat, cfg.w, cfg.d)
    const unitsPerFloor = cfg.cols * cfg.rows

    buildings.push({
      buildingId,
      buildingNumber: cfg.n,
      buildingSegment: buildingSeg,
      ulpin: PARCEL_ULPIN,
      parcelId: primary.parcelId,
      name: `${buildingSeg} – ${cfg.name}`,
      shortName: cfg.name,
      geometry: polygon(footRing),
      centroid: point(blon, blat),
      footprintSqm: Math.round(ringAreaM2(footRing, blat)),
      floorsAboveGround: totalFloors,
      groundFloors: 1,
      totalFloors: totalFloors + 1,
      unitsPerFloor,
      unitCount: unitsPerFloor * totalFloors,
      heightM: Math.round(heightM * 10) / 10,
      baseElevationM: GROUND_ELEV,
      floorHeightM: FLOOR_HEIGHT,
      constructionType: 'RCC',
      completionYear: cfg.year,
      approvalStatus: cfg.status === 'Under Construction' ? 'Under Review' : 'Approved',
      constructionStatus: cfg.status,
      status: cfg.status === 'Under Construction' ? 'Under Review' : 'Verified',
      isDemo: true,
    })

    // ground floor F00 — common areas only (+ 2 commercial units)
    const groundId = `${buildingId}-F00`
    floors.push({
      floorId: groundId,
      buildingId,
      ulpin: PARCEL_ULPIN,
      floorNumber: 0,
      floorSegment: 'F00',
      label: 'Ground',
      heightM: FLOOR_HEIGHT,
      baseHeight: GROUND_ELEV,
      topHeight: GROUND_ELEV + FLOOR_HEIGHT,
      unitCount: 2,
      isDemo: true,
    })
    // 2 ground-floor commercial units
    const gCells = gridCells(blon, blat, cfg.w, cfg.d, 2, 1)
    for (let gi = 0; gi < 2; gi += 1) {
      const cell = gCells[gi]
      const apt = `00${gi + 1}`
      const owner = anOwner()
      units.push({
        propertyId: makeProtoPropertyId(PARCEL_ULPIN, cfg.n, 0, apt),
        idKind: 'Prototype 3D Property Identifier',
        ulpin: PARCEL_ULPIN,
        parcelId: primary.parcelId,
        buildingId,
        buildingNumber: cfg.n,
        buildingSegment: buildingSeg,
        buildingName: cfg.name,
        floorId: groundId,
        floorNumber: 0,
        floorSegment: 'F00',
        floorLabel: 'Ground',
        unitId: `U${apt}`,
        apartmentNumber: apt,
        name: `Shop ${apt}`,
        geometry: polygon(cell.ring),
        centroid: point(cell.centroid[0], cell.centroid[1]),
        baseHeight: GROUND_ELEV,
        topHeight: GROUND_ELEV + FLOOR_HEIGHT - 0.3,
        carpetAreaSqft: int(380, 620),
        builtUpAreaSqft: 0,
        bedrooms: 'Commercial',
        facing: pick(FACINGS),
        constructionType: 'RCC',
        completionYear: cfg.year,
        usage: 'Commercial',
        propertyType: 'Commercial Unit',
        status: pick(['Verified', 'Verified', 'Pending']),
        ownerId: owner.id,
        owner: { name: owner.name, ownershipType: owner.ownershipType, sharePct: 100 },
        isDemo: true,
      })
    }
    units[units.length - 1].builtUpAreaSqft = Math.round(units[units.length - 1].carpetAreaSqft * 1.22)
    units[units.length - 2].builtUpAreaSqft = Math.round(units[units.length - 2].carpetAreaSqft * 1.22)

    // common areas
    for (const ca of COMMON_AREA_TYPES) {
      const [calon, calat] = offsetLonLat(blon, blat, int(-cfg.w / 3, cfg.w / 3), int(-cfg.d / 3, cfg.d / 3))
      const caRing = rectRing(calon, calat, Math.max(6, cfg.w / 4), Math.max(6, cfg.d / 4))
      commonAreas.push({
        commonAreaId: `${buildingId}-CA-${ca.type.replace(/\s+/g, '').toUpperCase()}`,
        buildingId,
        ulpin: PARCEL_ULPIN,
        type: ca.type,
        name: `${cfg.name} — ${ca.type}`,
        floorNumber: ca.floor,
        geometry: polygon(caRing),
        centroid: point(calon, calat),
        baseHeight: GROUND_ELEV + ca.floor * FLOOR_HEIGHT,
        topHeight: GROUND_ELEV + (ca.floor + 1) * FLOOR_HEIGHT - 0.4,
        ownership: 'COMMON AREA',
        assignedToUnit: null,
        maintainedBy: 'Owners Welfare Association (demo)',
        note: 'Common property — not held as individual apartment ownership.',
        isDemo: true,
      })
    }

    // upper floors
    for (let f = 1; f <= totalFloors; f += 1) {
      const floorId = `${buildingId}-F${pad2(f)}`
      const underConstruction = cfg.status === 'Under Construction' && f > totalFloors - 3
      floors.push({
        floorId,
        buildingId,
        ulpin: PARCEL_ULPIN,
        floorNumber: f,
        floorSegment: `F${pad2(f)}`,
        label: `Floor ${pad2(f)}`,
        heightM: FLOOR_HEIGHT,
        baseHeight: GROUND_ELEV + f * FLOOR_HEIGHT,
        topHeight: GROUND_ELEV + (f + 1) * FLOOR_HEIGHT,
        unitCount: unitsPerFloor,
        constructionStatus: underConstruction ? 'Under Construction' : 'Completed',
        isDemo: true,
      })
      const cells = gridCells(blon, blat, cfg.w, cfg.d, cfg.cols, cfg.rows)
      for (let ui = 0; ui < unitsPerFloor; ui += 1) {
        const cell = cells[ui]
        const apt = `${f}${pad2(ui + 1)}`
        const owner = anOwner()
        const bhk = pick(['2 BHK', '2 BHK', '3 BHK', '3 BHK', '1 BHK'])
        const carpet = bhk === '1 BHK' ? int(520, 640) : bhk === '2 BHK' ? int(880, 1080) : int(1180, 1480)
        const status = underConstruction
          ? 'Under Review'
          : pick(['Verified', 'Verified', 'Verified', 'Pending', 'Disputed'])
        units.push({
          propertyId: makeProtoPropertyId(PARCEL_ULPIN, cfg.n, f, apt),
          idKind: 'Prototype 3D Property Identifier',
          ulpin: PARCEL_ULPIN,
          parcelId: primary.parcelId,
          buildingId,
          buildingNumber: cfg.n,
          buildingSegment: buildingSeg,
          buildingName: cfg.name,
          floorId,
          floorNumber: f,
          floorSegment: `F${pad2(f)}`,
          floorLabel: `Floor ${pad2(f)}`,
          unitId: `U${apt}`,
          apartmentNumber: apt,
          name: `Unit ${apt}`,
          geometry: polygon(cell.ring),
          centroid: point(cell.centroid[0], cell.centroid[1]),
          baseHeight: GROUND_ELEV + f * FLOOR_HEIGHT,
          topHeight: GROUND_ELEV + (f + 1) * FLOOR_HEIGHT - 0.3,
          gridCol: cell.col,
          gridRow: cell.row,
          carpetAreaSqft: carpet,
          builtUpAreaSqft: Math.round(carpet * 1.2),
          bedrooms: bhk,
          facing: pick(FACINGS),
          constructionType: 'RCC',
          completionYear: cfg.year,
          usage: 'Residential',
          propertyType: 'Apartment Unit',
          status,
          ownerId: owner.id,
          owner: { name: owner.name, ownershipType: owner.ownershipType, sharePct: owner.ownershipType === 'Joint' ? 50 : 100 },
          isDemo: true,
        })
      }
    }
  }

  // ---- governance records ------------------------------------------
  const registrations = []
  const encumbrances = []
  const buildingApprovals = []
  const propertyTax = []
  const disputes = []
  const documents = []

  // parcel-level RoR / registration / EC / tax
  for (const p of parcels) {
    const o1 = anOwner()
    registrations.push({
      registrationId: `REG-${p.parcelId}`,
      ulpin: p.ulpin,
      scope: 'Parcel',
      docNumber: `REG/CHN/${int(2015, 2024)}/${int(1000, 9999)}`,
      registeredOn: iso(`${int(2015, 2024)}-0${int(1, 9)}-${int(10, 27)}`),
      subRegistrarOffice: 'Sub Registrar Office, Sholinganallur',
      natureOfDeed: 'Sale Deed',
      considerationValueLakh: int(60, 480),
      parties: { seller: anOwner().name, buyer: o1.name },
      status: p.registrationStatus === 'Registered' ? 'Registered' : 'Pending',
      isDemo: true,
    })
    propertyTax.push({
      taxId: `PT-${p.parcelId}`,
      ulpin: p.ulpin,
      scope: 'Parcel',
      assessmentNumber: `Z15/${int(100, 999)}/${int(1000, 9999)}`,
      annualValueRs: int(24000, 180000),
      halfYearlyTaxRs: int(1800, 14000),
      paidUpto: p.propertyTaxStatus === 'Paid' ? 'H1 2025-26' : 'H2 2024-25',
      dueAmountRs: p.propertyTaxStatus === 'Paid' ? 0 : int(1800, 22000),
      status: p.propertyTaxStatus === 'Paid' ? 'Paid' : p.propertyTaxStatus === 'Due' ? 'Due' : 'Partially Paid',
      isDemo: true,
    })
    if (p.encumbranceStatus === 'Mortgage' || p.encumbranceStatus === 'Partly Encumbered') {
      encumbrances.push({
        encumbranceId: `EC-${p.parcelId}`,
        ulpin: p.ulpin,
        scope: 'Parcel',
        ecNumber: `EC/CHN/${int(2018, 2024)}/${int(1000, 9999)}`,
        type: 'Mortgage',
        bank: pick(DEMO_BANKS),
        amountLakh: int(20, 260),
        fromDate: iso(`${int(2018, 2023)}-0${int(1, 9)}-15`),
        toDate: iso(`${int(2026, 2031)}-0${int(1, 9)}-15`),
        status: 'Active',
        isDemo: true,
      })
    } else {
      encumbrances.push({
        encumbranceId: `EC-${p.parcelId}`,
        ulpin: p.ulpin,
        scope: 'Parcel',
        ecNumber: `EC/CHN/${int(2018, 2024)}/${int(1000, 9999)}`,
        type: 'Nil',
        status: 'Clear',
        note: 'No subsisting encumbrance for the searched period (demo).',
        isDemo: true,
      })
    }
    for (const cat of ['RoR', 'Sale Deed', 'Encumbrance Certificate', 'Tax Receipt', 'Survey Report']) {
      documents.push({
        docId: `DOC-${p.parcelId}-${cat.replace(/\s+/g, '')}`,
        category: cat,
        scope: 'Parcel',
        ulpin: p.ulpin,
        title: `${cat} — ${p.parcelId}`,
        fileUrl: `/demo-docs/${cat.toLowerCase().replace(/\s+/g, '-')}.pdf`,
        issuedOn: iso(`${int(2016, 2024)}-0${int(1, 9)}-12`),
        issuedBy: cat === 'Survey Report' ? 'Survey Office, Sholinganallur' : 'Sub Registrar Office',
        isDemo: true,
      })
    }
  }

  // building approvals
  for (const b of buildings) {
    buildingApprovals.push({
      approvalId: `BPA-${b.buildingId}`,
      buildingId: b.buildingId,
      ulpin: b.ulpin,
      planNumber: `BPA/CMDA/${b.completionYear - 2}/${int(1000, 9999)}`,
      authority: 'Chennai Metropolitan Development Authority (CMDA)',
      approvedFloors: b.floorsAboveGround + 1,
      approvedHeightM: b.heightM + 1.5,
      approvedOn: iso(`${b.completionYear - 2}-0${int(1, 9)}-20`),
      status: b.constructionStatus === 'Under Construction' ? 'Under Review' : 'Approved',
      deviations: b.shortName === 'Green Towers' ? ['Top 2 floors pending completion certificate'] : [],
      isDemo: true,
    })
    documents.push({
      docId: `DOC-${b.buildingId}-BPA`,
      category: 'Building Approval',
      scope: 'Building',
      buildingId: b.buildingId,
      ulpin: b.ulpin,
      title: `Building Plan Approval — ${b.name}`,
      fileUrl: '/demo-docs/building-approval.pdf',
      issuedOn: iso(`${b.completionYear - 2}-0${int(1, 9)}-20`),
      issuedBy: 'CMDA',
      isDemo: true,
    })
  }

  // unit-level registration / EC / tax + docs, and disputes for "Disputed" units
  for (const u of units) {
    if (u.usage === 'Commercial') continue
    registrations.push({
      registrationId: `REG-${u.propertyId}`,
      ulpin: u.ulpin,
      propertyId: u.propertyId,
      buildingId: u.buildingId,
      scope: 'Unit',
      docNumber: `REG/CHN/${u.completionYear}/${int(1000, 9999)}`,
      registeredOn: iso(`${u.completionYear}-0${int(1, 9)}-${int(10, 27)}`),
      subRegistrarOffice: 'Sub Registrar Office, Sholinganallur',
      natureOfDeed: 'Apartment Sale Deed',
      considerationValueLakh: int(45, 220),
      parties: { seller: `${u.buildingName} Developers (demo)`, buyer: u.owner.name },
      status: u.status === 'Pending' ? 'Pending' : 'Registered',
      isDemo: true,
    })
    propertyTax.push({
      taxId: `PT-${u.propertyId}`,
      ulpin: u.ulpin,
      propertyId: u.propertyId,
      buildingId: u.buildingId,
      scope: 'Unit',
      assessmentNumber: `Z15/${u.buildingSegment}/${u.apartmentNumber}`,
      annualValueRs: Math.round(u.carpetAreaSqft * int(140, 240)),
      halfYearlyTaxRs: Math.round(u.carpetAreaSqft * int(8, 16)),
      paidUpto: rng() > 0.3 ? 'H1 2025-26' : 'H2 2024-25',
      dueAmountRs: rng() > 0.3 ? 0 : int(1200, 9000),
      status: rng() > 0.3 ? 'Paid' : 'Due',
      isDemo: true,
    })
    if (rng() > 0.82) {
      encumbrances.push({
        encumbranceId: `EC-${u.propertyId}`,
        ulpin: u.ulpin,
        propertyId: u.propertyId,
        scope: 'Unit',
        ecNumber: `EC/CHN/${u.completionYear}/${int(1000, 9999)}`,
        type: 'Mortgage',
        bank: pick(DEMO_BANKS),
        amountLakh: int(20, 120),
        fromDate: iso(`${u.completionYear}-0${int(1, 9)}-10`),
        toDate: iso(`${u.completionYear + 8}-0${int(1, 9)}-10`),
        status: 'Active',
        isDemo: true,
      })
    }
    for (const cat of ['Sale Deed', 'Registration', 'Encumbrance Certificate', 'Tax Receipt']) {
      documents.push({
        docId: `DOC-${u.propertyId}-${cat.replace(/\s+/g, '')}`,
        category: cat,
        scope: 'Unit',
        propertyId: u.propertyId,
        buildingId: u.buildingId,
        ulpin: u.ulpin,
        title: `${cat} — ${u.propertyId}`,
        fileUrl: `/demo-docs/${cat.toLowerCase().replace(/\s+/g, '-')}.pdf`,
        issuedOn: iso(`${u.completionYear}-0${int(1, 9)}-12`),
        issuedBy: cat === 'Tax Receipt' ? 'Greater Chennai Corporation' : 'Sub Registrar Office',
        isDemo: true,
      })
    }
  }

  // disputes — a handful, some tied to units/buildings
  const disputedUnits = units.filter((u) => u.status === 'Disputed').slice(0, 4)
  const disputeTypes = ['Ownership', 'Inheritance', 'Encroachment', 'Boundary', 'Tax Assessment']
  disputedUnits.forEach((u, i) => {
    disputes.push({
      disputeId: `DSP-${pad2(i + 1)}`,
      scope: 'Unit',
      ulpin: u.ulpin,
      propertyId: u.propertyId,
      buildingId: u.buildingId,
      floorNumber: u.floorNumber,
      unitId: u.unitId,
      type: disputeTypes[i % disputeTypes.length],
      status: pick(['Open', 'Under Mediation', 'In Court']),
      filedOn: iso(`2024-0${int(1, 9)}-${int(5, 26)}`),
      court: 'Principal District Court, Chengalpattu (demo reference)',
      parties: [u.owner.name, anOwner().name],
      summary: `Demo ${disputeTypes[i % disputeTypes.length].toLowerCase()} dispute concerning ${u.propertyId}.`,
      geometry: u.centroid,
      isDemo: true,
    })
  })
  // one parcel-level boundary dispute
  disputes.push({
    disputeId: `DSP-05`,
    scope: 'Parcel',
    ulpin: parcels[3].ulpin,
    type: 'Boundary',
    status: 'Under Mediation',
    filedOn: iso('2023-11-14'),
    court: 'Revenue Divisional Officer, Sholinganallur (demo)',
    parties: [anOwner().name, anOwner().name],
    summary: 'Demo boundary overlap between adjacent parcels pending re-survey.',
    geometry: parcels[3].centroid,
    isDemo: true,
  })

  // ---- master plan zones -----------------------------------------
  const masterPlans = [
    {
      planId: 'MP-CHN-2026-R1',
      name: 'Chennai Master Plan (Prototype Reference)',
      zoneCode: 'R1',
      zoneName: 'Primary Residential',
      description: 'Primarily residential; apartments permitted within FAR 2.0.',
      geometry: polygon(rectRing(BASE.lon, BASE.lat, 900, 900)),
      isDemo: true,
    },
    {
      planId: 'MP-CHN-2026-MU',
      name: 'Chennai Master Plan (Prototype Reference)',
      zoneCode: 'MU',
      zoneName: 'Mixed Use Corridor (OMR)',
      description: 'Mixed residential + commercial along the IT corridor.',
      geometry: polygon(rectRing(BASE.lon + 0.006, BASE.lat, 400, 1400)),
      isDemo: true,
    },
  ]

  // ---- utilities (LineStrings along notional roads) --------------
  const utilTypes = ['Water Supply', 'Sewer Line', 'Electricity', 'Drainage', 'Gas Pipeline', 'Fiber Network']
  const utilities = utilTypes.map((t, i) => {
    const yOff = -180 + i * 70
    const [ax, ay] = offsetLonLat(BASE.lon, BASE.lat, -260, yOff)
    const [bx, by] = offsetLonLat(BASE.lon, BASE.lat, 260, yOff + int(-20, 20))
    return {
      utilityId: `UTL-${pad2(i + 1)}`,
      type: t,
      operator:
        t === 'Water Supply' || t === 'Sewer Line' || t === 'Drainage'
          ? 'Chennai Metro Water'
          : t === 'Electricity'
          ? 'TANGEDCO'
          : t === 'Gas Pipeline'
          ? 'City Gas Distribution (demo)'
          : 'Fiber ISP (demo)',
      status: 'Operational',
      geometry: { type: 'LineString', coordinates: [[ax, ay], [BASE.lon, BASE.lat + mToDegLat(yOff)], [bx, by]] },
      isDemo: true,
    }
  })

  // ---- environment / admin boundary layers ---------------------
  const environment = [
    { id: 'ENV-WB-01', kind: 'Water Body', name: 'Okkiyam Maduvu backwater (demo extent)', geometry: polygon(rectRing(BASE.lon - 0.004, BASE.lat - 0.004, 260, 120)), isDemo: true },
    { id: 'ENV-ECO-01', kind: 'Eco Sensitive Zone', name: 'Pallikaranai marsh buffer (demo)', geometry: polygon(rectRing(BASE.lon - 0.012, BASE.lat + 0.006, 500, 400)), isDemo: true },
    { id: 'ENV-CRZ-01', kind: 'Coastal Regulation Zone', name: 'CRZ-II indicative line (demo)', geometry: { type: 'LineString', coordinates: [[BASE.lon + 0.02, BASE.lat - 0.01], [BASE.lon + 0.021, BASE.lat + 0.012]] }, isDemo: true },
    { id: 'ENV-HER-01', kind: 'Heritage Zone', name: 'None in demo extent', geometry: polygon(rectRing(BASE.lon + 0.03, BASE.lat + 0.03, 60, 60)), isDemo: true },
  ]
  const boundaries = [
    { id: 'ADM-CORP', level: 'Corporation Boundary', name: 'Greater Chennai Corporation (demo extent)', geometry: polygon(rectRing(BASE.lon, BASE.lat, 1600, 1600)), isDemo: true },
    { id: 'ADM-ZONE', level: 'Zone Boundary', name: 'Zone 15 – Sholinganallur (demo extent)', geometry: polygon(rectRing(BASE.lon, BASE.lat, 1100, 1100)), isDemo: true },
    { id: 'ADM-WARD', level: 'Ward Boundary', name: 'Ward 191 (demo extent)', geometry: polygon(rectRing(BASE.lon, BASE.lat, 620, 620)), isDemo: true },
  ]
  const roads = [
    { id: 'ROAD-OMR', name: 'Rajiv Gandhi Salai (OMR)', class: 'Arterial', geometry: { type: 'LineString', coordinates: [[BASE.lon + 0.0075, BASE.lat - 0.012], [BASE.lon + 0.0085, BASE.lat + 0.013]] }, isDemo: true },
    { id: 'ROAD-INT-1', name: '4th Cross Street', class: 'Local', geometry: { type: 'LineString', coordinates: [[BASE.lon - 0.0026, BASE.lat - 0.0018], [BASE.lon + 0.0026, BASE.lat - 0.0018]] }, isDemo: true },
    { id: 'ROAD-INT-2', name: '5th Main Road', class: 'Local', geometry: { type: 'LineString', coordinates: [[BASE.lon - 0.0026, BASE.lat + 0.0016], [BASE.lon + 0.0026, BASE.lat + 0.0016]] }, isDemo: true },
  ]

  // ---- service requests + notifications + audit seed ----------
  const serviceRequests = [
    {
      requestId: 'SRV-0001',
      type: 'Ownership Verification',
      ulpin: PARCEL_ULPIN,
      propertyId: makeProtoPropertyId(PARCEL_ULPIN, 1, 2, '201'),
      raisedBy: 'citizen01',
      status: 'Officer Review',
      stage: 'Government Officer Review',
      submittedOn: iso('2025-07-02'),
      history: [
        { stage: 'Submitted', at: iso('2025-07-02'), by: 'citizen01', note: 'Ownership verification requested for U201.' },
        { stage: 'Document Verification', at: iso('2025-07-04'), by: 'land01', note: 'Sale deed and EC verified.' },
        { stage: 'Government Officer Review', at: iso('2025-07-06'), by: 'land01', note: 'Pending final sign-off.' },
      ],
      isDemo: true,
    },
    {
      requestId: 'SRV-0002',
      type: 'Property Tax Correction',
      ulpin: PARCEL_ULPIN,
      propertyId: makeProtoPropertyId(PARCEL_ULPIN, 2, 5, '503'),
      raisedBy: 'citizen01',
      status: 'Under Verification',
      stage: 'Technical / Zoning Verification',
      submittedOn: iso('2025-08-10'),
      history: [
        { stage: 'Submitted', at: iso('2025-08-10'), by: 'citizen01', note: 'Carpet area mismatch in tax assessment.' },
        { stage: 'Technical / Zoning Verification', at: iso('2025-08-12'), by: 'revenue01', note: 'Re-measurement scheduled.' },
      ],
      isDemo: true,
    },
  ]

  const notifications = [
    { notificationId: 'NTF-01', forRole: 'Planning Officer', kind: 'Approval Pending', message: 'B04 – Green Towers: completion certificate pending for top 2 floors.', entityRef: `${PARCEL_ULPIN}-B04`, createdAt: iso('2025-08-20'), read: false },
    { notificationId: 'NTF-02', forRole: 'Land Officer', kind: 'Dispute Created', message: 'New ownership dispute filed against a unit in B01 – Sai Residency.', entityRef: 'DSP-01', createdAt: iso('2025-08-22'), read: false },
    { notificationId: 'NTF-03', forRole: 'Revenue Officer', kind: 'Tax Due', message: '18 apartment units in the complex have property tax dues for H2 2024-25.', entityRef: PARCEL_ULPIN, createdAt: iso('2025-08-25'), read: false },
    { notificationId: 'NTF-04', forRole: 'Survey Officer', kind: 'Construction Change Detected', message: 'AI change-detection flagged possible new construction near PCL-CHN-SHLN-05.', entityRef: 'PCL-CHN-SHLN-05', createdAt: iso('2025-08-27'), read: false },
    { notificationId: 'NTF-05', forRole: 'Citizen', kind: 'Verification Completed', message: 'Ownership verification for a requested unit is nearing completion.', entityRef: 'SRV-0001', createdAt: iso('2025-08-28'), read: false },
  ]

  const auditLogs = [
    { logId: 'AUD-0001', user: 'land01', action: 'PARCEL_VERIFIED', entityType: 'Parcel', entityId: PARCEL_ULPIN, at: iso('2025-06-15T10:12:00Z'), before: { status: 'Under Review' }, after: { status: 'Verified' }, ip: '10.0.0.21' },
    { logId: 'AUD-0002', user: 'planning01', action: 'BUILDING_APPROVAL_UPDATED', entityType: 'Building', entityId: `${PARCEL_ULPIN}-B02`, at: iso('2025-06-20T09:03:00Z'), before: { status: 'Under Review' }, after: { status: 'Approved' }, ip: '10.0.0.34' },
    { logId: 'AUD-0003', user: 'land01', action: 'PROPERTY_VERIFIED', entityType: 'PropertyUnit', entityId: makeProtoPropertyId(PARCEL_ULPIN, 1, 2, '201'), at: iso('2025-07-06T14:40:00Z'), before: { status: 'Pending' }, after: { status: 'Verified' }, ip: '10.0.0.21' },
  ]

  return {
    users,
    owners,
    ulpins,
    parcels,
    buildings,
    floors,
    propertyUnits: units,
    commonAreas,
    registrations,
    encumbrances,
    buildingApprovals,
    propertyTax,
    landUse,
    masterPlans,
    utilities,
    environment,
    boundaries,
    roads,
    disputes,
    documents,
    serviceRequests,
    notifications,
    auditLogs,
  }
}

export const SEED_META = {
  region: 'Chennai — OMR / Sholinganallur (Zone 15)',
  base: BASE,
  primaryUlpin: PARCEL_ULPIN,
  disclaimer:
    'All spatial and record data in this dataset is synthetic DEMO DATA using realistic Chennai coordinates. It represents no real parcel, building, person or government record.',
}
