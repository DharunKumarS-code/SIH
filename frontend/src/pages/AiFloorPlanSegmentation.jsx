import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Play, Map as MapIcon, CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useSelection } from '../context/SelectionContext.jsx'
import {
  PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote, DemoTag, Stat, DataTable,
} from '../components/ui/primitives.jsx'

// AI Floor Plan → Upload → Preview → Validate → Run AI Segmentation →
// Segmentation Results → Review → Generate Units → 3D Preview → Chennai viewer.
const PIPELINE = [
  'Floor plan image', 'Preprocessing', 'AI semantic segmentation', 'Structural elements (walls)',
  'Vectorization', 'Geometry / topology validation', 'Room detection',
  'Apartment / unit inference', 'Building / floor association', '2D unit geometry',
  '3D unit volume', 'Chennai Cesium viewer',
]

const ACCEPT = '.png,.jpg,.jpeg,.tif,.tiff'
const MAX_MB = 12
const RASTER = ['png', 'jpg', 'jpeg']

export default function AiFloorPlanSegmentation() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { setLayerGroup, selectArea, selectAiFloorUnit } = useSelection()
  const fileRef = useRef(null)

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [scale, setScale] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState(null)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const onPick = (f) => {
    setError(null)
    setResult(null)
    if (!f) return
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : ''
    if (!['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
      setError(new Error(`Unsupported file type ".${ext}". Use PNG, JPG or TIFF.`))
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(new Error(`File too large (${(f.size / 1048576).toFixed(1)} MB > ${MAX_MB} MB).`))
      return
    }
    setFile(f)
    setPreview(RASTER.includes(ext) ? URL.createObjectURL(f) : null)
  }

  const run = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('image', file)
      if (buildingId.trim()) fd.append('buildingId', buildingId.trim())
      if (floorId.trim()) fd.append('floorId', floorId.trim())
      if (scale.trim()) fd.append('scaleMPerPx', scale.trim())
      setResult(await api.aiInferFloorPlan(fd))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const review = async (next) => {
    if (!result?.floorPlanId) return
    setReviewing(true)
    try {
      await api.aiFloorPlanReview(result.floorPlanId, next)
      setResult((r) => ({ ...r, reviewStatus: next }))
    } catch (e) {
      setError(e)
    } finally {
      setReviewing(false)
    }
  }

  const openArea = () => {
    setLayerGroup(['aiFloorUnits'], true)
    selectArea(result?.locality || 'sholinganallur')
  }

  const viewOnCesium = () => {
    openArea()
    navigate('/map')
  }

  const openUnitOnMap = (row) => {
    openArea()
    selectAiFloorUnit(row.aiFloorUnitId)
    navigate('/map')
  }

  const s = result?.summary
  const unavailable = result && result.status !== 'COMPLETED'
  const v = result?.validation
  const vTone = v?.status === 'VALID' ? 'Verified' : v?.status === 'ERROR' ? 'Disputed' : 'Under Review'

  return (
    <PageScroll>
      <PageHeader
        title="AI Floor Plan Units"
        subtitle="Upload a floor-plan image → walls, rooms, doors and AI-inferred apartment / property units"
      >
        <DemoTag label="AI / DEMO_RESEARCH_DATA — MODEL OUTPUT" />
      </PageHeader>

      <p className="mb-4 rounded-lg border border-gold/30 bg-gold/10 p-2.5 text-[12px] leading-relaxed text-gold">
        <strong>AI_DEMO / MODEL OUTPUT / DEMO_RESEARCH_DATA (dataset: CubiCasa5K).</strong> Floor-plan geometry, room
        labels and apartment/unit boundaries are produced by an automated model. They are <strong>not</strong> official
        Tamil Nadu cadastral, Chennai building-approval, ULPIN, ownership or legally authoritative apartment-boundary
        data. A floor-plan image has <strong>no coordinates</strong> — geographic placement in the Chennai viewer needs a
        valid building/floor reference. Every result requires human review.
        {status && (
          <span className="ml-1 text-slate-400">
            AI service: {status.floorPlanSegmentation?.aiServiceConfigured ? 'configured' : 'not configured (results will be INFERENCE_UNAVAILABLE)'}.
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1 · Upload floor plan">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            data-testid="fp-image-input"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <button
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-white/20 p-6 text-slate-300 hover:bg-white/5"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={22} className="text-primary" />
            <span className="text-sm">{file ? file.name : 'Choose a PNG / JPG / TIFF floor plan'}</span>
            <span className="text-[11px] text-slate-500">Raster floor plans. Add a building/floor to place units on the map.</span>
          </button>
          {preview && <img src={preview} alt="floor plan preview" className="mt-3 max-h-56 rounded-lg border border-white/10" />}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-[12px] text-slate-400">
              Building ID <span className="text-slate-600">(optional — enables map placement)</span>
              <input
                value={buildingId}
                onChange={(e) => setBuildingId(e.target.value)}
                placeholder="TN-CHN-123456789-B01"
                data-testid="fp-building"
                className="input mt-1 w-full"
              />
            </label>
            <label className="text-[12px] text-slate-400">
              Floor ID <span className="text-slate-600">(optional — adds z / elevation)</span>
              <input
                value={floorId}
                onChange={(e) => setFloorId(e.target.value)}
                placeholder="TN-CHN-123456789-B01-F02"
                data-testid="fp-floor"
                className="input mt-1 w-full"
              />
            </label>
            <label className="text-[12px] text-slate-400 sm:col-span-2">
              Scale (metres per pixel) <span className="text-slate-600">(optional — else areas are PIXEL_SQUARED)</span>
              <input
                value={scale}
                onChange={(e) => setScale(e.target.value)}
                placeholder="e.g. 0.02"
                data-testid="fp-scale"
                className="input mt-1 w-full"
              />
            </label>
          </div>

          <button
            className="btn-primary mt-3 w-full justify-center"
            data-testid="fp-run"
            disabled={!file || busy}
            onClick={run}
          >
            {busy ? <Spinner label="Running segmentation…" /> : <><Play size={15} /> Run AI Segmentation</>}
          </button>
          <ErrorNote error={error} onRetry={() => setError(null)} />
        </Card>

        <Card title="Pipeline">
          <ol className="space-y-1.5 text-[12px] text-slate-300">
            {PIPELINE.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[10px]">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-slate-500">
            Model: classical CV segmenter (default) · optional semantic head (torch). See
            <code className="mx-1">docs/16-ai-floor-plan-segmentation.md</code>.
          </p>
        </Card>
      </div>

      {result && (
        <div data-testid="fp-results">
          <Card
            className="mt-4"
            title="2 · Segmentation results"
            right={<Badge status={unavailable ? 'Under Review' : 'Verified'}>{result.status}</Badge>}
          >
            {unavailable ? (
              <p className="text-sm text-gold" data-testid="fp-unavailable">
                {result.status} — {result.reason || 'the AI service is not reachable. The rest of the app is unaffected.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Walls" value={s.walls} />
                  <Stat label="Rooms" value={s.rooms} />
                  <Stat label="Doors" value={s.doors} />
                  <Stat label="Apartment / units" value={s.units} />
                  <Stat label="Common areas" value={s.commonAreas} />
                  <Stat label="High confidence" value={s.high} />
                  <Stat label="Low confidence" value={s.low} />
                  <Stat label="Review required" value={s.reviewRequired} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Floor plan {result.floorPlanId} · Model {result.model} v{result.modelVersion} ·{' '}
                  {result.georeferenced
                    ? `georeferenced via building (${result.geoStatus})`
                    : `local coordinates only (${result.geoStatus}) — add a Building ID to place on the map`}
                  {' · '}dataset {result.dataset} · {result.dataClassification}
                </p>

                <div className="mt-3 flex items-center gap-2" data-testid="fp-validation">
                  <span className="section-title">Geometry / topology validation</span>
                  <Badge status={vTone}>{v?.status}</Badge>
                  <span className="text-[11px] text-slate-500">
                    {v?.counts?.error || 0} error · {v?.counts?.warning || 0} warning · {v?.counts?.valid || 0} valid
                  </span>
                </div>
                {(v?.issues || []).length > 0 && (
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                    {v.issues.map((it, idx) => (
                      <li key={`${it.rule}-${idx}`} className="text-slate-300">
                        <span className={it.status === 'ERROR' ? 'text-danger' : it.status === 'WARNING' ? 'text-gold' : 'text-slate-500'}>
                          {it.status}
                        </span>{' '}
                        <span className="font-mono text-slate-400">{it.rule}</span> — {it.message}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4">
                  <p className="section-title mb-1">Detected rooms</p>
                  <DataTable
                    rowKey={(r) => r.roomId}
                    columns={[
                      { key: 'roomId', header: 'Room', render: (r) => <span className="font-mono text-[11px]">{r.localRoomId}</span> },
                      { key: 'class', header: 'Type', render: (r) => <Badge>{r.roomType || r.class}</Badge> },
                      { key: 'area', header: 'Area', render: (r) => (r.area != null ? `${r.area} ${r.areaUnit === 'M2' ? 'm²' : 'px²'}` : '—') },
                      { key: 'confidenceLevel', header: 'Confidence' },
                      { key: 'geometryStatus', header: 'Geometry' },
                      { key: 'reviewRequired', header: 'Review', render: (r) => (r.reviewRequired ? 'Required' : '—') },
                    ]}
                    rows={result.rooms || []}
                    empty="No rooms detected."
                  />
                </div>

                <div className="mt-4">
                  <p className="section-title mb-1">Inferred apartment / property units</p>
                  <DataTable
                    rowKey={(r) => r.aiFloorUnitId}
                    onRowClick={result.georeferenced ? openUnitOnMap : undefined}
                    columns={[
                      { key: 'aiFloorUnitId', header: 'Unit', render: (r) => <span className="font-mono text-[11px]">{r.localUnitId}</span> },
                      { key: 'rooms', header: 'Rooms', render: (r) => (r.rooms || []).length },
                      { key: 'roomTypes', header: 'Composition', render: (r) => (r.roomTypes || []).join(', ') || '—' },
                      { key: 'area', header: 'Area', render: (r) => (r.area != null ? `${r.area} ${r.areaUnit === 'M2' ? 'm²' : 'px²'}` : '—') },
                      { key: 'confidenceLevel', header: 'Confidence', render: (r) => <Badge>{r.confidenceLevel}</Badge> },
                      { key: 'geometryStatus', header: 'Geometry' },
                      { key: 'reviewStatus', header: 'Review' },
                    ]}
                    rows={result.units || []}
                    empty="No apartment/unit boundaries inferred."
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Unit IDs are prototype identifiers (<span className="font-mono">AI-UNIT-nnn</span>) — never official ULPINs.
                    {result.parentULPIN
                      ? ` Associated to existing parcel ULPIN ${result.parentULPIN} (${result.ulpinStatus}).`
                      : ' Not associated to a parcel (no building reference).'}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {result.georeferenced && (result.units || []).length > 0 && (
                    <button className="btn-primary justify-center" data-testid="fp-view-cesium" onClick={viewOnCesium}>
                      <MapIcon size={15} /> View on Cesium (same Chennai viewer)
                    </button>
                  )}
                  {can('change-detection:review') && (
                    <div className="flex items-center gap-1.5" data-testid="fp-review">
                      <span className="text-[11px] text-slate-400">Review:</span>
                      <button className="btn-ghost !py-1 text-[11px]" disabled={reviewing} onClick={() => review('ACCEPTED')}>
                        <CheckCircle2 size={13} /> Accept
                      </button>
                      <button className="btn-ghost !py-1 text-[11px]" disabled={reviewing} onClick={() => review('REJECTED')}>Reject</button>
                      <button className="btn-ghost !py-1 text-[11px]" disabled={reviewing} onClick={() => review('NEEDS_CORRECTION')}>Needs correction</button>
                      <Badge>{result.reviewStatus || 'REVIEW_REQUIRED'}</Badge>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[10px] text-gold/90">{result.disclaimer}</p>
              </>
            )}
          </Card>
        </div>
      )}
    </PageScroll>
  )
}
