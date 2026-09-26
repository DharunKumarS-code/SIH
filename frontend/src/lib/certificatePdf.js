// Renders a CertificateData object (see lib/certificate.js) into a downloadable
// landscape Smart Property Card PDF, preserving the same 1.59:1 proportions as
// the on-screen preview (components/certificate/PropertyCertificateModal.jsx).
// Text/shapes are drawn with jsPDF's vector primitives (crisp, selectable);
// the boundary footprint and 3D volume glyph are rasterised once from the
// same shared drawing code the on-screen preview uses (lib/boundaryMap.js /
// lib/volumeGlyph.js) and embedded as PNGs, exactly like the previous
// portrait certificate did for its boundary map.

import { jsPDF } from 'jspdf'
import { NA, cardStatusWord, cardStatusLabel } from './certificate.js'
import { boundaryToDataUrl } from './boundaryMap.js'
import { volumeGlyphOf, volumeGlyphToDataUrl } from './volumeGlyph.js'

// Custom landscape sheet, exactly 1.59:1 — matches the on-screen card
// (1590x1000 px) instead of falling back to a portrait A4 certificate.
const RATIO = 1.59
const PAGE_W = 280
const PAGE_H = +(PAGE_W / RATIO).toFixed(2) // 176.10 mm
const MARGIN = 8
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = [30, 41, 59] // slate-800
const MUTED = [100, 116, 139] // slate-500
const RULE = [226, 232, 240] // slate-200
const BRASS = [150, 106, 27] // brass — reserved for official / seal marks
const TEAL = [15, 118, 110] // "verified" / 3D accent
const NAVY = [15, 23, 42] // header/footer band

const FOOTER_TEXT =
  'This Smart Property Card is a system-generated prototype record within Chennai 3D Cadastre. It is not an official ' +
  'government certificate or government-issued digital identity.'

function fmtDate(iso) {
  if (!iso) return NA
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** One label/value row, compact enough for the dense landscape columns. */
function row(doc, x, y, w, label, value, mono) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.6)
  doc.setTextColor(...MUTED)
  doc.text(label, x, y)
  doc.setFont(mono ? 'courier' : 'helvetica', 'bold')
  doc.setFontSize(6.8)
  doc.setTextColor(...INK)
  const val = value === null || value === undefined || value === '' ? NA : String(value)
  const lines = doc.splitTextToSize(val, w)
  doc.text(lines, x + w, y, { align: 'right' })
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.1)
  doc.line(x, y + 1, x + w, y + 1)
  return y + 3.6 * Math.max(1, lines.length)
}

function panelHeader(doc, x, y, w, title, color = MUTED) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.4)
  doc.setTextColor(...color)
  doc.text(title.toUpperCase(), x, y)
  return y + 3.2
}

function panelFrame(doc, x, y, w, h) {
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.15)
  doc.roundedRect(x, y, w, h, 0.8, 0.8)
}

function note(doc, x, y, w, str, color = MUTED) {
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(5.6)
  doc.setTextColor(...color)
  const lines = doc.splitTextToSize(str, w)
  doc.text(lines, x, y)
  return y + lines.length * 2.6
}

function drawHeader(doc, data, qrDataUrl) {
  const h = 17
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, h, 'F')

  doc.setTextColor(200, 210, 225)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.2)
  doc.text('CHENNAI 3D CADASTRE', MARGIN, 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.6)
  doc.text('3D Property Mapping Platform', MARGIN, 10.5)

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.text('SMART PROPERTY CARD', PAGE_W / 2, 8, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.4)
  doc.setTextColor(190, 200, 216)
  doc.text('Unified 3D property record from parcel to unit', PAGE_W / 2, 12.2, { align: 'center' })

  const badgeRight = PAGE_W - MARGIN - (qrDataUrl ? 15 : 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.4)
  doc.setTextColor(252, 211, 77)
  doc.text('SYSTEM-GENERATED PROTOTYPE', badgeRight, 5.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5)
  doc.setTextColor(190, 200, 216)
  const disc = doc.splitTextToSize('Not an official government certificate or government-issued digital identity.', 62)
  doc.text(disc, badgeRight, 8.2, { align: 'right' })

  if (qrDataUrl) {
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(PAGE_W - MARGIN - 13, 2, 13, 13, 0.6, 0.6, 'F')
    doc.addImage(qrDataUrl, 'PNG', PAGE_W - MARGIN - 12, 3, 11, 11)
  }
  return h
}

