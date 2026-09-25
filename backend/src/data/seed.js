// ---------------------------------------------------------------------------
// LAND STACK — synthetic Chennai demo dataset.
//
// EVERYTHING in this file is DEMO DATA. It uses realistic Chennai coordinates
// and plausible values but represents NO real parcel, building, person, tax
// account, court case or government record. `isDemo: true` is stamped on the
// spatial layers so the UI can label them.
//
// ONE Chennai-wide environment, several localities. For each locality in
// `LOCALITIES` (see `localities.js`) `buildLocality()` produces:
//   Parcel (ULPIN)  ->  Building (B01..Bnn)  ->  Floor (F00..Fnn)  ->  Unit
//   + Common Areas per building
//   + governance records (RoR / registration / encumbrance / tax / approval)
//   + master plan / land use / utilities / disputes / documents
// Every spatial + governance doc carries `locality: <id>` for filtering.
// ---------------------------------------------------------------------------

import bcrypt from 'bcryptjs'
import { rectRing, polygon, point, gridCells, ringAreaM2, mToDegLon, mToDegLat } from './geo.js'
import { makeProtoPropertyId } from '../services/idService.js'
import { DEMO_PEOPLE, DEMO_BANKS } from './names.js'
import { LOCALITIES, DEFAULT_LOCALITY_ID, CHENNAI_CITY, getLocality, localityPublic } from './localities.js'
import { buildLocalityUndergroundInfrastructure } from './underground.js'
import { buildLocalityIdentifiers } from './identifier3d.js'

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

