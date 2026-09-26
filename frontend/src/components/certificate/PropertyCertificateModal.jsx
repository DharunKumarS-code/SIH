import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { X, Download, ShieldAlert, Landmark, MapPin, LandPlot, Building2, Layers, Home, Box as BoxIcon, ChevronRight, ExternalLink } from 'lucide-react'
import QRCode from 'qrcode'
import { NA, cardStatusWord, cardStatusLabel } from '../../lib/certificate.js'
import { generateCertificatePdf } from '../../lib/certificatePdf.js'
import { CertificateBoundaryMap } from './CertificateBoundaryMap.jsx'
import { PropertyVolumeGlyph } from './PropertyVolumeGlyph.jsx'
import { volumeGlyphOf } from '../../lib/volumeGlyph.js'
import { dateShort } from '../../lib/format.js'

// The Smart Property Card is a fixed 1590x1000 (1.59:1) landscape composition,
// scaled down to fit whatever viewport it's shown in — never reflowed into a
// portrait stack. See useCardScale() below.
const CARD_W = 1590
const CARD_H = 1000

function useCardScale(minScale = 0.22) {
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (!width || !height) return
      setScale(Math.max(minScale, Math.min(width / CARD_W, height / CARD_H, 1)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [minScale])

  return [wrapRef, scale]
}

function verificationTone(status) {
  if (status === 'OFFICIAL') return 'border-brass/40 bg-brass/10 text-brass'
  if (status === 'AI_DEMO') return 'border-purple-300 bg-purple-50 text-purple-700'
  if (status === 'UNAVAILABLE') return 'border-slate-300 bg-slate-100 text-slate-600'
  return 'border-warn/40 bg-warn/10 text-warn' // DEMO / UNVERIFIED
}

function Field({ label, value, mono, className }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-2 border-b border-slate-100 py-[3px] text-[11px] last:border-0', className)}>
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={clsx('min-w-0 truncate text-right font-semibold text-slate-900', mono && 'data-mono')} title={value == null ? undefined : String(value)}>
        {value === null || value === undefined || value === '' ? NA : String(value)}
      </span>
    </div>
  )
}

function Panel({ title, accent, className, children, dense }) {
  return (
    <section className={clsx('flex min-w-0 flex-col rounded-[4px] border border-slate-200 bg-white', dense ? 'p-2.5' : 'p-3', className)}>
      <p
        className={clsx(
          'mb-1.5 shrink-0 text-[10px] font-extrabold uppercase tracking-[0.08em]',
          accent || 'text-slate-500',
        )}
      >
        {title}
      </p>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  )
}

const HIERARCHY_ICONS = {
  ulpin: MapPin,
  parcel: LandPlot,
  building: Building2,
  floor: Layers,
  unit: Home,
  volume: BoxIcon,
}

function HierarchyRail({ chain, activeKey }) {
  return (
    <div className="flex h-full items-center gap-1 overflow-x-auto px-4">
      {chain.map((s, i) => {
        const Icon = HIERARCHY_ICONS[s.key] || MapPin
        const reached = Boolean(s.id)
        const active = s.key === activeKey
        return (
          <div key={s.key} className="flex shrink-0 items-center gap-1">
            <div
              className={clsx(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
                active
                  ? 'border-teal/50 bg-teal/10'
                  : reached
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-slate-200 bg-slate-50 opacity-60',
              )}
            >
              <Icon size={13} className={active ? 'text-teal' : reached ? 'text-primary' : 'text-slate-400'} />
              <div className="leading-tight">
                <div className="text-[8.5px] font-bold uppercase tracking-wide text-slate-500">{s.label}</div>
                <div className={clsx('data-mono text-[10.5px] font-bold', reached ? 'text-slate-900' : 'text-slate-400')}>
                  {s.id ? String(s.id) : NA}
                </div>
              </div>
            </div>
            {i < chain.length - 1 && <ChevronRight size={13} className="shrink-0 text-slate-300" />}
          </div>
        )
      })}
    </div>
  )
}

