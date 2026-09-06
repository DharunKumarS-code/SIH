import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Boxes, ShieldAlert, Crosshair, History, ChevronRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { useSelection } from '../context/SelectionContext.jsx'
import {
  PageHeader, PageScroll, Card, Badge, DemoTag, KeyValue, Spinner, ErrorNote, DataTable, Stat,
} from '../components/ui/primitives.jsx'

function statusTone(s) {
  if (s === 'VALID' || s === 'ACTIVE' || s === 'OFFICIAL' || s === 'AUTHORIZED') return 'Verified'
  if (s === 'ERROR' || s === 'REJECTED' || s === 'INVALID_GEOMETRY_REFERENCE') return 'Disputed'
  return 'Under Review'
}

function HierarchyTree({ h, officialULPINDisplay }) {
  if (!h) return <p className="text-[12px] text-slate-500">Hierarchy could not be resolved.</p>
  const row = (label, value, mono) => (
    <div className="flex items-center gap-2 py-0.5 text-[12px]">
      <ChevronRight size={11} className="text-primary" />
      <span className="text-slate-500">{label}:</span>
      <span className={mono ? 'font-mono text-slate-900' : 'text-slate-900'}>{value ?? '—'}</span>
    </div>
  )
  return (
    <div data-testid="identifier-hierarchy" className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      {row('Parcel', h.parcel?.parcelId, true)}
      <div className="ml-3">{row('Official ULPIN', officialULPINDisplay, true)}</div>
      <div className="ml-6">{row('Building', h.building ? `${h.building.buildingSegment} · ${h.building.name}` : null)}</div>
      <div className="ml-9">{row('Floor', h.floor ? `${h.floor.floorSegment} · ${h.floor.label}` : null)}</div>
      <div className="ml-12">{row('Unit', h.unit ? `${h.unit.unitId} · Apt ${h.unit.apartmentNumber}` : null)}</div>
      <div className="ml-[3.75rem]">{row('3D Volume', h.volume?.volumeId, true)}</div>
      <div className="ml-[4.5rem]">{row('Geometry Version', h.geometryVersion ? `${h.geometryVersion.geometryVersion} · ${h.geometryVersion.status}` : null)}</div>
    </div>
  )
}

