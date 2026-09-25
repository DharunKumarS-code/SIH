import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { X, Download, ShieldAlert, Landmark } from 'lucide-react'
import QRCode from 'qrcode'
import { DemoTag } from '../ui/primitives.jsx'
import { NA } from '../../lib/certificate.js'
import { generateCertificatePdf } from '../../lib/certificatePdf.js'
import { CertificateBoundaryMap } from './CertificateBoundaryMap.jsx'
import { dateShort } from '../../lib/format.js'

function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1 text-[12px] last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={clsx('text-right font-medium text-slate-900 break-words', mono && 'data-mono')}>
        {value === null || value === undefined || value === '' ? NA : String(value)}
      </span>
    </div>
  )
}

function CertSection({ n, title, children }) {
  return (
    <section className="rounded-md border border-slate-200 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-700 text-[9px] font-bold text-white">{n}</span>
        {title}
      </p>
      {children}
    </section>
  )
}

function verificationTone(status) {
  if (status === 'OFFICIAL') return 'border-brass/30 bg-brass/10 text-brass'
  if (status === 'AI_DEMO') return 'border-purple-300 bg-purple-50 text-purple-700'
  if (status === 'UNAVAILABLE') return 'border-slate-300 bg-slate-100 text-slate-600'
  return 'border-warn/30 bg-warn/10 text-warn' // DEMO / UNVERIFIED
}