function drawHierarchyRail(doc, data, y) {
  const railH = 9
  doc.setFillColor(248, 250, 252)
  doc.rect(0, y, PAGE_W, railH, 'F')
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.15)
  doc.line(0, y + railH, PAGE_W, y + railH)

  const chain = data.hierarchyChain || []
  const stepW = CONTENT_W / chain.length
  chain.forEach((s, i) => {
    const x = MARGIN + i * stepW
    const reached = Boolean(s.id)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.2)
    doc.setTextColor(...(reached ? MUTED : [180, 186, 196]))
    doc.text(s.label.toUpperCase(), x + 1.5, y + 3.4)
    doc.setFont('courier', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(...(reached ? INK : [190, 196, 205]))
    doc.text(String(s.id || NA), x + 1.5, y + 7)
    if (i < chain.length - 1) {
      doc.setDrawColor(...RULE)
      doc.line(x + stepW - 1, y + 2, x + stepW - 1, y + railH - 2)
    }
  })
  return y + railH
}

async function generateVolumeGlyphDataUrl(data) {
  const glyph = volumeGlyphOf(data)
  return volumeGlyphToDataUrl(glyph, { width: 606, height: 400 })
}

export async function generateCertificatePdf(data, qrDataUrl) {
  // orientation MUST be explicit — jsPDF defaults to portrait and silently
  // swaps a landscape [w, h] format array back to [h, w] otherwise.
  const doc = new jsPDF({ unit: 'mm', orientation: 'l', format: [PAGE_W, PAGE_H] })
  const t = data.threeD || {}

  let y = drawHeader(doc, data, qrDataUrl)
  y = drawHierarchyRail(doc, data, y)

  const gap = 2
  const col1X = MARGIN
  const col1W = 70
  const col2X = col1X + col1W + gap
  const col2W = 116
  const col3X = col2X + col2W + gap
  const col3W = CONTENT_W - col1W - col2W - gap * 2
  const mainY = y + 2
  const mainH = 108

  // ------------------------------------------------------------- Column 1
  let cy = mainY
  const idH = 40
  panelFrame(doc, col1X, cy, col1W, idH)
  let iy = panelHeader(doc, col1X + 2, cy + 3.4, col1W - 4, 'Property Identity', BRASS)
  iy = row(doc, col1X + 2, iy, col1W - 4, 'ULPIN', data.identity.ulpin, true)
  iy = row(doc, col1X + 2, iy, col1W - 4, 'ULPIN Status', data.identity.ulpinKind)
  if (data.kind !== 'parcel') {
    doc.setFillColor(240, 253, 250)
    doc.setDrawColor(153, 246, 228)
    doc.roundedRect(col1X + 2, iy, col1W - 4, 7, 0.6, 0.6, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.6)
    doc.setTextColor(...TEAL)
    doc.text('3D ULPIN', col1X + 3, iy + 2.6)
    doc.setFont('courier', 'bold')
    doc.setFontSize(7)
    doc.text(String(t.threeDUlpin || NA), col1X + col1W - 3, iy + 3, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(4.4)
    doc.text('SYSTEM GENERATED · NOT OFFICIAL GOVERNMENT ID', col1X + 3, iy + 5.8)
    iy += 8.5
  }
  iy = row(doc, col1X + 2, iy, col1W - 4, 'Property Name', data.title)
  iy = row(doc, col1X + 2, iy, col1W - 4, 'Property Type', data.parcel.propertyType)
  iy = row(doc, col1X + 2, iy, col1W - 4, 'Unit Number', data.kind === 'unit' ? data.identity.recordId : NA, true)
  row(doc, col1X + 2, iy, col1W - 4, 'Record Status', data.owner.ownershipStatus)

  cy = mainY + idH + gap
  const surveyH = mainH - idH - gap
  panelFrame(doc, col1X, cy, col1W, surveyH)
  let sy = panelHeader(doc, col1X + 2, cy + 3.4, col1W - 4, 'Land & Survey Details')
  sy = row(doc, col1X + 2, sy, col1W - 4, 'Survey Number', data.parcel.surveyNumber, true)
  sy = row(doc, col1X + 2, sy, col1W - 4, 'Subdivision No.', data.parcel.subdivisionNumber, true)
  sy = row(doc, col1X + 2, sy, col1W - 4, 'Village / Locality', data.parcel.village)
  sy = row(doc, col1X + 2, sy, col1W - 4, 'Taluk', data.parcel.taluk)
  sy = row(doc, col1X + 2, sy, col1W - 4, 'District', data.parcel.district)
  sy = row(doc, col1X + 2, sy, col1W - 4, 'State', NA)
  row(
    doc, col1X + 2, sy, col1W - 4, 'Parcel Area',
    data.parcel.areaSqft != null ? `${data.parcel.areaSqft.toLocaleString('en-IN')} sq.ft` : NA,
  )

  // ------------------------------------------------------------- Column 2 (emphasis)
  doc.setDrawColor(...([144, 173, 210]))
  doc.setLineWidth(0.25)
  doc.roundedRect(col2X, mainY, col2W, mainH, 1, 1)
  let vy = panelHeader(doc, col2X + 2, mainY + 3.6, col2W - 4, '3D Property Visualization', [20, 67, 130])

  const glyphDataUrl = await generateVolumeGlyphDataUrl(data)
  const glyphH = 66
  doc.addImage(glyphDataUrl, 'PNG', col2X + 2, vy, col2W - 4, glyphH)
  doc.setDrawColor(...RULE)
  doc.rect(col2X + 2, vy, col2W - 4, glyphH)
  vy += glyphH + 3
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.4)
  doc.setTextColor(20, 67, 130)
  const caption =
    data.kind === 'unit' ? `UNIT ${t.unitId || data.identity.recordId || ''} · 3D VOLUME`.trim()
      : data.kind === 'building' ? `BUILDING ${t.buildingId || ''} · MASSING`.trim()
        : `PARCEL · ${Number.isFinite(t.buildingCount) ? `${t.buildingCount} BUILDING(S) ON RECORD` : 'NO 3D VOLUME LINKED'}`
  doc.text(caption, col2X + col2W / 2, vy, { align: 'center' })
  vy += 3.5

  const mapW = (col2W - 4 - 2) / 2
  const mapDataUrl = boundaryToDataUrl(data.spatial.boundary?.ring || null, { width: mapW * 8, height: 20 * 8 })
  doc.addImage(mapDataUrl, 'PNG', col2X + 2, vy, mapW, 20)
  doc.setDrawColor(...RULE)
  doc.rect(col2X + 2, vy, mapW, 20)
  const statsX = col2X + 2 + mapW + 2
  let sty = vy + 3
  sty = row(doc, statsX, sty, mapW, 'Height', t.buildingHeightM != null ? `${t.buildingHeightM} m` : NA, true)
  sty = row(doc, statsX, sty, mapW, 'Volume', t.estVolumeM3 != null ? `${t.estVolumeM3} m³` : NA, true)
  row(doc, statsX, sty, mapW, 'Geometry', t.geometryStatus)

  // ------------------------------------------------------------- Column 3
  const col3H1 = 34
  panelFrame(doc, col3X, mainY, col3W, col3H1)
  let py = panelHeader(doc, col3X + 2, mainY + 3.4, col3W - 4, 'Spatial Information', [20, 67, 130])
  py = row(doc, col3X + 2, py, col3W - 4, 'Latitude', data.spatial.centroid ? data.spatial.centroid.lat.toFixed(6) : NA, true)
  py = row(doc, col3X + 2, py, col3W - 4, 'Longitude', data.spatial.centroid ? data.spatial.centroid.lon.toFixed(6) : NA, true)
  py = row(doc, col3X + 2, py, col3W - 4, 'CRS', data.spatial.crs || NA, true)
  row(
    doc, col3X + 2, py, col3W - 4, 'X/Y/Z Bounds',
    t.bounds ? `${t.bounds.xmin?.toFixed?.(3)}…${t.bounds.xmax?.toFixed?.(3)}` : NA,
    true,
  )

  const udsY = mainY + col3H1 + gap
  const udsH = 26
  panelFrame(doc, col3X, udsY, col3W, udsH)
  let uy = panelHeader(doc, col3X + 2, udsY + 3.4, col3W - 4, 'Undivided Share of Land (UDS)', BRASS)
  uy = row(doc, col3X + 2, uy, col3W - 4, 'Ownership Share', data.uds.available ? `${data.uds.sharePct}%` : NA, true)
  uy = row(doc, col3X + 2, uy, col3W - 4, 'Assoc. Parcel', data.uds.associatedParcel, true)
  note(doc, col3X + 2, uy + 1.5, col3W - 4, data.uds.note)

  const verY = udsY + udsH + gap
  const verH = mainH - col3H1 - udsH - gap * 2
  panelFrame(doc, col3X, verY, col3W, verH)
  let wy = panelHeader(doc, col3X + 2, verY + 3.4, col3W - 4, 'Verification', TEAL)
  wy = row(doc, col3X + 2, wy, col3W - 4, 'Status', cardStatusLabel(data.identity.verificationStatus, data.identity.verificationLabel))
  wy = row(doc, col3X + 2, wy, col3W - 4, 'Reviewed By', NA)
  wy = row(doc, col3X + 2, wy, col3W - 4, 'Review Date', NA)
  note(doc, col3X + 2, wy + 1.5, col3W - 4, data.provenance.disclaimer || data.legal.remarks || NA)

  // --------------------------------------------------------------- Bottom row
  const bottomY = mainY + mainH + gap
  const bottomH = PAGE_H - bottomY - 9
  const bw = (CONTENT_W - gap * 2) / 3

  panelFrame(doc, MARGIN, bottomY, bw, bottomH)
  let oy = panelHeader(doc, MARGIN + 2, bottomY + 3.2, bw - 4, 'Owner Information')
  if (data.owner.current.length > 0) {
    data.owner.current.slice(0, 2).forEach((o, i) => {
      oy = row(
        doc, MARGIN + 2, oy, bw - 4, i === 0 ? 'Current Owner(s)' : '',
        [o.name, o.sharePct != null ? `${o.sharePct}%` : null].filter(Boolean).join(' — '),
      )
    })
  } else {
    oy = row(doc, MARGIN + 2, oy, bw - 4, 'Current Owner(s)', NA)
  }
  oy = row(doc, MARGIN + 2, oy, bw - 4, 'Mutation Date', data.owner.mutationDate ? fmtDate(data.owner.mutationDate) : NA)
  note(doc, MARGIN + 2, oy + 1.5, bw - 4, 'Owner contact information is not exposed on this card. Prototype — synthetic names only.')

  const col2bX = MARGIN + bw + gap
  panelFrame(doc, col2bX, bottomY, bw, bottomH)
  let py2 = panelHeader(doc, col2bX + 2, bottomY + 3.2, bw - 4, 'Data Provenance')
  py2 = row(doc, col2bX + 2, py2, bw - 4, 'Source', data.provenance.source)
  py2 = row(doc, col2bX + 2, py2, bw - 4, 'Verification', cardStatusWord(data.provenance.verificationStatus))
  py2 = row(doc, col2bX + 2, py2, bw - 4, 'Generated', fmtDate(data.generatedAtISO))
  if (data.generatedByLine) row(doc, col2bX + 2, py2, bw - 4, 'Generated By', data.generatedByLine)

  const col3bX = col2bX + bw + gap
  panelFrame(doc, col3bX, bottomY, bw, bottomH)
  let ay = panelHeader(doc, col3bX + 2, bottomY + 3.2, bw - 4, 'Download & Access', [20, 67, 130])
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5.6)
  doc.setTextColor(...MUTED)
  ay += 1
  doc.text('This landscape PDF is the downloadable form of the on-screen', col3bX + 2, ay)
  ay += 2.6
  doc.text('Smart Property Card preview.', col3bX + 2, ay)
  ay += 3.4
  doc.setFont('courier', 'normal')
  doc.setFontSize(5.2)
  const urlLines = doc.splitTextToSize(data.qrUrl, bw - 4)
  doc.text(urlLines, col3bX + 2, ay)

  // ------------------------------------------------------------------ Footer
  const footerY = PAGE_H - 8
  doc.setFillColor(...NAVY)
  doc.rect(0, footerY, PAGE_W, PAGE_H - footerY, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5)
  doc.setTextColor(210, 216, 226)
  const footLines = doc.splitTextToSize(FOOTER_TEXT, CONTENT_W - 46)
  doc.text(footLines, MARGIN, footerY + 3)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5)
  doc.text(`Generated ${fmtDate(data.generatedAtISO)}`, PAGE_W - MARGIN, footerY + 3, { align: 'right' })
  doc.setFont('courier', 'normal')
  doc.text(String(data.identity.recordId || NA), PAGE_W - MARGIN, footerY + 6, { align: 'right' })

  const filenameSafe = (data.identity.recordId || data.title || 'property-card').replace(/[^A-Za-z0-9._-]+/g, '_')
  doc.save(`Smart-Property-Card-${filenameSafe}.pdf`)
}
