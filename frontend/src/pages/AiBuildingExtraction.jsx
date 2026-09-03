import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Play, Map as MapIcon } from 'lucide-react'
import { api } from '../lib/api.js'
import { useSelection } from '../context/SelectionContext.jsx'
import {
  PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote, DemoTag, Stat, DataTable,
} from '../components/ui/primitives.jsx'

const PIPELINE = [
  'Imagery', 'Preprocessing', 'AI segmentation', 'Building mask',
  'Polygon extraction', 'Geometry validation', 'Parcel association', 'Candidate buildings',
]

const AREAS = [
  { id: 'sholinganallur', name: 'Sholinganallur' },
  { id: 'adyar', name: 'Adyar' },
  { id: 'annanagar', name: 'Anna Nagar' },
]

const ACCEPT = '.png,.jpg,.jpeg,.tif,.tiff'
const MAX_MB = 12

export default function AiBuildingExtraction() {
  const navigate = useNavigate()
  const { setLayerGroup, selectArea, selectAiBuilding } = useSelection()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [locality, setLocality] = useState('sholinganallur')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const onPick = (f) => {
    setError(null)
    setResult(null)
    if (!f) return
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : ''
    if (!['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
      setError(new Error(`Unsupported file type ".${ext}". Use PNG, JPG or GeoTIFF.`))
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(new Error(`File too large (${(f.size / 1048576).toFixed(1)} MB > ${MAX_MB} MB).`))
      return
    }
    setFile(f)
    setPreview(['png', 'jpg', 'jpeg'].includes(ext) ? URL.createObjectURL(f) : null)
  }

  const run = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('locality', locality)
      const res = await api.aiInferBuildings(fd)
      setResult(res)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const openArea = () => {
    setLayerGroup(['aiBuildings'], true)
    selectArea(result?.locality || locality)
  }

  const viewOnCesium = () => {
    // turn the AI layer on and point the shared viewer at the job's area. The
    // Cesium map picks up the freshly-extracted buildings on its next
    // ensureAiBuildings() (init + every flyToArea), so no manual refresh needed.
    openArea()
    navigate('/map')
  }

  const openBuildingOnMap = (row) => {
    openArea()
    selectAiBuilding(row.aiBuildingId) // sidebar opens as AiBuildingCard on /map
    navigate('/map')
  }

  const s = result?.summary
  const unavailable = result && result.status !== 'COMPLETED'

  return (
    <PageScroll>
      <PageHeader
        title="AI Building Extraction"
        subtitle="Upload aerial / satellite / drone imagery → candidate building footprints"
      >
        <DemoTag label="AI / PROTOTYPE — MODEL OUTPUT" />
      </PageHeader>

      <p className="mb-4 rounded-lg border border-gold/30 bg-gold/10 p-2.5 text-[12px] leading-relaxed text-gold">
        <strong>AI_DEMO / MODEL OUTPUT.</strong> This tool produces <em>candidate</em> building geometry from an
        automated model. It is <strong>not</strong> official cadastral, survey, ULPIN, building-approval or ownership
        data, and it never overwrites the existing demo buildings. Every result requires human review.
        {status && (
          <span className="ml-1 text-slate-400">
            AI service: {status.buildingExtraction?.aiServiceConfigured ? 'configured' : 'not configured (results will be INFERENCE_UNAVAILABLE)'}.
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1 · Upload image">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            data-testid="ai-image-input"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <button
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-white/20 p-6 text-slate-300 hover:bg-white/5"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={22} className="text-primary" />
            <span className="text-sm">{file ? file.name : 'Choose a PNG / JPG / GeoTIFF'}</span>
            <span className="text-[11px] text-slate-500">GeoTIFF ⇒ map-placed & parcel-associated · PNG/JPG ⇒ pixel-space preview only</span>
          </button>
          {preview && <img src={preview} alt="preview" className="mt-3 max-h-52 rounded-lg border border-white/10" />}
          <div className="mt-3 flex items-center gap-2">
            <label className="text-[12px] text-slate-400">Target area</label>
            <select
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              data-testid="ai-locality"
              className="input !py-1 !w-auto [&>option]:bg-navy-900"
            >
              {AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <button
            className="btn-primary mt-3 w-full justify-center"
            data-testid="ai-run"
            disabled={!file || busy}
            onClick={run}
          >
            {busy ? <Spinner label="Running extraction…" /> : <><Play size={15} /> Run Building Extraction</>}
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
            Model: classical CV segmenter (default) · optional U-Net (torch). See
            <code className="mx-1">docs/15-ai-building-extraction.md</code>.
          </p>
        </Card>
      </div>

      {result && (
        <div data-testid="ai-results">
        <Card
          className="mt-4"
          title="2 · Results"
          right={<Badge status={unavailable ? 'Under Review' : 'Verified'}>{result.status}</Badge>}
        >
          {unavailable ? (
            <p className="text-sm text-gold" data-testid="ai-unavailable">
              {result.status} — {result.reason || 'the AI service is not reachable. The rest of the app is unaffected.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total buildings" value={s.total} />
                <Stat label="High confidence" value={s.high} />
                <Stat label="Medium" value={s.medium} />
                <Stat label="Low" value={s.low} />
                <Stat label="Invalid geometry" value={s.invalidGeometry} />
                <Stat label="Parcel matches" value={s.matched} />
                <Stat label="Multi-parcel" value={s.multiParcel} />
                <Stat label="Review required" value={s.reviewRequired} />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Model {result.model} v{result.modelVersion} · {result.georeferenced ? `georeferenced (${result.geoStatus})` : `non-georeferenced (${result.geoStatus})`}
              </p>

              <div className="mt-3">
                <DataTable
                  rowKey={(r) => r.aiBuildingId}
                  onRowClick={result.georeferenced ? openBuildingOnMap : undefined}
                  columns={[
                    { key: 'aiBuildingId', header: 'AI Building', render: (r) => <span className="font-mono text-xs">{r.aiBuildingId}</span> },
                    { key: 'confidenceLevel', header: 'Confidence', render: (r) => <Badge>{r.confidenceLevel}</Badge> },
                    { key: 'geometryStatus', header: 'Geometry' },
                    { key: 'parcelStatus', header: 'Parcel' },
                    { key: 'parentULPIN', header: 'Parent ULPIN', render: (r) => <span className="font-mono text-[11px]">{r.parentULPIN || '—'}</span> },
                    { key: 'reviewStatus', header: 'Review' },
                  ]}
                  rows={result.buildings || []}
                  empty="No candidate buildings in this image."
                />
              </div>

              {result.georeferenced && (result.buildings || []).length > 0 && (
                <button className="btn-primary mt-3 justify-center" data-testid="ai-view-cesium" onClick={viewOnCesium}>
                  <MapIcon size={15} /> View on Cesium (same Chennai viewer)
                </button>
              )}
              <p className="mt-2 text-[10px] text-gold/90">{result.disclaimer}</p>
            </>
          )}
        </Card>
        </div>
      )}
    </PageScroll>
  )
}
