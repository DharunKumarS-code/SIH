import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crosshair, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useSelection } from '../context/SelectionContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote, DemoTag, Stat,
} from '../components/ui/primitives.jsx'

const ENTITY_OPTIONS = ['All', 'PARCEL', 'BUILDING', 'FLOOR', 'UNIT', 'VOLUME']
const STATUS_OPTIONS = ['All', 'VALID', 'WARNING', 'ERROR', 'REVIEW_REQUIRED']
const SEVERITY_OPTIONS = ['All', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const SELECTABLE_MODES = ['parcel', 'building', 'floor', 'unit']

function statusTone(status) {
  if (status === 'VALID') return 'Verified'
  if (status === 'ERROR') return 'Disputed'
  return 'Under Review'
}

function severityTone(sev) {
  if (sev === 'CRITICAL' || sev === 'HIGH') return 'text-danger'
  if (sev === 'MEDIUM') return 'text-amber-700'
  return 'text-slate-500'
}

function EntitySummaryRow({ label, bucket }) {
  if (!bucket) return null
  return (
    <div className="flex items-center justify-between border-t border-slate-200 py-1.5 text-[12px]" data-testid={`topology-entity-${label.toLowerCase()}`}>
      <span className="text-slate-600">{label}</span>
      <div className="flex gap-3">
        <span className="text-slate-500">Valid <b className="text-slate-600">{bucket.valid}</b></span>
        <span className="text-amber-700">Warning <b>{bucket.warning}</b></span>
        <span className="text-danger">Error <b>{bucket.error}</b></span>
        {bucket.reviewRequired > 0 && <span className="text-slate-500">Review <b>{bucket.reviewRequired}</b></span>}
      </div>
    </div>
  )
}

function Finding({ f, canReview, onFocus, onReview, reviewBusy, expanded, onToggle }) {
  return (
    <div className="border-t border-slate-200 py-2.5" data-testid="topology-finding">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge status={statusTone(f.status)}>{f.status}</Badge>
            <span className={`text-[10px] font-bold uppercase ${severityTone(f.severity)}`}>{f.severity}</span>
            <span className="font-mono text-[11px] text-slate-500">{f.ruleId}</span>
            <Badge>{f.entityType}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-slate-700">{f.message}</p>
          {f.suggestedFix && (
            <p className="mt-1 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">Suggested Fix: </span>{f.suggestedFix}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button className="btn-ghost !px-2 !py-1 text-[11px]" data-testid="topology-focus" onClick={() => onFocus(f)}>
            <Crosshair size={12} /> Focus
          </button>
          <button className="btn-ghost !px-2 !py-1 text-[11px]" data-testid="topology-details" onClick={() => onToggle(f.validationId)}>
            Details {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>
      {f.relatedEntityId && f.relatedFocusRef && (
        <button className="mt-1.5 text-[11px] text-primary underline" data-testid="topology-focus-related" onClick={() => onFocus({ ...f, focusRef: f.relatedFocusRef, locality: f.locality })}>
          Also focus related entity: {f.relatedEntityId}
        </button>
      )}
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-slate-50 p-2 text-[11px] text-slate-500" data-testid="topology-finding-details">
          <span>Entity ID: <span className="font-mono text-slate-600">{f.entityId}</span></span>
          {f.parentEntityId && <span>Parent: <span className="font-mono text-slate-600">{f.parentEntityId}</span></span>}
          {f.relatedEntityId && <span>Related: <span className="font-mono text-slate-600">{f.relatedEntityId}</span></span>}
          {f.computedValue != null && <span>Computed Value: <span className="text-slate-600">{f.computedValue}</span></span>}
          {f.tolerance != null && <span>Tolerance: <span className="text-slate-600">{f.tolerance}</span></span>}
          {f.provenance && <span>Provenance: <span className="text-slate-600">{f.provenance}</span></span>}
          {f.aliases?.length > 0 && <span>Also known as: <span className="font-mono text-slate-600">{f.aliases.join(', ')}</span></span>}
          <span>Validation ID: <span className="font-mono text-slate-600">{f.validationId}</span></span>
        </div>
      )}
      {canReview && f.status !== 'VALID' && (
        <div className="mt-1.5 flex items-center gap-2">
          {f.reviewAction ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 size={12} /> {f.reviewAction}</span>
          ) : (
            <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={reviewBusy === f.validationId} onClick={() => onReview(f.validationId)}>
              {reviewBusy === f.validationId ? <Spinner label="…" /> : 'Mark Reviewed'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function TopologyValidation() {
  const navigate = useNavigate()
  const { area, selection, selectArea, selectParcel, selectBuilding, selectFloor, selectUnit } = useSelection()
  const { can } = useAuth()
  const canValidate = can('topology:validate')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [run, setRun] = useState(null)
  const [config, setConfig] = useState(null)
  const [filters, setFilters] = useState({ entity: 'All', status: 'All', severity: 'All' })
  const [expandedId, setExpandedId] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(null)

  useEffect(() => {
    api.topologyConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  // Read-only roles (topology:read but not topology:validate) can still review
  // the most recent stored run — load it so the page is not a dead end.
  useEffect(() => {
    if (canValidate) return
    let alive = true
    ;(async () => {
      try {
        const list = await api.topologyResults({ limit: 1 })
        const latest = Array.isArray(list) ? list[0] : list?.[0]
        if (!latest || !alive) return
        const full = await api.topologyResult(latest.validationRunId)
        if (alive) setRun(full)
      } catch {
        /* no stored run to show, or no topology:read — leave the page empty */
      }
    })()
    return () => { alive = false }
  }, [canValidate])

  const canValidateSelection = SELECTABLE_MODES.includes(selection.mode)

  const runValidation = async (kind) => {
    setBusy(kind)
    setError(null)
    try {
      let res
      if (kind === 'all') res = await api.topologyValidateAll()
      else if (kind === 'area') res = await api.topologyValidateArea(area.id)
      else if (kind === 'entity') {
        if (selection.mode === 'parcel') res = await api.topologyValidateParcel(selection.ulpin)
        else if (selection.mode === 'building') res = await api.topologyValidateBuilding(selection.buildingId)
        else if (selection.mode === 'floor') res = await api.topologyValidateFloor(`${selection.buildingId}-F${String(selection.floorNumber).padStart(2, '0')}`)
        else if (selection.mode === 'unit') res = await api.topologyValidateUnit(selection.propertyId)
        else throw new Error('Select a parcel, building, floor or unit in the 3D map first.')
      }
      setRun(res)
      setExpandedId(null)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (!run) return []
    return run.findings.filter((f) => (
      (filters.entity === 'All' || f.entityType === filters.entity)
      && (filters.status === 'All' || f.status === filters.status)
      && (filters.severity === 'All' || f.severity === filters.severity)
    ))
  }, [run, filters])

  const focus = (f) => {
    if (f.locality && f.locality !== area.id) selectArea(f.locality)
    const ref = f.focusRef
    if (!ref) { navigate('/map'); return }
    if (ref.kind === 'parcel') selectParcel(ref.ulpin)
    else if (ref.kind === 'building') selectBuilding(ref.buildingId, ref.ulpin)
    else if (ref.kind === 'floor') selectFloor(ref.buildingId, ref.floorNumber, ref.ulpin)
    else if (ref.kind === 'unit') selectUnit({ propertyId: ref.propertyId, buildingId: ref.buildingId, floorNumber: ref.floorNumber, ulpin: ref.ulpin })
    navigate('/map')
  }

  const review = async (validationId) => {
    setReviewBusy(validationId)
    try {
      const res = await api.topologyReviewFinding(run.validationRunId, validationId, 'ACKNOWLEDGED')
      setRun(res)
    } catch (e) {
      setError(e)
    } finally {
      setReviewBusy(null)
    }
  }

  const s = run?.summary

  return (
    <PageScroll>
      <PageHeader title="Topology Validation" subtitle="Deterministic 2D/3D geometry + hierarchy rules across Parcel → Building → Floor → Unit → Volume">
        <DemoTag label="RULE_ENGINE — DETERMINISTIC_VALIDATION" />
      </PageHeader>

      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12px] leading-relaxed text-amber-700">
        <strong>Deterministic geometry rules, not AI.</strong> Findings come from explainable rule-based checks
        (self-intersection, overlap, containment, Z-range, stacking…) against the existing prototype/DEMO geometry.
        A finding never modifies stored geometry — any suggested fix is guidance for a separate, explicit review
        action. {config?.mlDecision}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Run validation">
          {canValidate ? (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button className="btn-primary justify-center" data-testid="topology-validate-all" disabled={!!busy} onClick={() => runValidation('all')}>
                  {busy === 'all' ? <Spinner label="Validating…" /> : 'Validate All'}
                </button>
                <button className="btn-ghost justify-center" data-testid="topology-validate-area" disabled={!!busy} onClick={() => runValidation('area')}>
                  {busy === 'area' ? <Spinner label="Validating…" /> : `Validate ${area.name || 'Current Area'}`}
                </button>
                <button className="btn-ghost justify-center" data-testid="topology-validate-selected" disabled={!!busy || !canValidateSelection} onClick={() => runValidation('entity')}>
                  {busy === 'entity' ? <Spinner label="Validating…" /> : 'Validate Selected Entity'}
                </button>
              </div>
              {!canValidateSelection && (
                <p className="mt-2 text-[11px] text-slate-500">Select a parcel, building, floor or unit in the 3D map to enable "Validate Selected Entity".</p>
              )}
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-slate-500" data-testid="topology-readonly-note">
              You have read-only access to topology validation. Running a validation requires the
              <span className="font-medium text-slate-700"> Survey Officer</span> or
              <span className="font-medium text-slate-700"> Administrator</span> role. The most recent
              stored run is shown below.
            </p>
          )}
          <ErrorNote error={error} onRetry={() => setError(null)} />
        </Card>

        <Card title="Summary" right={s && <Badge status={statusTone(s.overallStatus)}>{s.overallStatus}</Badge>}>
          {s ? (
            <>
              <div className="grid grid-cols-4 gap-2" data-testid="topology-summary">
                <Stat label="Valid" value={s.valid} />
                <Stat label="Warning" value={s.warning} />
                <Stat label="Error" value={s.error} />
                <Stat label="Review" value={s.reviewRequired} />
              </div>
              <div className="mt-2">
                <EntitySummaryRow label="Parcel" bucket={s.byEntity.PARCEL} />
                <EntitySummaryRow label="Building" bucket={s.byEntity.BUILDING} />
                <EntitySummaryRow label="Floor" bucket={s.byEntity.FLOOR} />
                <EntitySummaryRow label="Unit" bucket={s.byEntity.UNIT} />
                <EntitySummaryRow label="Volume" bucket={s.byEntity.VOLUME} />
              </div>
            </>
          ) : (
            <p className="text-[12px] text-slate-500">Run a validation to see results.</p>
          )}
        </Card>
      </div>

      {run && (
        <Card className="mt-4" title="Filter">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[12px] text-slate-500">Entity</label>
              <select value={filters.entity} onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))} data-testid="topology-filter-entity" className="input mt-1 !py-1 [&>option]:bg-white">
                {ENTITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-slate-500">Status</label>
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} data-testid="topology-filter-status" className="input mt-1 !py-1 [&>option]:bg-white">
                {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-slate-500">Severity</label>
              <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))} data-testid="topology-filter-severity" className="input mt-1 !py-1 [&>option]:bg-white">
                {SEVERITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </Card>
      )}

      {run && (
        <Card className="mt-4" title="Findings" right={<span className="text-[11px] text-slate-500">{filtered.length} of {run.findings.length}</span>}>
          <div data-testid="topology-findings">
            {filtered.length === 0 && <p className="py-4 text-center text-[12px] text-slate-500">No findings match the current filter.</p>}
            {filtered.map((f) => (
              <Finding
                key={f.validationId}
                f={f}
                canReview={can('topology:review')}
                onFocus={focus}
                onReview={review}
                reviewBusy={reviewBusy}
                expanded={expandedId === f.validationId}
                onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              />
            ))}
          </div>
          <p className="mt-2 text-[10px] text-amber-700">{run.disclaimer}</p>
        </Card>
      )}
    </PageScroll>
  )
}