const GROUND_ELEV = 8 // metres, approx local ground
const FLOOR_HEIGHT = 3.2
const FACINGS = ['East', 'West', 'North', 'South']

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

  // -----------------------------------------------------------------------
  // Per-locality generator. Returns one locality's slice of every collection.
  // -----------------------------------------------------------------------
  function buildLocality(loc) {
    const BASE = loc.base
    const ULPIN = loc.ulpinPrimary
    const LID = loc.id
    const fid = (prefix, suffix) => `${prefix}-${loc.idTag}-${suffix}`

    const parcels = []
    const ulpins = []
    const landUse = []

    // ---- primary parcel + neighbours --------------------------------
    const primaryRing = rectRing(BASE.lon, BASE.lat, 270, 250)
    const primary = {
      ulpin: ULPIN,
      isOfficialUlpin: true,
      parcelId: loc.primaryParcelId,
      surveyNumber: loc.surveyNumber,
      subDivision: loc.subDivision,
      subdivisionNumber: loc.subDivision,
      recordType: loc.recordType || null,
      village: loc.village,
      taluk: loc.taluk,
      district: loc.district,
      zone: loc.zone,
      ward: `Ward ${loc.wardBase}`,
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
      buildingStatus: `${loc.buildingsCfg.length} buildings`,
      status: 'Verified',
      locality: LID,
      isDemo: true,
    }
    parcels.push(primary)
    ulpins.push({
      ulpin: ULPIN,
      parcelId: primary.parcelId,
      kind: 'Parcel ULPIN',
      isOfficial: true,
      issuedOn: iso('2022-06-01'),
      issuingAuthority: 'Survey & Settlement Dept., Tamil Nadu (prototype reference)',
      status: 'Active',
      locality: LID,
    })
    landUse.push({
      ulpin: ULPIN,
      zone: 'Primary Residential',
      zoneCode: 'R1',
      permissibleFAR: 2.0,
      actualFAR: 1.85,
      maxHeightM: 45,
      notes: 'Apartment complex within permissible FAR (demo assessment).',
      locality: LID,
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
      const ul = `${loc.ulpinNeighbourBase}${pad2(90 + i)}`
      const nSurvey = `${int(200, 260)}/${int(1, 9)}`
      parcels.push({
        ulpin: ul,
        isOfficialUlpin: true,
        parcelId: `${loc.parcelPrefix}${pad2(i + 2)}`,
        surveyNumber: nSurvey,
        subdivisionNumber: `${nSurvey}${'ABCDEF'[i % 6]}`,
        recordType: loc.recordType || null,
        village: loc.village,
        taluk: loc.taluk,
        district: loc.district,
        zone: loc.zone,
        ward: `Ward ${loc.wardBase + (i % 6)}`,
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
        locality: LID,
        isDemo: true,
      })
      ulpins.push({
        ulpin: ul,
        parcelId: `${loc.parcelPrefix}${pad2(i + 2)}`,
        kind: 'Parcel ULPIN',
        isOfficial: true,
        issuedOn: iso('2022-06-01'),
        issuingAuthority: 'Survey & Settlement Dept., Tamil Nadu (prototype reference)',
        status: 'Active',
        locality: LID,
      })
      landUse.push({
        ulpin: ul,
        zone: use,
        zoneCode: use === 'Commercial' ? 'C2' : use === 'Institutional' ? 'I1' : use === 'Open Space' ? 'OS' : 'R2',
        permissibleFAR: use === 'Commercial' ? 3.25 : 2.0,
        actualFAR: Number((rng() * 1.6 + 0.4).toFixed(2)),
        maxHeightM: use === 'Commercial' ? 60 : 45,
        notes: 'Demo zoning assessment.',
        locality: LID,
        isDemo: true,
      })
    }

    // ---- buildings / floors / units / common areas -----------------
    const buildings = []
    const floors = []
    const units = []
    const commonAreas = []

    for (const cfg of loc.buildingsCfg) {
      const [blon, blat] = offsetLonLat(BASE.lon, BASE.lat, cfg.offE, cfg.offN)
      const buildingSeg = `B${pad2(cfg.n)}`
      const buildingId = `${ULPIN}-${buildingSeg}`
      const totalFloors = cfg.floors // upper floors; plus ground (F00)
      const heightM = GROUND_ELEV + (totalFloors + 1) * FLOOR_HEIGHT
      const footRing = rectRing(blon, blat, cfg.w, cfg.d)
      const unitsPerFloor = cfg.cols * cfg.rows

      buildings.push({
        buildingId,
        buildingNumber: cfg.n,
        buildingSegment: buildingSeg,
        ulpin: ULPIN,
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
        locality: LID,
        isDemo: true,
      })

      // ground floor F00 — common areas only (+ 2 commercial units)
      const groundId = `${buildingId}-F00`
      floors.push({
        floorId: groundId,
        buildingId,
        ulpin: ULPIN,
        floorNumber: 0,
        floorSegment: 'F00',
        label: 'Ground',
        heightM: FLOOR_HEIGHT,
        baseHeight: GROUND_ELEV,
        topHeight: GROUND_ELEV + FLOOR_HEIGHT,
        unitCount: 2,
        locality: LID,
        isDemo: true,
      })
      // 2 ground-floor commercial units
      const gCells = gridCells(blon, blat, cfg.w, cfg.d, 2, 1)
      for (let gi = 0; gi < 2; gi += 1) {
        const cell = gCells[gi]
        const apt = `00${gi + 1}`
        const owner = anOwner()
        units.push({
          propertyId: makeProtoPropertyId(ULPIN, cfg.n, 0, apt),
          idKind: 'Prototype 3D Property Identifier',
          ulpin: ULPIN,
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
          locality: LID,
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
          ulpin: ULPIN,
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
          locality: LID,
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
          ulpin: ULPIN,
          floorNumber: f,
          floorSegment: `F${pad2(f)}`,
          label: `Floor ${pad2(f)}`,
          heightM: FLOOR_HEIGHT,
          baseHeight: GROUND_ELEV + f * FLOOR_HEIGHT,
          topHeight: GROUND_ELEV + (f + 1) * FLOOR_HEIGHT,
          unitCount: unitsPerFloor,
          constructionStatus: underConstruction ? 'Under Construction' : 'Completed',
          locality: LID,
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
            propertyId: makeProtoPropertyId(ULPIN, cfg.n, f, apt),
            idKind: 'Prototype 3D Property Identifier',
            ulpin: ULPIN,
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
            locality: LID,
            isDemo: true,
          })
        }
      }
    }

    // ---- governance records ---------------------------------------
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
        subRegistrarOffice: loc.subRegistrarOffice,
        natureOfDeed: 'Sale Deed',
        considerationValueLakh: int(60, 480),
        parties: { seller: anOwner().name, buyer: o1.name },
        status: p.registrationStatus === 'Registered' ? 'Registered' : 'Pending',
        locality: LID,
        isDemo: true,
      })
      propertyTax.push({
        taxId: `PT-${p.parcelId}`,
        ulpin: p.ulpin,
        scope: 'Parcel',
        assessmentNumber: `${loc.idTag}/${int(100, 999)}/${int(1000, 9999)}`,
        annualValueRs: int(24000, 180000),
        halfYearlyTaxRs: int(1800, 14000),
        paidUpto: p.propertyTaxStatus === 'Paid' ? 'H1 2025-26' : 'H2 2024-25',
        dueAmountRs: p.propertyTaxStatus === 'Paid' ? 0 : int(1800, 22000),
        status: p.propertyTaxStatus === 'Paid' ? 'Paid' : p.propertyTaxStatus === 'Due' ? 'Due' : 'Partially Paid',
        locality: LID,
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
          locality: LID,
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
          locality: LID,
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
          issuedBy: cat === 'Survey Report' ? loc.surveyOffice : 'Sub Registrar Office',
          locality: LID,
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
        deviations: b.constructionStatus === 'Under Construction' ? ['Top 2 floors pending completion certificate'] : [],
        locality: LID,
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
        locality: LID,
        isDemo: true,
      })
    }

    // unit-level registration / EC / tax + docs
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
        subRegistrarOffice: loc.subRegistrarOffice,
        natureOfDeed: 'Apartment Sale Deed',
        considerationValueLakh: int(45, 220),
        parties: { seller: `${u.buildingName} Developers (demo)`, buyer: u.owner.name },
        status: u.status === 'Pending' ? 'Pending' : 'Registered',
        locality: LID,
        isDemo: true,
      })
      propertyTax.push({
        taxId: `PT-${u.propertyId}`,
        ulpin: u.ulpin,
        propertyId: u.propertyId,
        buildingId: u.buildingId,
        scope: 'Unit',
        assessmentNumber: `${loc.idTag}/${u.buildingSegment}/${u.apartmentNumber}`,
        annualValueRs: Math.round(u.carpetAreaSqft * int(140, 240)),
        halfYearlyTaxRs: Math.round(u.carpetAreaSqft * int(8, 16)),
        paidUpto: rng() > 0.3 ? 'H1 2025-26' : 'H2 2024-25',
        dueAmountRs: rng() > 0.3 ? 0 : int(1200, 9000),
        status: rng() > 0.3 ? 'Paid' : 'Due',
        locality: LID,
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
          locality: LID,
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
          locality: LID,
          isDemo: true,
        })
      }
    }

    // disputes — a handful, some tied to units/buildings
    const disputedUnits = units.filter((u) => u.status === 'Disputed').slice(0, 4)
    const disputeTypes = ['Ownership', 'Inheritance', 'Encroachment', 'Boundary', 'Tax Assessment']
    disputedUnits.forEach((u, i) => {
      disputes.push({
        disputeId: fid('DSP', pad2(i + 1)),
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
        locality: LID,
        isDemo: true,
      })
    })
    // one parcel-level boundary dispute
    disputes.push({
      disputeId: fid('DSP', '05'),
      scope: 'Parcel',
      ulpin: parcels[3].ulpin,
      type: 'Boundary',
      status: 'Under Mediation',
      filedOn: iso('2023-11-14'),
      court: `Revenue Divisional Officer, ${loc.name} (demo)`,
      parties: [anOwner().name, anOwner().name],
      summary: 'Demo boundary overlap between adjacent parcels pending re-survey.',
      geometry: parcels[3].centroid,
      locality: LID,
      isDemo: true,
    })

    // ---- master plan zones -------------------------------------
    const masterPlans = [
      {
        planId: fid('MP', 'R1'),
        name: 'Chennai Master Plan (Prototype Reference)',
        zoneCode: 'R1',
        zoneName: 'Primary Residential',
        description: 'Primarily residential; apartments permitted within FAR 2.0.',
        geometry: polygon(rectRing(BASE.lon, BASE.lat, 900, 900)),
        locality: LID,
        isDemo: true,
      },
      {
        planId: fid('MP', 'MU'),
        name: 'Chennai Master Plan (Prototype Reference)',
        zoneCode: 'MU',
        zoneName: `Mixed Use Corridor (${loc.name})`,
        description: 'Mixed residential + commercial along the neighbourhood corridor.',
        geometry: polygon(rectRing(BASE.lon + 0.006, BASE.lat, 400, 1400)),
        locality: LID,
        isDemo: true,
      },
    ]

    // ---- utilities (LineStrings along notional roads) ----------
    const utilTypes = ['Water Supply', 'Sewer Line', 'Electricity', 'Drainage', 'Gas Pipeline', 'Fiber Network']
    const utilities = utilTypes.map((t, i) => {
      const yOff = -180 + i * 70
      const [ax, ay] = offsetLonLat(BASE.lon, BASE.lat, -260, yOff)
      const [bx, by] = offsetLonLat(BASE.lon, BASE.lat, 260, yOff + int(-20, 20))
      return {
        utilityId: fid('UTL', pad2(i + 1)),
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
        locality: LID,
        isDemo: true,
      }
    })

    // ---- environment / admin boundary layers ----------------
    const environment = [
      { id: fid('ENV', 'WB-01'), kind: 'Water Body', name: `${loc.name} backwater (demo extent)`, geometry: polygon(rectRing(BASE.lon - 0.004, BASE.lat - 0.004, 260, 120)), locality: LID, isDemo: true },
      { id: fid('ENV', 'ECO-01'), kind: 'Eco Sensitive Zone', name: `${loc.name} marsh buffer (demo)`, geometry: polygon(rectRing(BASE.lon - 0.012, BASE.lat + 0.006, 500, 400)), locality: LID, isDemo: true },
      { id: fid('ENV', 'CRZ-01'), kind: 'Coastal Regulation Zone', name: 'CRZ-II indicative line (demo)', geometry: { type: 'LineString', coordinates: [[BASE.lon + 0.02, BASE.lat - 0.01], [BASE.lon + 0.021, BASE.lat + 0.012]] }, locality: LID, isDemo: true },
      { id: fid('ENV', 'HER-01'), kind: 'Heritage Zone', name: 'None in demo extent', geometry: polygon(rectRing(BASE.lon + 0.03, BASE.lat + 0.03, 60, 60)), locality: LID, isDemo: true },
    ]
    const boundaries = [
      { id: fid('ADM', 'CORP'), level: 'Corporation Boundary', name: 'Greater Chennai Corporation (demo extent)', geometry: polygon(rectRing(BASE.lon, BASE.lat, 1600, 1600)), locality: LID, isDemo: true },
      { id: fid('ADM', 'ZONE'), level: 'Zone Boundary', name: `${loc.zone} (demo extent)`, geometry: polygon(rectRing(BASE.lon, BASE.lat, 1100, 1100)), locality: LID, isDemo: true },
      { id: fid('ADM', 'WARD'), level: 'Ward Boundary', name: `Ward ${loc.wardBase} (demo extent)`, geometry: polygon(rectRing(BASE.lon, BASE.lat, 620, 620)), locality: LID, isDemo: true },
    ]
    const roads = [
      { id: fid('ROAD', 'ART'), name: loc.arterialRoad, class: 'Arterial', geometry: { type: 'LineString', coordinates: [[BASE.lon + 0.0075, BASE.lat - 0.012], [BASE.lon + 0.0085, BASE.lat + 0.013]] }, locality: LID, isDemo: true },
      { id: fid('ROAD', 'INT-1'), name: '4th Cross Street', class: 'Local', geometry: { type: 'LineString', coordinates: [[BASE.lon - 0.0026, BASE.lat - 0.0018], [BASE.lon + 0.0026, BASE.lat - 0.0018]] }, locality: LID, isDemo: true },
      { id: fid('ROAD', 'INT-2'), name: '5th Main Road', class: 'Local', geometry: { type: 'LineString', coordinates: [[BASE.lon - 0.0026, BASE.lat + 0.0016], [BASE.lon + 0.0026, BASE.lat + 0.0016]] }, locality: LID, isDemo: true },
    ]

    // ---- Phase 8 — DEMO underground infrastructure (additive) ------
    // Deterministic synthetic network per locality. Spatial association is
    // computed from the parcels/buildings just built above — geometry facts
    // only, never legal ownership.
    const undergroundInfrastructure = buildLocalityUndergroundInfrastructure(loc, parcels, buildings)

    // ---- Phase 9 — Proposed 3D Property Identifier (additive) ------
    // Research / prototype cross-hierarchy references + geometry version
    // history. Never fabricates an Official ULPIN; one record per locality
    // deliberately has officialULPIN = null.
    const { proposed3DPropertyIdentifiers, geometryVersions } =
      buildLocalityIdentifiers(loc, parcels, buildings, floors, units)

    return {
      parcels, ulpins, landUse, buildings, floors, units, commonAreas,
      registrations, encumbrances, buildingApprovals, propertyTax, disputes,
      documents, masterPlans, utilities, environment, boundaries, roads,
      undergroundInfrastructure,
      proposed3DPropertyIdentifiers, geometryVersions,
    }
  }

  // ---- aggregate every locality -----------------------------------
  const agg = {
    parcels: [], ulpins: [], landUse: [], buildings: [], floors: [], units: [], commonAreas: [],
    registrations: [], encumbrances: [], buildingApprovals: [], propertyTax: [], disputes: [],
    documents: [], masterPlans: [], utilities: [], environment: [], boundaries: [], roads: [],
    undergroundInfrastructure: [],
    proposed3DPropertyIdentifiers: [], geometryVersions: [],
  }
  for (const loc of LOCALITIES) {
    const part = buildLocality(loc)
    for (const key of Object.keys(agg)) agg[key].push(...part[key])
  }

  // ---- service requests + notifications + audit seed -------------
  // These reference the primary demonstration locality (Sholinganallur).
  const primaryLoc = getLocality(DEFAULT_LOCALITY_ID)
  const PU = primaryLoc.ulpinPrimary
  const serviceRequests = [
    {
      requestId: 'SRV-0001',
      type: 'Ownership Verification',
      ulpin: PU,
      propertyId: makeProtoPropertyId(PU, 1, 2, '201'),
      raisedBy: 'citizen01',
      status: 'Officer Review',
      stage: 'Government Officer Review',
      submittedOn: iso('2025-07-02'),
      history: [
        { stage: 'Submitted', at: iso('2025-07-02'), by: 'citizen01', note: 'Ownership verification requested for U201.' },
        { stage: 'Document Verification', at: iso('2025-07-04'), by: 'land01', note: 'Sale deed and EC verified.' },
        { stage: 'Government Officer Review', at: iso('2025-07-06'), by: 'land01', note: 'Pending final sign-off.' },
      ],
      locality: primaryLoc.id,
      isDemo: true,
    },
    {
      requestId: 'SRV-0002',
      type: 'Property Tax Correction',
      ulpin: PU,
      propertyId: makeProtoPropertyId(PU, 2, 5, '503'),
      raisedBy: 'citizen01',
      status: 'Under Verification',
      stage: 'Technical / Zoning Verification',
      submittedOn: iso('2025-08-10'),
      history: [
        { stage: 'Submitted', at: iso('2025-08-10'), by: 'citizen01', note: 'Carpet area mismatch in tax assessment.' },
        { stage: 'Technical / Zoning Verification', at: iso('2025-08-12'), by: 'revenue01', note: 'Re-measurement scheduled.' },
      ],
      locality: primaryLoc.id,
      isDemo: true,
    },
  ]

  const notifications = [
    { notificationId: 'NTF-01', forRole: 'Planning Officer', kind: 'Approval Pending', message: 'B04 – Green Towers: completion certificate pending for top 2 floors.', entityRef: `${PU}-B04`, createdAt: iso('2025-08-20'), read: false },
    { notificationId: 'NTF-02', forRole: 'Land Officer', kind: 'Dispute Created', message: 'New ownership dispute filed against a unit in B01 – Sai Residency.', entityRef: `DSP-${primaryLoc.idTag}-01`, createdAt: iso('2025-08-22'), read: false },
    { notificationId: 'NTF-03', forRole: 'Revenue Officer', kind: 'Tax Due', message: '18 apartment units in the complex have property tax dues for H2 2024-25.', entityRef: PU, createdAt: iso('2025-08-25'), read: false },
    { notificationId: 'NTF-04', forRole: 'Survey Officer', kind: 'Construction Change Detected', message: `AI change-detection flagged possible new construction near ${primaryLoc.parcelPrefix}05.`, entityRef: `${primaryLoc.parcelPrefix}05`, createdAt: iso('2025-08-27'), read: false },
    { notificationId: 'NTF-05', forRole: 'Citizen', kind: 'Verification Completed', message: 'Ownership verification for a requested unit is nearing completion.', entityRef: 'SRV-0001', createdAt: iso('2025-08-28'), read: false },
  ]

  const auditLogs = [
    { logId: 'AUD-0001', user: 'land01', action: 'PARCEL_VERIFIED', entityType: 'Parcel', entityId: PU, at: iso('2025-06-15T10:12:00Z'), before: { status: 'Under Review' }, after: { status: 'Verified' }, ip: '10.0.0.21' },
    { logId: 'AUD-0002', user: 'planning01', action: 'BUILDING_APPROVAL_UPDATED', entityType: 'Building', entityId: `${PU}-B02`, at: iso('2025-06-20T09:03:00Z'), before: { status: 'Under Review' }, after: { status: 'Approved' }, ip: '10.0.0.34' },
    { logId: 'AUD-0003', user: 'land01', action: 'PROPERTY_VERIFIED', entityType: 'PropertyUnit', entityId: makeProtoPropertyId(PU, 1, 2, '201'), at: iso('2025-07-06T14:40:00Z'), before: { status: 'Pending' }, after: { status: 'Verified' }, ip: '10.0.0.21' },
  ]

  // ---------------------------------------------------------------------
  // Coimbatore — official land-record fields for the ONE demonstration
  // property backing the standalone ODM 3D explorer (see
  // frontend/src/lib/constants.js COIMBATORE_DEMO_PROPERTY). Deliberately
  // isolated from the Chennai locality loop above and from every other
  // Chennai building in `agg.buildings`: `officialUlpin` / district / taluk
  // / village / villageLgdCode / surveyNumber / subdivisionNumber are real
  // government land-record identifiers the user supplied for this specific
  // property, so they are NOT stamped `isDemo`. The 3D geometry/height
  // stay a synthetic ODM-derived reconstruction (`heightSource:
  // 'ODM_RECONSTRUCTION'`, `isDemo: true`) — never a surveyed volume, and
  // this record must never be conflated with the Phase 9 Proposed 3D
  // Property Identifier system (`proposed3DPropertyIdentifiers`) or treated
  // as an official government-issued 3D ULPIN.
  const COIMBATORE_CENTROID = { lat: 10.942593, lon: 76.956652 }
  agg.buildings.push({
    buildingId: 'COIMBATORE-DEMO-001',
    ulpin: '72TEYHD9TSKCH0',
    officialUlpin: '72TEYHD9TSKCH0',
    parcelId: 'CBE-61N-11',
    name: 'Coimbatore Kuniyamuthur — Survey 61N/11',
    shortName: 'Kuniyamuthur',
    district: 'Coimbatore',
    districtTamil: 'கோயம்புத்தூர்',
    taluk: 'Perur',
    talukTamil: 'பேரூர்',
    village: 'Kuniamuthur',
    villageTamil: 'குனியமுத்தூர்',
    villageLgdCode: '932292',
    surveyNumber: '61N',
    subdivisionNumber: '11',
    subDivision: '11',
    geometry: polygon(rectRing(COIMBATORE_CENTROID.lon, COIMBATORE_CENTROID.lat, 18, 12)),
    centroid: point(COIMBATORE_CENTROID.lon, COIMBATORE_CENTROID.lat),
    footprintSqm: 216,
    floorsAboveGround: 1,
    groundFloors: 1,
    totalFloors: 1,
    unitCount: 0,
    heightM: 6,
    constructionType: 'RCC',
    approvalStatus: 'Approved',
    constructionStatus: 'Completed',
    locality: 'coimbatore-demo',
    // Height/geometry provenance is derived generically by
    // buildingHeightProvenance() below (no heightSource override here) —
    // this is a synthetic ODM reconstruction, not a LIDAR/SURVEY height, so
    // it correctly falls through to DEMO_PROCEDURAL / UNVERIFIED like every
    // other prototype building volume in this dataset.
    isDemo: true,
  })

  return {
    users,
    owners,
    ulpins: agg.ulpins,
    parcels: agg.parcels,
    buildings: agg.buildings,
    floors: agg.floors,
    propertyUnits: agg.units,
    commonAreas: agg.commonAreas,
    registrations: agg.registrations,
    encumbrances: agg.encumbrances,
    buildingApprovals: agg.buildingApprovals,
    propertyTax: agg.propertyTax,
    landUse: agg.landUse,
    masterPlans: agg.masterPlans,
    utilities: agg.utilities,
    environment: agg.environment,
    boundaries: agg.boundaries,
    roads: agg.roads,
    disputes: agg.disputes,
    documents: agg.documents,
    undergroundInfrastructure: agg.undergroundInfrastructure,
    proposed3DPropertyIdentifiers: agg.proposed3DPropertyIdentifiers,
    geometryVersions: agg.geometryVersions,
    serviceRequests,
    notifications,
    auditLogs,
  }
}

export const SEED_META = {
  region: 'Chennai — multi-locality (Sholinganallur · Adyar · Anna Nagar)',
  base: getLocality(DEFAULT_LOCALITY_ID).base,
  primaryUlpin: getLocality(DEFAULT_LOCALITY_ID).ulpinPrimary,
  defaultLocalityId: DEFAULT_LOCALITY_ID,
  localities: LOCALITIES.map(localityPublic),
  city: CHENNAI_CITY,
  disclaimer:
    'All spatial and record data in this dataset is synthetic DEMO DATA using realistic Chennai coordinates. It represents no real parcel, building, person or government record.',
}
