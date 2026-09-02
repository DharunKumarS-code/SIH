// Serves lightweight placeholder documents for the demo document cards
// (spec §28). No real deeds / certificates — a minimal valid PDF stating that
// this is a prototype placeholder. Never contains personal or sensitive data.

function placeholderPdf(title) {
  const text = `${title}  —  LAND STACK prototype placeholder. Not a real government document.`
  const body = `BT /F1 12 Tf 60 760 Td (${text.replace(/[()\\]/g, ' ')}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

export function demoDocs(req, res) {
  const name = decodeURIComponent(req.path.replace(/^\/demo-docs\//, '').replace(/\.pdf$/i, ''))
  const title = name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Demo Document'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${name || 'demo'}.pdf"`)
  res.send(placeholderPdf(title))
}
