import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, CheckCircle2, Satellite, MapPinned } from 'lucide-react'
import { api } from '../lib/api.js'
import { useSelection } from '../context/SelectionContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote, DemoTag, Stat, DataTable,
} from '../components/ui/primitives.jsx'

const AREAS = [
  { id: 'sholinganallur', name: 'Sholinganallur' },
  { id: 'adyar', name: 'Adyar' },
  { id: 'annanagar', name: 'Anna Nagar' },
]

const SOURCES = ['REAL_SURVEY', 'CORS_SURVEY', 'UPLOADED_SURVEY', 'DEMO', 'RESEARCH', 'UNVERIFIED', 'TEST_FIXTURE']

const ACCEPT = '.csv,.json,.geojson'
const MAX_MB = 5

const formatOf = (file) => {
  const ext = (file?.name || '').split('.').pop().toLowerCase()
  return ext === 'geojson' ? 'geojson' : ext === 'json' ? 'json' : 'csv'
}

function statusTone(status) {
  if (status === 'VALID') return 'Verified'
  if (status === 'ERROR') return 'Disputed'
  return 'Under Review'
}

function FilePicker({ file, onPick }) {
  const ref = useRef(null)
  return (
    <div>
      <input ref={ref} type="file" accept={ACCEPT} data-testid="gnss-file-input" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
      <button
        className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-white/20 p-4 text-slate-300 hover:bg-white/5"
        onClick={() => ref.current?.click()}
        type="button"
      >
        <UploadCloud size={18} className="text-primary" />
        <span className="text-[13px]">{file ? file.name : 'Upload control-point file (CSV / JSON / GeoJSON)'}</span>
        <span className="text-[10px] text-slate-500">Max {MAX_MB} MB — see docs/18-gnss-cors-spatial-control.md</span>
      </button>
    </div>
  )
}