// Full-screen certificate preview + "Download Certificate (PDF)" action.
// `data` is a CertificateData object built by lib/certificate.js from
// whatever the sidebar card that opened this already has loaded — no new API
// calls are made here.
export function PropertyCertificateModal({ data, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(data.qrUrl, { margin: 1, width: 240 })
      .then((url) => alive && setQrDataUrl(url))
      .catch(() => alive && setQrDataUrl(null))
    return () => {
      alive = false
    }
  }, [data.qrUrl])

  const download = async () => {
    setBusy(true)
    try {
      await generateCertificatePdf(data, qrDataUrl)
    } finally {
      setBusy(false)
    }
  }

  const t = data.threeD || {}
  const hasThreeD = data.kind !== 'parcel' || t.buildingCount != null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-8" data-testid="certificate-modal">
      {/* doc-light: this is a preview of a printable/exportable document (the
          PDF is always rendered on white paper), so it stays on fixed light
          tokens regardless of the app-wide theme — matching what
          "Download Certificate (PDF)" actually produces. */}
      <div className="doc-light w-full max-w-2xl rounded-lg bg-surface shadow-2xl">
        {/* Toolbar — not part of the printed certificate itself */}
        <div className="flex items-center justify-between gap-2 rounded-t-lg border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <p className="font-display text-sm font-semibold text-slate-800">Certificate Preview</p>
          <div className="flex items-center gap-2">
            <button
              className="btn-primary"
              onClick={download}
              disabled={busy}
              data-testid="download-certificate-pdf"
            >
              <Download size={14} /> {busy ? 'Preparing…' : 'Download Certificate (PDF)'}
            </button>
            <button className="btn-ghost !px-2" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Certificate content */}
        <div className="space-y-3 p-5" data-testid="certificate-body">
          <header className="flex items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-slate-800 text-white">
                <Landmark size={20} />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Chennai 3D Cadastre · Prototype
                </p>
                <h1 className="font-display text-lg font-semibold tracking-tight text-slate-900">3D Property Certificate</h1>
                <p className="text-[11px] text-slate-500">Land &amp; Property Information | 3D Cadastre Prototype</p>
              </div>
            </div>
            <div className="text-right">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${verificationTone(data.identity.verificationStatus)}`}
              >
                {data.identity.verificationLabel}
              </span>
              <p className="mt-1 text-[10px] text-slate-500">Generated {dateShort(data.generatedAtISO)}</p>
            </div>
          </header>

          <div className="flex items-start gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong>Prototype.</strong> This certificate is generated by the 3D ULPIN prototype and does not
              constitute an official government land title or certificate.
            </span>
          </div>

          <CertSection n={1} title="Property Identity">
            <Row label="ULPIN" value={data.identity.ulpin} mono />
            <Row label="ULPIN Kind" value={data.identity.ulpinKind} />
            <Row label="Verification Status" value={data.identity.verificationLabel} />
            <Row label="Data Source" value={data.identity.dataSource} />
            <Row label="Record / Reference ID" value={data.identity.recordId} mono />
            {data.identity.note && <p className="mt-1.5 text-[10px] text-slate-500">{data.identity.note}</p>}
          </CertSection>

          <CertSection n={2} title="Owner Information">
            {data.owner.current.length > 0 ? (
              data.owner.current.map((o, i) => (
                <Row key={i} label={i === 0 ? 'Current Owner(s)' : ''} value={[o.name, o.sharePct != null ? `${o.sharePct}%` : null].filter(Boolean).join(' — ')} />
              ))
            ) : (
              <Row label="Current Owner(s)" value={NA} />
            )}
            <Row label="Ownership Status" value={data.owner.ownershipStatus} />
            <Row label="Previous Holder(s)" value={data.owner.previousHolders?.length ? data.owner.previousHolders.join(', ') : NA} />
            <Row label="Mutation / Transfer Date" value={data.owner.mutationDate ? dateShort(data.owner.mutationDate) : NA} />
            <p className="mt-1.5 text-[10px] text-slate-500">
              Owner contact information is not exposed on this certificate. <DemoTag label="PROTOTYPE" /> Synthetic
              names only — no real personal information.
            </p>
          </CertSection>

          <CertSection n={3} title="Parcel Information">
            <Row label="Survey Number" value={data.parcel.surveyNumber} mono />
            <Row label="Subdivision Number" value={data.parcel.subdivisionNumber} mono />
            <Row
              label="Area"
              value={data.parcel.areaSqft != null ? `${data.parcel.areaSqft.toLocaleString('en-IN')} sq.ft${data.parcel.areaSqm != null ? ` (${data.parcel.areaSqm.toLocaleString('en-IN')} m²)` : ''}` : NA}
            />
            <Row label="Land Use" value={data.parcel.landUse} />
            <Row label="Property Type" value={data.parcel.propertyType} />
            <Row label="District" value={data.parcel.district} />
            <Row label="Taluk" value={data.parcel.taluk} />
            <Row label="Village / Locality" value={data.parcel.village} />
          </CertSection>

          <CertSection n={4} title="Spatial Information">
            <Row label="Centroid Latitude" value={data.spatial.centroid ? data.spatial.centroid.lat.toFixed(6) : NA} mono />
            <Row label="Centroid Longitude" value={data.spatial.centroid ? data.spatial.centroid.lon.toFixed(6) : NA} mono />
            <Row label="CRS" value={data.spatial.crs || NA} />
            <p className="mt-1 text-[10px] text-slate-500">
              ULPIN is the parcel identifier — its characters are not latitude/longitude. Coordinates above are separate,
              supporting spatial information.
            </p>
            <div className="mt-2">
              <CertificateBoundaryMap boundary={data.spatial.boundary} />
              {data.spatial.isDemoCoordinates && (
                <p className="mt-1 text-[10px] text-warn">Prototype coordinates — not a surveyed position.</p>
              )}
            </div>
          </CertSection>

          <CertSection n={5} title="Registration / Legal-Status Information">
            <Row label="Registration Reference" value={data.legal.registrationRef} />
            <Row label="Encumbrance Status" value={data.legal.encumbranceStatus} />
            <Row label="Land Restriction / Remarks" value={data.legal.remarks} />
            <Row label="Court / Litigation Status" value={data.legal.litigationStatus} />
          </CertSection>

          <CertSection n={6} title="3D Property Information">
            {hasThreeD && data.kind === 'parcel' && (
              <>
                <Row label="Buildings on Parcel" value={data.threeD.buildingCount} />
                <Row label="Floors (rollup)" value={data.threeD.floorCount} />
                <Row label="Units (rollup)" value={data.threeD.unitCount} />
              </>
            )}
            {data.kind !== 'parcel' && (
              <>
                {t.threeDUlpin && (
                  <div className="mb-1.5 flex items-center justify-between gap-3 rounded-md border border-teal/30 bg-teal/10 px-2 py-1.5">
                    <span className="text-[11px] font-semibold text-teal">3D ULPIN</span>
                    <span className="data-mono text-[13px] font-bold text-teal">{t.threeDUlpin}</span>
                  </div>
                )}
                <Row label="Building ID" value={t.buildingId} mono />
                {data.kind === 'unit' && <Row label="Floor ID" value={t.floorId} mono />}
                {data.kind === 'unit' && <Row label="Unit ID" value={t.unitId} mono />}
                {data.kind === 'building' && <Row label="Number of Floors" value={t.totalFloors} />}
                {data.kind === 'building' && <Row label="Number of Units" value={t.totalUnits} />}
                <Row label="Building Height" value={t.buildingHeightM != null ? `${t.buildingHeightM} m` : NA} />
                <Row label="3D Volume ID" value={t.volumeId} mono />
                <Row
                  label="X/Y/Z Bounds"
                  mono
                  value={
                    t.bounds
                      ? `X ${t.bounds.xmin?.toFixed?.(6)}…${t.bounds.xmax?.toFixed?.(6)}, Y ${t.bounds.ymin?.toFixed?.(6)}…${t.bounds.ymax?.toFixed?.(6)}, Z ${t.bounds.zmin ?? '—'}…${t.bounds.zmax ?? '—'}`
                      : NA
                  }
                />
                <Row label="Estimated Volume" value={t.estVolumeM3 != null ? `${t.estVolumeM3} m³` : NA} />
                <Row label="Geometry Status" value={t.geometryStatus} />
              </>
            )}
            <p className="mt-1.5 text-[10px] text-slate-500">
              3D ULPIN, Building ID, Floor ID, Unit ID and Volume ID are system-generated / prototype identifiers —
              never an official government ULPIN.
            </p>
          </CertSection>

          <CertSection n={7} title="Data Provenance">
            <Row label="Source" value={data.provenance.source} />
            <Row label="Verification Status" value={data.provenance.verificationStatus} />
            <Row label="Generated Date" value={dateShort(data.generatedAtISO)} />
            <Row label="Record Version / Timestamp" value={data.provenance.recordVersion ?? data.generatedAtISO} />
            {data.generatedByLine && <Row label="Generated By" value={data.generatedByLine} />}
            {data.provenance.disclaimer && (
              <p className="mt-1.5 text-[10px] text-warn">{data.provenance.disclaimer}</p>
            )}
          </CertSection>

          <CertSection n={8} title="QR Code">
            <div className="flex items-center gap-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Deep link QR code" width={96} height={96} className="rounded border border-slate-200" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded border border-slate-200 text-[10px] text-slate-400">
                  Generating…
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500">Scan to open this property in the application:</p>
                <p className="mt-0.5 break-all font-mono text-[10px] text-slate-600">{data.qrUrl}</p>
              </div>
            </div>
          </CertSection>

          <footer className="border-t border-slate-200 pt-3 text-center text-[10px] leading-relaxed text-slate-500">
            This certificate is generated by the 3D ULPIN prototype and does not constitute an official government land
            title/certificate unless explicitly issued by the competent authority.
            <br />
            Page 1
          </footer>
        </div>
      </div>
    </div>
  )
}
