import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Waypoints, ShieldAlert, Layers3 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
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
const TYPES = ['WATER_PIPELINE', 'SEWER_PIPELINE', 'STORMWATER_DRAIN', 'ELECTRICAL', 'TELECOM', 'GAS', 'TUNNEL', 'METRO', 'UTILITY_DUCT', 'MANHOLE', 'CHAMBER', 'OTHER']
const SOURCES = ['OFFICIAL', 'AUTHORIZED', 'REAL_SURVEY', 'UPLOADED_SURVEY', 'DEMO', 'RESEARCH', 'UNVERIFIED', 'UNAVAILABLE']
const VERIFICATIONS = ['OFFICIAL', 'AUTHORIZED', 'DEMO', 'RESEARCH', 'UNVERIFIED', 'UNAVAILABLE']
const STATUSES = ['OPERATIONAL', 'PLANNED', 'ABANDONED', 'UNKNOWN']
const DEPTHS = [
  { id: '', label: 'Any depth' },
  { id: '0-1.5', label: '0 – 1.5 m' },
  { id: '1.5-4', label: '1.5 – 4 m' },
  { id: '4-15', label: '4 – 15 m' },
  { id: '15-', label: '> 15 m' },
]

const ACCEPT = '.geojson,.json,.csv'
const MAX_MB = 6

const formatOf = (file) => {
  const ext = (file?.name || '').split('.').pop().toLowerCase()
  return ext === 'geojson' ? 'geojson' : ext === 'csv' ? 'csv' : 'json'
}

function statusTone(s) {
  if (s === 'VALID' || s === 'OPERATIONAL' || s === 'OFFICIAL' || s === 'AUTHORIZED') return 'Verified'
  if (s === 'ERROR' || s === 'ABANDONED') return 'Disputed'
  return 'Under Review'
}

function FilePicker({ file, onPick }) {
  const ref = useRef(null)
  return (
    <div>
      <input ref={ref} type="file" accept={ACCEPT} data-testid="infra-file-input" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
      <button
        type="button"
        className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-slate-300 p-4 text-slate-600 hover:bg-slate-100"
        onClick={() => ref.current?.click()}
      >
        <UploadCloud size={18} className="text-primary" />
        <span className="text-[13px]">{file ? file.name : 'Upload infrastructure file (GeoJSON / CSV / JSON)'}</span>
        <span className="text-[10px] text-slate-500">Max {MAX_MB} MB — see docs/20-underground-infrastructure.md</span>
      </button>
    </div>
  )
}