export default function GNSSControlPoints() {
  const navigate = useNavigate()
  const { setLayerGroup, selectArea, selectGnssPoint } = useSelection()
  const { can } = useAuth()
  const [locality, setLocality] = useState('sholinganallur')
  const [sourceLabel, setSourceLabel] = useState('DEMO')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [config, setConfig] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(null)
  const [ulpin, setUlpin] = useState('TN-CHN-123456789')
  const [boundary, setBoundary] = useState(null)
  const [boundaryBusy, setBoundaryBusy] = useState(false)
  const [proposals, setProposals] = useState(null)
  const [proposalsBusy, setProposalsBusy] = useState(false)
  const [proposalReviewBusy, setProposalReviewBusy] = useState(null)

  useEffect(() => {
    api.gnssConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  const validate = async () => {
    if (!file) { setError(new Error('Choose a CSV, JSON or GeoJSON file first.')); return }
    if (file.size > MAX_MB * 1024 * 1024) { setError(new Error(`${file.name} is too large (${(file.size / 1048576).toFixed(1)} MB > ${MAX_MB} MB).`)); return }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('format', formatOf(file))
      fd.append('locality', locality)
      const res = await api.gnssValidate(fd)
      setPreview(res)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const doImport = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('format', formatOf(file))
      fd.append('locality', locality)
      fd.append('sourceLabel', sourceLabel)
      const res = await api.gnssImport(fd)
      setResult(res)
      window.viewer && setLayerGroup(['gnssControlPoints'], true)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const review = async (controlPointId, action) => {
    setReviewBusy(controlPointId)
    try {
      await api.gnssReview(controlPointId, action)
      setResult((r) => r && {
        ...r,
        controlPoints: r.controlPoints.map((c) => (c.controlPointId === controlPointId ? { ...c, verificationStatus: action } : c)),
      })
    } catch (e) {
      setError(e)
    } finally {
      setReviewBusy(null)
    }
  }

  const runBoundaryAnalysis = async () => {
    setBoundaryBusy(true)
    setError(null)
    try {
      const res = await api.gnssBoundaryAnalysis({ ulpin })
      setBoundary(res)
    } catch (e) {
      setError(e)
    } finally {
      setBoundaryBusy(false)
    }
  }

  const loadProposals = async () => {
    setProposalsBusy(true)
    setError(null)
    try {
      const res = await api.gnssProposals({ ulpin })
      setProposals(res)
    } catch (e) {
      setError(e)
    } finally {
      setProposalsBusy(false)
    }
  }

  const reviewProposal = async (proposalId, action) => {
    setProposalReviewBusy(proposalId)
    try {
      await api.gnssReviewProposal(proposalId, action)
      await loadProposals()
    } catch (e) {
      setError(e)
    } finally {
      setProposalReviewBusy(null)
    }
  }

  const openOnMap = (row) => {
    setLayerGroup(['gnssControlPoints'], true)
    selectArea(locality)
    selectGnssPoint(row.controlPointId)
    navigate('/map')
  }

  const s = result?.summary
  const rows = preview?.points || []

  return (
    <PageScroll>
      <PageHeader title="GNSS / CORS Control" subtitle="High-precision spatial control points → parcel association → boundary verification">
        <DemoTag label="GNSS/CORS DEMO — MODEL OUTPUT" />
      </PageHeader>

      <p className="mb-4 rounded-lg border border-gold/30 bg-gold/10 p-2.5 text-[12px] leading-relaxed text-gold">
        <strong>GNSS/CORS DEMO / MODEL OUTPUT.</strong> Control-point coordinates, elevations, deviations and validation
        results are derived from uploaded, demonstration, research or survey datasets. They are <strong>not</strong>{' '}
        automatically official cadastral control points or government-authoritative survey data. GNSS/CORS accuracy is
        only reported when supported by actual supplied survey observations. Existing parcel geometry is never
        overwritten without explicit authorized review. See <code className="mx-1">docs/18-gnss-cors-spatial-control.md</code>.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1 · Upload &amp; validate">
          <FilePicker file={file} onPick={setFile} />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[12px] text-slate-400">Target area</label>
              <select value={locality} onChange={(e) => setLocality(e.target.value)} data-testid="gnss-locality" className="input mt-1 !py-1 [&>option]:bg-navy-900">
                {AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-slate-400">Provenance / source</label>
              <select value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} data-testid="gnss-source-label" className="input mt-1 !py-1 [&>option]:bg-navy-900">
                {SOURCES.map((s2) => <option key={s2} value={s2}>{s2}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn-ghost justify-center" data-testid="gnss-validate" disabled={busy} onClick={validate}>
              {busy ? <Spinner label="Validating…" /> : <>Validate</>}
            </button>
            <button className="btn-primary justify-center" data-testid="gnss-import" disabled={busy || !preview || preview.overallStatus === 'ERROR'} onClick={doImport}>
              {busy ? <Spinner label="Importing…" /> : <>2 · Import</>}
            </button>
          </div>
          <ErrorNote error={error} onRetry={() => setError(null)} />

          {preview && (
            <div className="mt-3 space-y-1.5" data-testid="gnss-validation">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-300">Overall</span>
                <Badge status={statusTone(preview.overallStatus)}>{preview.overallStatus}</Badge>
              </div>
              <div className="max-h-56 overflow-y-auto rounded border border-white/10">
                {rows.map((p) => (
                  <div key={p.index} className="flex items-center justify-between gap-2 border-b border-white/5 px-2 py-1 text-[11px] last:border-0">
                    <span className="font-mono text-slate-300">{p.controlPointId}</span>
                    <span className="text-slate-500">{p.crsStatus}</span>
                    <Badge status={statusTone(p.validationStatus)}>{p.validationStatus}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Pipeline">
          <ol className="space-y-1.5 text-[12px] text-slate-300">
            {(config?.pipeline || [
              'File input (CSV / JSON / GeoJSON)', 'Field + batch validation', 'CRS resolution / transformation',
              'Outlier detection', 'Parcel association', 'Boundary verification', 'DEM/DSM elevation residual (optional)',
              'Storage (gnssControlPoints)',
            ]).map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[10px]">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-slate-500">
            Boundary tolerance: {config?.thresholds?.boundaryToleranceM ?? '—'} m · outlier MAD-k: {config?.thresholds?.outlierMadK ?? '—'}
          </p>
          {config?.transform === null && (
            <p className="mt-2 text-[11px] text-gold">AI service unreachable — CRS transformation for projected coordinates will report TRANSFORMATION_UNAVAILABLE.</p>
          )}
        </Card>
      </div>

      {result && (
        <div data-testid="gnss-results">
          <Card className="mt-4" title="3 · Import results" right={<Badge status="Verified">{result.status}</Badge>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total" value={s?.total ?? 0} />
              <Stat label="Valid" value={s?.valid ?? 0} />
              <Stat label="Warning" value={s?.warning ?? 0} />
              <Stat label="Error" value={s?.error ?? 0} />
              <Stat label="Matched" value={s?.matched ?? 0} />
              <Stat label="Multi-parcel" value={s?.multiParcel ?? 0} />
              <Stat label="Outside parcel" value={s?.outsideParcel ?? 0} />
              <Stat label="Review required" value={s?.reviewRequired ?? 0} />
            </div>

            <div className="mt-3">
              <DataTable
                rowKey={(r) => r.controlPointId}
                onRowClick={openOnMap}
                columns={[
                  { key: 'controlPointId', header: 'Control Point', render: (r) => <span className="font-mono text-xs">{r.controlPointId}</span> },
                  { key: 'validationStatus', header: 'Validation', render: (r) => <Badge status={statusTone(r.validationStatus)}>{r.validationStatus}</Badge> },
                  { key: 'parcelStatus', header: 'Parcel', render: (r) => <Badge>{r.parcelStatus}</Badge> },
                  { key: 'accuracy', header: 'Accuracy', render: (r) => (r.accuracy != null ? `${r.accuracy} m` : r.accuracyStatus) },
                  { key: 'source', header: 'Source', render: (r) => r.source },
                  {
                    key: 'review', header: 'Review',
                    render: (r) => (
                      r.verificationStatus === 'ACCEPTED'
                        ? <span className="flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={12} /> Accepted</span>
                        : r.verificationStatus === 'REJECTED'
                          ? <span className="text-[11px] text-slate-500">Rejected</span>
                          : can('change-detection:review') ? (
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={reviewBusy === r.controlPointId} onClick={() => review(r.controlPointId, 'ACCEPTED')}>Accept</button>
                              <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={reviewBusy === r.controlPointId} onClick={() => review(r.controlPointId, 'REJECTED')}>Reject</button>
                            </div>
                          ) : <span className="text-[11px] text-slate-500">Requires review permission</span>
                    ),
                  },
                ]}
                rows={result.controlPoints || []}
                empty="No control points imported."
              />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-gold/90">
              <Satellite size={11} /> {result.disclaimer}
            </p>
          </Card>
        </div>
      )}

      <Card className="mt-4" title="4 · Boundary verification">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[12px] text-slate-400">Parcel ULPIN</label>
            <input value={ulpin} onChange={(e) => setUlpin(e.target.value)} data-testid="gnss-boundary-ulpin" className="input mt-1 w-64 !py-1 font-mono text-[12px]" />
          </div>
          <button className="btn-primary justify-center" data-testid="gnss-run-boundary" disabled={boundaryBusy} onClick={runBoundaryAnalysis}>
            {boundaryBusy ? <Spinner label="Analysing…" /> : <><MapPinned size={14} /> Run boundary analysis</>}
          </button>
        </div>
        {boundary && (
          <div className="mt-3" data-testid="gnss-boundary-results">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Verification" value={boundary.verificationStatus} />
              <Stat label="Points" value={boundary.deviations?.count ?? 0} />
              <Stat label="Mean deviation" value={boundary.deviations?.meanM != null ? `${boundary.deviations.meanM} m` : '—'} />
              <Stat label="Max deviation" value={boundary.deviations?.maxM != null ? `${boundary.deviations.maxM} m` : '—'} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{boundary.note}</p>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="5 · Geometry review proposals" right={
        <button className="btn-ghost !px-2 !py-1 text-[11px]" data-testid="gnss-load-proposals" disabled={proposalsBusy} onClick={loadProposals}>
          {proposalsBusy ? <Spinner label="Loading…" /> : 'Load for this ULPIN'}
        </button>
      }>
        <p className="text-[11px] text-slate-500">
          A control-point-suggested boundary correction is never applied automatically — it is recorded as a
          PENDING_REVIEW proposal against the parcel above and only takes effect once an authorized reviewer accepts
          it. The existing parcel geometry is unchanged until then.
        </p>
        {proposals && (
          <div className="mt-3" data-testid="gnss-proposals">
            <DataTable
              rowKey={(r) => r.proposalId}
              columns={[
                { key: 'proposalId', header: 'Proposal', render: (r) => <span className="font-mono text-xs">{r.proposalId}</span> },
                { key: 'reviewStatus', header: 'Status', render: (r) => <Badge status={r.reviewStatus === 'ACCEPTED' ? 'Verified' : r.reviewStatus === 'REJECTED' ? 'Disputed' : 'Under Review'}>{r.reviewStatus}</Badge> },
                { key: 'controlPoints', header: 'Control Points', render: (r) => (r.controlPoints || []).length },
                { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
                {
                  key: 'review', header: 'Review',
                  render: (r) => (
                    r.reviewStatus !== 'PENDING_REVIEW'
                      ? <span className="text-[11px] text-slate-500">{r.reviewedAt ? String(r.reviewedAt).slice(0, 10) : '—'}</span>
                      : can('change-detection:review') ? (
                        <div className="flex gap-1">
                          <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={proposalReviewBusy === r.proposalId} onClick={() => reviewProposal(r.proposalId, 'ACCEPT')}>Accept</button>
                          <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={proposalReviewBusy === r.proposalId} onClick={() => reviewProposal(r.proposalId, 'REJECT')}>Reject</button>
                        </div>
                      ) : <span className="text-[11px] text-slate-500">Requires review permission</span>
                  ),
                },
              ]}
              rows={proposals}
              empty="No geometry review proposals for this ULPIN."
            />
          </div>
        )}
      </Card>
    </PageScroll>
  )
}