function IdentifierDetail({ id }) {
  const q = useApi(() => api.identifier(id), [id])
  const versionsQ = useApi(() => api.identifierVersions(id).catch(() => null), [id])
  const { selectUnit, setLayerGroup } = useSelection()
  const navigate = useNavigate()
  const d = q.data

  if (q.loading) return <Card className="mt-4"><Spinner /></Card>
  if (q.error) return <Card className="mt-4"><ErrorNote error={q.error} onRetry={q.reload} /></Card>
  if (!d) return null

  const focus = () => {
    if (!d.focusRef) { navigate('/map'); return }
    if (d.focusRef.locality) setLayerGroup([], false) // no-op safeguard; keeps existing layers
    selectUnit({
      propertyId: d.focusRef.propertyId,
      buildingId: d.focusRef.buildingId,
      floorNumber: d.focusRef.floorNumber,
      ulpin: d.focusRef.ulpin,
    })
    navigate('/map')
  }

  return (
    <Card className="mt-4" title="Selected identifier" right={<Badge status={statusTone(d.geometryStatus)}>{d.geometryStatus}</Badge>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Official ULPIN (parcel-level, authoritative)</p>
          <p className="mt-0.5 font-mono text-[13px] font-bold text-slate-900 break-all" data-testid="identifier-official-ulpin">
            {d.officialULPINDisplay}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {d.officialULPINVerified
              ? 'Government-verified parcel ULPIN.'
              : 'Not government-verified in this prototype. The Official ULPIN keeps its own provenance and is never upgraded by this identifier.'}
          </p>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-700">
            Proposed 3D Property Identifier <DemoTag label="PROPOSED / RESEARCH" />
          </p>
          <p className="mt-0.5 font-mono text-[13px] font-bold text-slate-900 break-all" data-testid="identifier-canonical">
            {d.canonicalIdentifier}
          </p>
          <p className="mt-1 text-[10px] text-amber-700">
            Research / prototype application reference — <strong>not</strong> an Official ULPIN and <strong>not</strong> a
            government-approved 3D ULPIN standard.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <p className="section-title mb-1">Hierarchy</p>
        <HierarchyTree h={d.hierarchy} officialULPINDisplay={d.officialULPINDisplay} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="section-title mb-1">Provenance</p>
          <KeyValue
            data={{
              'Identifier ID': d.identifierId,
              Status: d.status,
              Source: d.source,
              'Verification Status': d.verificationStatus,
              'Is Official': d.isOfficial ? 'Yes' : 'No',
              'Official ULPIN Status': d.officialULPINStatus,
            }}
          />
        </div>
        <div>
          <p className="section-title mb-1">Legal status (conceptual only)</p>
          <KeyValue
            data={{
              'Legal Status': d.legalStatus,
              'Ownership Status': d.ownershipStatus,
              'Rights Status': d.rightsStatus,
              'Encumbrance Status': d.encumbranceStatus,
            }}
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="section-title mb-1">Conceptual Volumetric Rights (Proposed Rights Association)</p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600" data-testid="identifier-rights">
          <p>Rights: {(d.conceptualVolumetricRights?.rights || []).length === 0 ? 'NOT_ESTABLISHED (none)' : d.conceptualVolumetricRights.rights.join(', ')}</p>
          <p>Restrictions: {(d.conceptualVolumetricRights?.restrictions || []).length === 0 ? 'NOT_PROVIDED (none)' : d.conceptualVolumetricRights.restrictions.join(', ')}</p>
          <p>Encumbrances: {(d.conceptualVolumetricRights?.encumbrances || []).length === 0 ? 'NOT_PROVIDED (none)' : d.conceptualVolumetricRights.encumbrances.join(', ')}</p>
          <p className="mt-1 text-[10px] text-amber-700">{d.conceptualVolumetricRights?.note}</p>
        </div>
      </div>

      <div className="mt-3">
        <p className="section-title mb-1 flex items-center gap-1.5"><History size={12} /> Geometry version history</p>
        <div data-testid="identifier-versions">
          {(versionsQ.data?.versions || d.geometryVersions || []).length === 0 && <p className="text-[12px] text-slate-500">No geometry versions.</p>}
          <ul className="space-y-1">
            {(versionsQ.data?.versions || d.geometryVersions || []).map((v) => (
              <li key={v.geometryVersionId || v.geometryVersion} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-[11px]">
                <span className="font-mono text-slate-900">{v.geometryVersion}</span>
                <Badge status={statusTone(v.status)}>{v.status}</Badge>
                <span className="text-slate-500">src {v.source}</span>
                <span className="text-slate-500">{v.previousVersion ? `prev ${v.previousVersion}` : 'baseline'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-slate-500">
            Historical geometry versions are never deleted; a finalized version is immutable — a change creates a new version.
          </p>
        </div>
      </div>

      {(d.surveyReferences || d.relatedUndergroundInfrastructure?.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="section-title mb-1">Survey references (Phase 6)</p>
            <KeyValue
              data={{
                'Control Point': d.surveyReferences?.controlPointId || 'None',
                CRS: d.surveyReferences?.crs || '—',
                'Vertical Datum': d.surveyReferences?.verticalDatum || 'UNKNOWN',
                'Verification': d.surveyReferences?.verificationStatus || 'UNVERIFIED',
              }}
            />
            <p className="mt-1 text-[10px] text-slate-500">{d.surveyReferences?.note}</p>
          </div>
          <div>
            <p className="section-title mb-1">Related underground infrastructure (Phase 8 — spatial only)</p>
            {(d.relatedUndergroundInfrastructure || []).length === 0
              ? <p className="text-[12px] text-slate-500">None spatially related.</p>
              : (
                <ul className="space-y-0.5 text-[11px] text-slate-600" data-testid="identifier-underground">
                  {d.relatedUndergroundInfrastructure.map((r) => (
                    <li key={r.infrastructureId}>
                      <span className="font-mono text-slate-500">{r.infrastructureId}</span> · {r.type} · {r.spatialRelation} · legal {r.legalOwnership}
                    </li>
                  ))}
                </ul>
              )}
            <p className="mt-1 text-[10px] text-amber-700">Spatial relationship only — never part of the identifier hierarchy and never an ownership claim.</p>
          </div>
        </div>
      )}

      {(d.validation?.findings || []).length > 0 && (
        <div className="mt-3">
          <p className="section-title mb-1">Validation findings</p>
          <ul className="space-y-1 text-[11px]" data-testid="identifier-findings">
            {d.validation.findings.map((f) => (
              <li key={f.validationId}>
                <span className={f.status === 'ERROR' ? 'text-danger' : f.status === 'VALID' ? 'text-emerald-700' : 'text-amber-700'}>{f.status}</span>{' '}
                <span className="font-mono text-slate-500">{f.ruleId}</span> — {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary" data-testid="identifier-focus" onClick={focus} disabled={!d.focusRef}>
          <Crosshair size={14} /> Focus 3D volume in the Chennai viewer
        </button>
        <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(d.canonicalIdentifier)}>Copy identifier</button>
      </div>

      <p className="mt-3 text-[10px] text-amber-700" data-testid="identifier-detail-disclaimer">{d.disclaimer}</p>
    </Card>
  )
}

export default function Property3DIdentifier() {
  const navigate = useNavigate()
  const { selectUnit } = useSelection()
  const [config, setConfig] = useState(null)
  const [q, setQ] = useState('3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2')
  const [selectedId, setSelectedId] = useState(null)
  const [searchState, setSearchState] = useState({ loading: false, error: null, results: null })
  const [ulpinLookup, setUlpinLookup] = useState('TN-CHN-123456789')
  const [ulpinState, setUlpinState] = useState({ loading: false, error: null, data: null })
  const [validateInput, setValidateInput] = useState('3DPR:TN-CHN-123456789:B01:F99:U201:V0201:v1')
  const [validateResult, setValidateResult] = useState(null)
  const [validateBusy, setValidateBusy] = useState(false)

  useEffect(() => {
    api.identifierConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  const listQ = useApi(() => api.identifierList({ limit: 60 }), [])

  const runSearch = async (e) => {
    e?.preventDefault()
    setSearchState({ loading: true, error: null, results: null })
    try {
      const res = await api.identifierSearch(q.trim())
      setSearchState({ loading: false, error: null, results: res.results || [] })
      if ((res.results || []).length) setSelectedId(res.results[0].identifierId)
    } catch (err) {
      setSearchState({ loading: false, error: err, results: null })
    }
  }

  const runUlpinLookup = async () => {
    setUlpinState({ loading: true, error: null, data: null })
    try {
      setUlpinState({ loading: false, error: null, data: await api.ulpinIdentifiers(ulpinLookup.trim()) })
    } catch (err) {
      setUlpinState({ loading: false, error: err, data: null })
    }
  }

  const runValidate = async () => {
    setValidateBusy(true)
    try {
      setValidateResult(await api.identifierValidate({ canonicalIdentifier: validateInput.trim(), source: 'DEMO' }))
    } catch (err) {
      setValidateResult({ overallStatus: 'ERROR', findings: [{ validationId: 'e', ruleId: 'REQUEST_FAILED', status: 'ERROR', message: String(err.message || err) }] })
    } finally {
      setValidateBusy(false)
    }
  }

  return (
    <PageScroll>
      <PageHeader
        title="3D Property Identifier"
        subtitle="Proposed 3D Property Identifier (3D Cadastral Reference ID) — links an Official parcel ULPIN with Building → Floor → Unit → 3D Volume → Geometry Version"
      >
        <DemoTag label="PROPOSED / RESEARCH" />
      </PageHeader>

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12px] leading-relaxed text-amber-700" data-testid="identifier-disclaimer">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>PROPOSED 3D PROPERTY IDENTIFIER.</strong> This identifier is a research / prototype reference created by this
          application to link an official parcel ULPIN, building, floor, unit and 3D volume. It is <strong>NOT</strong> an
          officially approved Government of India or Tamil Nadu 3D ULPIN format and does not replace the official parcel-level
          ULPIN. Volumetric rights, ownership, restrictions and encumbrances are shown only when supported by authoritative data.
          Demonstration and research records are not legally authoritative. See
          <code className="mx-1">docs/21-proposed-3d-property-identifier.md</code>.
        </span>
      </p>

      {config && (
        <Card className="mb-4" title="Canonical format">
          <p className="font-mono text-[12px] text-slate-900">{config.canonicalFormat}</p>
          <p className="mt-1 text-[11px] text-slate-500">{config.officialUlpinNote}</p>
          <p className="mt-1 text-[11px] text-slate-500">{config.standardizationNote}</p>
        </Card>
      )}

      <Card className="mb-4" title="Search">
        <form onSubmit={runSearch} className="flex gap-2">
          <input className="input font-mono text-[12px]" data-testid="identifier-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="3DPR:… or Official ULPIN / Building / Floor / Unit / Volume id" />
          <button className="btn-primary" type="submit"><Search size={15} /> Search</button>
        </form>
        {searchState.loading && <div className="mt-2"><Spinner /></div>}
        <ErrorNote error={searchState.error} />
        {searchState.results && (
          <ul className="mt-2 divide-y divide-slate-200" data-testid="identifier-search-results">
            {searchState.results.length === 0 && <li className="py-2 text-[12px] text-slate-500">No matches.</li>}
            {searchState.results.map((r) => (
              <li key={r.identifierId} className="flex items-center justify-between gap-3 py-2">
                <button className="min-w-0 text-left" onClick={() => setSelectedId(r.identifierId)}>
                  <p className="truncate font-mono text-[12px] font-semibold text-slate-900">{r.canonicalIdentifier}</p>
                  <p className="truncate text-[11px] text-slate-500">ULPIN {r.officialULPIN || 'NOT AVAILABLE'} · {r.geometryVersion} · {r.status}</p>
                </button>
                <Badge>{r.verificationStatus}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selectedId && <IdentifierDetail id={selectedId} />}

      <Card className="mt-4" title="Validate an identifier" right={
        <button className="btn-ghost !px-2 !py-1 text-[11px]" data-testid="identifier-validate-run" disabled={validateBusy} onClick={runValidate}>
          {validateBusy ? <Spinner label="…" /> : 'Validate'}
        </button>
      }>
        <input className="input font-mono text-[12px]" data-testid="identifier-validate-input" value={validateInput} onChange={(e) => setValidateInput(e.target.value)} />
        {validateResult && (
          <div className="mt-2" data-testid="identifier-validate-result">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-slate-600">Overall</span>
              <Badge status={statusTone(validateResult.overallStatus)}>{validateResult.overallStatus}</Badge>
              <span className="text-slate-500">geometryStatus {validateResult.geometryStatus}</span>
            </div>
            <ul className="mt-1 space-y-1 text-[11px]">
              {(validateResult.findings || []).map((f) => (
                <li key={f.validationId}>
                  <span className={f.status === 'ERROR' ? 'text-danger' : f.status === 'VALID' ? 'text-emerald-700' : 'text-amber-700'}>{f.status}</span>{' '}
                  <span className="font-mono text-slate-500">{f.ruleId}</span> — {f.message}
                </li>
              ))}
              {(validateResult.findings || []).length === 0 && <li className="text-emerald-700">VALID — no findings.</li>}
            </ul>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Look up by Official ULPIN">
        <div className="flex flex-wrap items-end gap-2">
          <input className="input w-64 font-mono text-[12px]" data-testid="identifier-ulpin-input" value={ulpinLookup} onChange={(e) => setUlpinLookup(e.target.value)} />
          <button className="btn-primary" data-testid="identifier-ulpin-run" onClick={runUlpinLookup}>Find associated 3D references</button>
        </div>
        <ErrorNote error={ulpinState.error} />
        {ulpinState.data && (
          <div className="mt-3" data-testid="identifier-ulpin-results">
            <p className="text-[11px] text-slate-500">{ulpinState.data.note}</p>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Official ULPIN" value={ulpinState.data.officialULPIN} />
              <Stat label="Status" value={ulpinState.data.officialULPINStatus} />
              <Stat label="Proposed 3D refs" value={ulpinState.data.count} />
            </div>
            <ul className="mt-2 space-y-1">
              {(ulpinState.data.proposed3DIdentifiers || []).map((r) => (
                <li key={r.identifierId} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-[11px]">
                  <button className="font-mono text-slate-900" onClick={() => setSelectedId(r.identifierId)}>{r.canonicalIdentifier}</button>
                  <Badge>{r.geometryVersion}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="All proposed 3D property identifiers" right={<span className="text-[11px] text-slate-500">{(listQ.data || []).length}</span>}>
        {listQ.loading && <Spinner />}
        <ErrorNote error={listQ.error} onRetry={listQ.reload} />
        {!listQ.loading && (
          <DataTable
            rowKey={(r) => r.identifierId}
            onRowClick={(r) => setSelectedId(r.identifierId)}
            columns={[
              { key: 'canonicalIdentifier', header: 'Proposed 3D Property Identifier', render: (r) => <span className="font-mono text-xs">{r.canonicalIdentifier}</span> },
              { key: 'officialULPIN', header: 'Official ULPIN', render: (r) => <span className="font-mono text-xs">{r.officialULPIN || 'NOT AVAILABLE'}</span> },
              { key: 'geometryVersion', header: 'Ver', render: (r) => <Badge>{r.geometryVersion}</Badge> },
              { key: 'status', header: 'Status', render: (r) => <DemoTag label={r.status} /> },
              { key: 'geometryStatus', header: 'Geometry', render: (r) => <Badge status={statusTone(r.geometryStatus)}>{r.geometryStatus}</Badge> },
            ]}
            rows={listQ.data || []}
            empty="No proposed 3D property identifiers."
          />
        )}
        <button
          className="btn-ghost mt-3"
          data-testid="identifier-open-explorer"
          onClick={() => { selectUnit({ propertyId: 'TN-CHN-123456789-B01-F02-U201', buildingId: 'TN-CHN-123456789-B01', floorNumber: 2, ulpin: 'TN-CHN-123456789' }); navigate('/map') }}
        >
          <Boxes size={14} /> Open a referenced volume in the 3D map
        </button>
      </Card>
    </PageScroll>
  )
}