export default function UndergroundInfrastructure() {
  const navigate = useNavigate()
  const { setLayerGroup, selectArea, selectInfrastructure, area } = useSelection()
  const { can } = useAuth()

  const [locality, setLocality] = useState('sholinganallur')
  const [filters, setFilters] = useState({ type: '', status: '', source: '', verificationStatus: '', depth: '' })
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  const [file, setFile] = useState(null)
  const [sourceLabel, setSourceLabel] = useState('DEMO')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [importResult, setImportResult] = useState(null)

  const [collisions, setCollisions] = useState(null)
  const [collisionBusy, setCollisionBusy] = useState(false)
  const [validationRun, setValidationRun] = useState(null)
  const [validationBusy, setValidationBusy] = useState(false)

  useEffect(() => {
    api.infrastructureConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  const listQ = useApi(() => {
    const params = { locality }
    if (filters.type) params.type = filters.type
    if (filters.status) params.status = filters.status
    if (filters.source) params.source = filters.source
    if (filters.verificationStatus) params.verificationStatus = filters.verificationStatus
    if (filters.depth) {
      const [lo, hi] = filters.depth.split('-')
      if (lo) params.minDepthM = lo
      if (hi) params.maxDepthM = hi
    }
    return api.infrastructureList(params)
  }, [locality, filters.type, filters.status, filters.source, filters.verificationStatus, filters.depth])

  const sumQ = useApi(() => api.infrastructureSummary({ locality }), [locality])

  const rows = Array.isArray(listQ.data) ? listQ.data : []
  const summary = sumQ.data
  const loading = listQ.loading || sumQ.loading
  const listError = error || listQ.error || sumQ.error
  const reload = () => { setError(null); listQ.reload(); sumQ.reload() }

  const openOnMap = (row) => {
    setLayerGroup(['undergroundInfrastructure'], true)
    selectArea(locality)
    selectInfrastructure(row.infrastructureId)
    navigate('/map')
  }

  const validate = async () => {
    if (!file) { setError(new Error('Choose a GeoJSON, CSV or JSON file first.')); return }
    if (file.size > MAX_MB * 1024 * 1024) { setError(new Error(`${file.name} is too large (${(file.size / 1048576).toFixed(1)} MB > ${MAX_MB} MB).`)); return }
    setBusy(true); setError(null); setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('format', formatOf(file))
      fd.append('locality', locality)
      setPreview(await api.infrastructureUploadValidate(fd))
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  const doImport = async () => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('format', formatOf(file))
      fd.append('locality', locality)
      fd.append('sourceLabel', sourceLabel)
      const res = await api.infrastructureImport(fd)
      setImportResult(res)
      setLayerGroup(['undergroundInfrastructure'], true)
      reload()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  const runCollisions = async () => {
    setCollisionBusy(true); setError(null)
    try { setCollisions(await api.infrastructureCollisions({ locality })) }
    catch (e) { setError(e) } finally { setCollisionBusy(false) }
  }

  const runValidation = async () => {
    setValidationBusy(true); setError(null)
    try { setValidationRun(await api.infrastructureValidate({ scope: 'locality', locality })) }
    catch (e) { setError(e) } finally { setValidationBusy(false) }
  }

  const s = summary

  return (
    <PageScroll>
      <PageHeader title="Underground Infrastructure" subtitle="Water · sewer · stormwater · electrical · telecom · gas · tunnels · metro · ducts · manholes · chambers — inside the one Chennai Cesium viewer">
        <DemoTag label="DEMO / MODEL OUTPUT" />
      </PageHeader>

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12px] leading-relaxed text-amber-700" data-testid="infra-page-disclaimer">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>UNDERGROUND INFRASTRUCTURE DATA.</strong> Infrastructure geometry, depth, elevation, ownership/authority and status are
          displayed only from available official, authorized, uploaded, research or demonstration datasets. Spatial intersection does not
          establish legal ownership. Underground depth/elevation is only reported when supported by source data. Demonstration data is
          clearly labelled DEMO and is not authoritative Chennai utility infrastructure. See
          <code className="mx-1">docs/20-underground-infrastructure.md</code>.
        </span>
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="infra-summary">
        <Stat label="Total" value={s?.total ?? 0} />
        <Stat label="Official / Authorized" value={s?.official ?? 0} />
        <Stat label="DEMO" value={s?.demo ?? 0} />
        <Stat label="Depth known" value={`${s?.depthKnown ?? 0} / ${s?.total ?? 0}`} />
      </div>

      <Card className="mt-4" title="Filters" right={
        <select value={locality} onChange={(e) => setLocality(e.target.value)} data-testid="infra-locality" className="input !py-1 [&>option]:bg-white">
          {AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      }>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label className="text-[11px] text-slate-500">Type
            <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} data-testid="infra-filter-type" className="input mt-1 !py-1 [&>option]:bg-white">
              <option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Status
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} data-testid="infra-filter-status" className="input mt-1 !py-1 [&>option]:bg-white">
              <option value="">All</option>{STATUSES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Source
            <select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} data-testid="infra-filter-source" className="input mt-1 !py-1 [&>option]:bg-white">
              <option value="">All</option>{SOURCES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Verification
            <select value={filters.verificationStatus} onChange={(e) => setFilters((f) => ({ ...f, verificationStatus: e.target.value }))} data-testid="infra-filter-verification" className="input mt-1 !py-1 [&>option]:bg-white">
              <option value="">All</option>{VERIFICATIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Depth
            <select value={filters.depth} onChange={(e) => setFilters((f) => ({ ...f, depth: e.target.value }))} data-testid="infra-filter-depth" className="input mt-1 !py-1 [&>option]:bg-white">
              {DEPTHS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        </div>
      </Card>

      <Card className="mt-4" title="Infrastructure" right={<span className="text-[11px] text-slate-500">{rows.length} shown</span>}>
        {loading && <Spinner />}
        <ErrorNote error={listError} onRetry={reload} />
        {!loading && (
          <div data-testid="infra-table">
            <DataTable
              rowKey={(r) => r.infrastructureId}
              onRowClick={openOnMap}
              columns={[
                { key: 'infrastructureId', header: 'ID', render: (r) => <span className="font-mono text-xs">{r.infrastructureId}</span> },
                { key: 'type', header: 'Type', render: (r) => <Badge>{r.type}</Badge> },
                { key: 'ownerAuthority', header: 'Owner / Authority', render: (r) => r.ownerAuthority || '—' },
                { key: 'depthBelowSurfaceM', header: 'Depth', render: (r) => (r.depthBelowSurfaceM != null ? `${r.depthBelowSurfaceM} m` : (r.verticalStatus === 'UNKNOWN' ? 'DEPTH UNKNOWN' : '—')) },
                { key: 'spatialRelation', header: 'Spatial relation', render: (r) => <span className="text-[11px]">{r.spatialRelation || '—'}</span> },
                { key: 'legalOwnership', header: 'Legal ownership', render: (r) => <span className="text-[11px] text-slate-500">{r.legalOwnership || 'NOT_PROVIDED'}</span> },
                { key: 'verificationStatus', header: 'Verification', render: (r) => (r.isOfficial ? <Badge status="Verified">{r.verificationStatus}</Badge> : <DemoTag label={r.verificationStatus} />) },
              ]}
              rows={rows}
              empty="No underground infrastructure for this filter."
            />
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="3D collision / clearance analysis" right={
          <button className="btn-ghost !px-2 !py-1 text-[11px]" data-testid="infra-run-collisions" disabled={collisionBusy || !can('infrastructure:validate')} onClick={runCollisions}>
            {collisionBusy ? <Spinner label="Analysing…" /> : 'Run analysis'}
          </button>
        }>
          <p className="text-[11px] text-slate-500">
            A 2D crossing is <strong>not</strong> automatically a 3D collision. Where reliable Z exists the engine reports the measured
            vertical separation and only flags a true 3D collision when the vertical bands actually overlap.
          </p>
          {collisions && (
            <div className="mt-2" data-testid="infra-collision-results">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="3D collisions" value={collisions.collisions} />
                <Stat label="2D only" value={collisions.twoDOnly} />
                <Stat label="Indeterminate Z" value={collisions.indeterminate} />
              </div>
              <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto text-[11px]">
                {collisions.pairs.map((p, i) => (
                  <li key={i} className="rounded border border-slate-200 p-1.5">
                    <span className={p.relationship === '3D_COLLISION' ? 'text-danger' : 'text-slate-600'}>{p.relationship}</span>{' '}
                    <span className="font-mono text-slate-500">{p.a} × {p.b}</span>
                    <span className="text-slate-500"> · vert sep {p.verticalSeparationM ?? '—'} m · {p.clearanceStatus}</span>
                  </li>
                ))}
                {collisions.pairs.length === 0 && <li className="text-slate-500">No crossing pairs in this locality.</li>}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Deterministic validation" right={
          <button className="btn-ghost !px-2 !py-1 text-[11px]" data-testid="infra-run-validation" disabled={validationBusy || !can('infrastructure:validate')} onClick={runValidation}>
            {validationBusy ? <Spinner label="Validating…" /> : 'Validate locality'}
          </button>
        }>
          <p className="text-[11px] text-slate-500">
            Reuses and extends the Phase 7 topology result model: geometry, dimensions, depth reference, vertical datum, CRS and spatial
            rules. A finding never modifies stored geometry.
          </p>
          {validationRun && (
            <div className="mt-2" data-testid="infra-validation-results">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Valid" value={validationRun.summary?.valid ?? 0} />
                <Stat label="Warning" value={validationRun.summary?.warning ?? 0} />
                <Stat label="Error" value={validationRun.summary?.error ?? 0} />
                <Stat label="Review" value={validationRun.summary?.reviewRequired ?? 0} />
              </div>
              <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto text-[11px]">
                {(validationRun.findings || []).slice(0, 40).map((f) => (
                  <li key={f.validationId}>
                    <span className={f.status === 'ERROR' ? 'text-danger' : f.status === 'VALID' ? 'text-emerald-700' : 'text-amber-700'}>{f.status}</span>{' '}
                    <span className="font-mono text-slate-500">{f.ruleId}</span> — {f.message}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-amber-700">{validationRun.disclaimer}</p>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Upload infrastructure (GeoJSON / CSV / JSON)">
        {can('infrastructure:upload') ? (
          <>
            <FilePicker file={file} onPick={setFile} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[12px] text-slate-500">Provenance / source
                <select value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} data-testid="infra-source-label" className="input mt-1 !py-1 [&>option]:bg-white">
                  {SOURCES.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button className="btn-ghost flex-1 justify-center" data-testid="infra-validate" disabled={busy} onClick={validate}>
                  {busy ? <Spinner label="…" /> : 'Validate'}
                </button>
                <button className="btn-primary flex-1 justify-center" data-testid="infra-import" disabled={busy || !preview || preview.overallStatus === 'ERROR'} onClick={doImport}>
                  {busy ? <Spinner label="…" /> : 'Import'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              A source is never automatically promoted to official. DEMO / RESEARCH / UNVERIFIED / UPLOADED_SURVEY stay non-official until an
              authorized review. Depth/elevation is stored only when the file supplies it — never invented.
            </p>
            {preview && (
              <div className="mt-3" data-testid="infra-preview">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-600">Overall</span>
                  <Badge status={statusTone(preview.overallStatus)}>{preview.overallStatus}</Badge>
                </div>
                <div className="mt-1 max-h-56 overflow-y-auto rounded border border-slate-200">
                  {(preview.records || []).map((r) => (
                    <div key={r.index} className="flex items-center justify-between gap-2 border-b border-slate-200 px-2 py-1 text-[11px] last:border-0">
                      <span className="font-mono text-slate-600">{r.infrastructureId}</span>
                      <span className="text-slate-500">{r.type} · {r.crsStatus} · {r.spatialRelation}</span>
                      <Badge status={statusTone(r.validationStatus)}>{r.validationStatus}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {importResult && (
              <p className="mt-2 text-[11px] text-emerald-700" data-testid="infra-import-result">
                Imported {importResult.summary?.total ?? 0} record(s) into {importResult.locality}. {importResult.disclaimer}
              </p>
            )}
          </>
        ) : (
          <p className="text-[12px] text-slate-500">Upload requires the <code>infrastructure:upload</code> permission (Survey Officer / Administrator).</p>
        )}
      </Card>

      <Card className="mt-4" title="Pipeline">
        <ol className="space-y-1.5 text-[12px] text-slate-600">
          {(config?.pipeline || []).map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[10px]">{i + 1}</span>{step}
            </li>
          ))}
        </ol>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Layers3 size={12} /> All infrastructure renders inside the single Chennai-wide Cesium viewer — there is no second map.
          {config?.transform === null && ' AI service unreachable — a projected-CRS upload will report TRANSFORMATION_FAILED (never a guess).'}
        </p>
        <button className="btn-ghost mt-3 justify-center" data-testid="infra-open-map" onClick={() => { setLayerGroup(['undergroundInfrastructure'], true); selectArea(locality); navigate('/map') }}>
          <Waypoints size={14} /> Open in 3D map ({AREAS.find((a) => a.id === locality)?.name || area?.name})
        </button>
      </Card>
    </PageScroll>
  )
}