function volumeCaption(data) {
  const t = data.threeD || {}
  if (data.kind === 'unit') return `UNIT ${t.unitId || data.identity.recordId || ''} · 3D VOLUME`.trim()
  if (data.kind === 'building') return `BUILDING ${t.buildingId || ''} · MASSING`.trim()
  return `PARCEL · ${Number.isFinite(t.buildingCount) ? `${t.buildingCount} BUILDING(S) ON RECORD` : 'NO 3D VOLUME LINKED'}`
}

// Full-screen preview + "Download Smart Property Card (PDF)" action for the
// unified parcel/building/unit property record. `data` is a CertificateData
// object built by lib/certificate.js from whatever the sidebar card that
// opened this already has loaded — no new API calls are made here.
export function PropertyCertificateModal({ data, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [wrapRef, scale] = useCardScale()

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
  const glyph = useMemo(() => volumeGlyphOf(data), [data])
  const activeStageKey = data.kind === 'unit' ? 'unit' : data.kind === 'building' ? 'building' : 'parcel'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" data-testid="certificate-modal">
      {/* Toolbar — not part of the card itself */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
        <p className="font-display text-sm font-semibold text-white">Smart Property Card — Preview</p>
        <div className="flex items-center gap-2">
          <a
            href={data.qrUrl}
            className="btn-ghost !border-slate-600 !text-slate-200 hover:!bg-slate-800"
            title="View full property record in the map"
          >
            <ExternalLink size={14} /> View Full Property Card
          </a>
          <button className="btn-primary" onClick={download} disabled={busy} data-testid="download-certificate-pdf">
            <Download size={14} /> {busy ? 'Preparing…' : 'Download Smart Property Card (PDF)'}
          </button>
          <button className="btn-ghost !px-2 !border-slate-600 !text-slate-200 hover:!bg-slate-800" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Scaled 1.59:1 landscape card */}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
          {/* doc-light: the card is a preview of a printable/exportable document
              (the PDF is always rendered on ivory paper), so it stays on fixed
              light tokens regardless of the app-wide theme. */}
          <div
            className="doc-light origin-top-left overflow-hidden rounded-[6px] shadow-2xl"
            style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, background: '#fbf9f4' }}
            data-testid="certificate-body"
          >
            {/* ---------------------------------------------------------- HEADER */}
            <header className="flex h-[100px] shrink-0 items-center justify-between gap-4 bg-slate-900 px-6 text-white">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded bg-white/10 text-white">
                  <Landmark size={22} />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Chennai 3D Cadastre</p>
                  <p className="text-[13px] font-semibold text-slate-100">3D Property Mapping Platform</p>
                </div>
              </div>

              <div className="text-center">
                <h1 className="font-display text-[22px] font-bold tracking-tight text-white">SMART PROPERTY CARD</h1>
                <p className="text-[11px] text-slate-400">Unified 3D property record from parcel to unit</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold tracking-wide text-amber-300">
                    SYSTEM-GENERATED PROTOTYPE
                  </span>
                  <p className="mt-1 max-w-[220px] text-[9px] leading-tight text-slate-400">
                    Not an official government certificate or government-issued digital identity.
                  </p>
                </div>
                <div className="grid h-[62px] w-[62px] shrink-0 place-items-center rounded bg-white p-1">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="Deep link QR code" className="h-full w-full" />
                  ) : (
                    <span className="text-[8px] text-slate-400">QR…</span>
                  )}
                </div>
              </div>
            </header>

            {/* ------------------------------------------------------ HIERARCHY RAIL */}
            <div className="flex h-[62px] shrink-0 items-center border-b border-slate-200 bg-slate-50">
              <HierarchyRail chain={data.hierarchyChain || []} activeKey={activeStageKey} />
            </div>

            {/* ------------------------------------------------------------ MAIN GRID */}
            <div className="grid h-[598px] shrink-0 grid-cols-[420px_654px_450px] gap-3 px-4 py-3">
              {/* Column 1 */}
              <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr] gap-3">
                <Panel title="Property Identity" accent="text-brass">
                  <Field label="ULPIN" value={data.identity.ulpin} mono />
                  <Field
                    label="ULPIN Status"
                    value={data.identity.ulpinKind}
                    className={data.identity.isOfficial ? 'text-brass' : undefined}
                  />
                  {data.kind !== 'parcel' && (
                    <div className="my-1.5 rounded border border-teal/30 bg-teal/10 px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-teal">3D ULPIN</span>
                        <span className="data-mono text-[13px] font-extrabold text-teal">{t.threeDUlpin || NA}</span>
                      </div>
                      <p className="mt-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-teal/70">
                        System Generated · Not Official Government ID
                      </p>
                    </div>
                  )}
                  <Field label="Property Name" value={data.title} />
                  <Field label="Property Type" value={data.parcel.propertyType} />
                  <Field label="Unit Number" value={data.kind === 'unit' ? data.identity.recordId : NA} mono />
                  <Field label="Record Status" value={data.owner.ownershipStatus} />
                </Panel>

                <Panel title="Land &amp; Survey Details" accent="text-slate-500">
                  <Field label="Survey Number" value={data.parcel.surveyNumber} mono />
                  <Field label="Subdivision No." value={data.parcel.subdivisionNumber} mono />
                  <Field label="Village / Locality" value={data.parcel.village} />
                  <Field label="Taluk" value={data.parcel.taluk} />
                  <Field label="District" value={data.parcel.district} />
                  <Field label="State" value={NA} />
                  <Field
                    label="Parcel Area"
                    value={data.parcel.areaSqft != null ? `${data.parcel.areaSqft.toLocaleString('en-IN')} sq.ft` : NA}
                  />
                </Panel>
              </div>

              {/* Column 2 — 3D visualization, strongest visual emphasis */}
              <Panel
                title="3D Property Visualization"
                accent="text-primary"
                className="border-primary/25 bg-gradient-to-b from-primary/[0.04] to-transparent"
              >
                <div className="flex h-full flex-col gap-2">
                  <div className="min-h-0 flex-1 overflow-hidden rounded border border-primary/20 bg-white">
                    <PropertyVolumeGlyph glyph={glyph} width={606} height={360} className="h-full w-full" />
                  </div>
                  <p className="text-center text-[11px] font-bold tracking-wide text-primary">{volumeCaption(data)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="overflow-hidden rounded border border-slate-200">
                      <CertificateBoundaryMap boundary={data.spatial.boundary} width={296} height={92} />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 self-center text-[10px]">
                      <Field label="Height" value={t.buildingHeightM != null ? `${t.buildingHeightM} m` : NA} mono className="col-span-2" />
                      <Field label="Volume" value={t.estVolumeM3 != null ? `${t.estVolumeM3} m³` : NA} mono className="col-span-2" />
                      <Field label="Geometry" value={t.geometryStatus} className="col-span-2" />
                    </div>
                  </div>
                </div>
              </Panel>

              {/* Column 3 */}
              <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_1fr] gap-3">
                <Panel title="Spatial Information" accent="text-primary">
                  <Field label="Latitude" value={data.spatial.centroid ? data.spatial.centroid.lat.toFixed(6) : NA} mono />
                  <Field label="Longitude" value={data.spatial.centroid ? data.spatial.centroid.lon.toFixed(6) : NA} mono />
                  <Field label="CRS" value={data.spatial.crs || NA} mono />
                  <Field
                    label="X/Y/Z Bounds"
                    mono
                    value={
                      t.bounds
                        ? `${t.bounds.xmin?.toFixed?.(4)}…${t.bounds.xmax?.toFixed?.(4)}, ${Number.isFinite(t.bounds.zmin) ? t.bounds.zmin.toFixed(2) : '—'}…${Number.isFinite(t.bounds.zmax) ? t.bounds.zmax.toFixed(2) : '—'}m`
                        : NA
                    }
                  />
                </Panel>

                <Panel title="Undivided Share of Land (UDS)" accent="text-brass">
                  <Field label="Ownership Share" value={data.uds.available ? `${data.uds.sharePct}%` : NA} mono />
                  <Field label="Associated Parcel" value={data.uds.associatedParcel} mono />
                  <p className="mt-1 text-[9px] leading-snug text-slate-500">{data.uds.note}</p>
                </Panel>

                <Panel title="Verification" accent="text-teal">
                  <span
                    className={clsx(
                      'mb-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold',
                      verificationTone(data.identity.verificationStatus),
                    )}
                  >
                    {cardStatusLabel(data.identity.verificationStatus, data.identity.verificationLabel)}
                  </span>
                  <Field label="Reviewed By" value={NA} />
                  <Field label="Review Date" value={NA} />
                  <Field label="Remarks" value={data.provenance.disclaimer || data.legal.remarks} />
                </Panel>
              </div>
            </div>

            {/* --------------------------------------------------------- BOTTOM ROW */}
            <div className="grid h-[150px] shrink-0 grid-cols-3 gap-3 px-4 pb-2">
              <Panel title="Owner Information" accent="text-slate-500" dense>
                {data.owner.current.length > 0 ? (
                  data.owner.current.slice(0, 2).map((o, i) => (
                    <Field
                      key={i}
                      label={i === 0 ? 'Current Owner(s)' : ''}
                      value={[o.name, o.sharePct != null ? `${o.sharePct}%` : null].filter(Boolean).join(' — ')}
                    />
                  ))
                ) : (
                  <Field label="Current Owner(s)" value={NA} />
                )}
                <Field label="Mutation Date" value={data.owner.mutationDate ? dateShort(data.owner.mutationDate) : NA} />
                <p className="mt-1 text-[8.5px] leading-snug text-slate-500">
                  Owner contact information is not exposed on this card. Prototype — synthetic names only.
                </p>
              </Panel>

              <Panel title="Data Provenance" accent="text-slate-500" dense>
                <Field label="Source" value={data.provenance.source} />
                <Field label="Verification" value={cardStatusWord(data.provenance.verificationStatus)} />
                <Field label="Generated" value={dateShort(data.generatedAtISO)} />
                {data.generatedByLine && <Field label="Generated By" value={data.generatedByLine} />}
              </Panel>

              <Panel title="Download &amp; Access" accent="text-primary" dense>
                <div className="flex h-full flex-col justify-center gap-2">
                  <button
                    className="btn-primary w-full justify-center !text-[11px]"
                    onClick={download}
                    disabled={busy}
                  >
                    <Download size={13} /> {busy ? 'Preparing…' : 'Download Smart Property Card (PDF)'}
                  </button>
                  <a href={data.qrUrl} className="btn-ghost w-full justify-center !text-[11px]">
                    <ExternalLink size={13} /> View Full Property Card
                  </a>
                </div>
              </Panel>
            </div>

            {/* ---------------------------------------------------------- FOOTER */}
            <footer className="flex h-[90px] shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-6">
              <div className="flex items-start gap-1.5 text-[9.5px] leading-snug text-slate-300">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-400" />
                <span className="max-w-[820px]">
                  This Smart Property Card is a system-generated prototype record within Chennai 3D Cadastre. It is not an
                  official government certificate or government-issued digital identity.
                </span>
              </div>
              <div className="shrink-0 text-right text-[9.5px] text-slate-400">
                <p>Generated {dateShort(data.generatedAtISO)}</p>
                <p className="data-mono">{data.identity.recordId}</p>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}
