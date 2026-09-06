import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, Play, CheckCircle2, Mountain } from 'lucide-react'
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

const DEM_DSM_ACCEPT = '.tif,.tiff'
const POINTCLOUD_ACCEPT = '.las,.laz'
const MAX_MB = 60

function statusBadgeTone(status) {
  if (status === 'VALID') return 'Verified'
  if (status === 'ERROR') return 'Disputed'
  return 'Under Review'
}

function FilePicker({ label, hint, accept, file, onPick, testId }) {
  const ref = useRef(null)
  return (
    <div>
      <input ref={ref} type="file" accept={accept} data-testid={testId} className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
      <button
        className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-slate-300 p-4 text-slate-600 hover:bg-slate-100"
        onClick={() => ref.current?.click()}
        type="button"
      >
        <UploadCloud size={18} className="text-primary" />
        <span className="text-[13px]">{file ? file.name : label}</span>
        <span className="text-[10px] text-slate-500">{hint}</span>
      </button>
    </div>
  )
}

export default function ElevationLiDAR() {
  const navigate = useNavigate()
  const { setLayerGroup, selectArea, selectBuilding } = useSelection()
  const { can } = useAuth()
  const [locality, setLocality] = useState('sholinganallur')
  const [buildingIdsText, setBuildingIdsText] = useState('')
  const [demFile, setDemFile] = useState(null)
  const [dsmFile, setDsmFile] = useState(null)
  const [pcFile, setPcFile] = useState(null)
  const [sourceLabel, setSourceLabel] = useState('ELEVATION_DEMO')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [validation, setValidation] = useState(null)
  const [result, setResult] = useState(null)
  const [config, setConfig] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(null)

  useEffect(() => {
    api.elevationConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  const sizeOk = (f) => !f || f.size <= MAX_MB * 1024 * 1024

  const validateFile = async (file, datasetType) => {
    if (!file) return
    if (!sizeOk(file)) {
      setError(new Error(`${file.name} is too large (${(file.size / 1048576).toFixed(1)} MB > ${MAX_MB} MB).`))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('datasetType', datasetType)
      fd.append('locality', locality)
      fd.append('sourceLabel', sourceLabel)
      const res = await api.elevationUpload(fd)
      setValidation((v) => ({ ...(v || {}), [datasetType]: res }))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!demFile && !dsmFile && !pcFile) {
      setError(new Error('Provide a DEM and/or DSM raster, or a LAS/LAZ point cloud.'))
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      if (demFile) fd.append('dem', demFile)
      if (dsmFile) fd.append('dsm', dsmFile)
      if (pcFile) fd.append('pointcloud', pcFile)
      fd.append('locality', locality)
      fd.append('sourceLabel', sourceLabel)
      const ids = buildingIdsText.split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length) fd.append('buildingIds', ids.join(','))
      const res = await api.elevationProcess(fd)
      setResult(res)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const review = async (buildingId, action) => {
    setReviewBusy(buildingId)
    try {
      await api.elevationReview(buildingId, action)
      setResult((r) => r && {
        ...r,
        buildings: r.buildings.map((b) => (b.buildingId === buildingId ? { ...b, reviewStatus: action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', appliedToBuilding: action === 'ACCEPT' } : b)),
      })
    } catch (e) {
      setError(e)
    } finally {
      setReviewBusy(null)
    }
  }

  const openBuildingOnMap = (row) => {
    setLayerGroup(['elevationHeightQuality'], true)
    selectArea(locality)
    selectBuilding(row.buildingId)
    navigate('/map')
  }

  const s = result?.summary
  const unavailable = result && result.status !== 'COMPLETED'

  return (
    <PageScroll>
      <PageHeader title="Elevation / LiDAR" subtitle="LAS/LAZ point cloud or DEM/DSM raster → ground, roof and building height">
        <DemoTag label="ELEVATION_DEMO — MODEL OUTPUT" />
      </PageHeader>

      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12px] leading-relaxed text-amber-700">
        <strong>ELEVATION_DEMO / MODEL OUTPUT.</strong> Building height, ground and roof elevation are estimated from
        DSM-minus-DEM analysis of demo/research or uploaded elevation data. This is <strong>not</strong> official,
        survey-certified or government-authoritative elevation data, and it never overwrites an existing building's
        height without an explicit reviewer decision. See <code className="mx-1">docs/17-lidar-dem-dsm-elevation.md</code>.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1 · Upload &amp; validate">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <FilePicker label="DEM (.tif)" hint="Ground surface" accept={DEM_DSM_ACCEPT} file={demFile} testId="elev-dem-input"
              onPick={(f) => { setDemFile(f); if (f) validateFile(f, 'DEM') }} />
            <FilePicker label="DSM (.tif)" hint="Top surface" accept={DEM_DSM_ACCEPT} file={dsmFile} testId="elev-dsm-input"
              onPick={(f) => { setDsmFile(f); if (f) validateFile(f, 'DSM') }} />
            <FilePicker label="Point cloud (.las/.laz)" hint="Optional — derives DEM+DSM" accept={POINTCLOUD_ACCEPT} file={pcFile} testId="elev-pc-input"
              onPick={(f) => { setPcFile(f); if (f) validateFile(f, 'POINTCLOUD') }} />
          </div>

          {validation && (
            <div className="mt-3 space-y-1.5" data-testid="elev-validation">
              {Object.entries(validation).map(([type, v]) => (
                <div key={type} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-[12px]">
                  <span className="text-slate-600">{type}</span>
                  <Badge status={v.status === 'VALIDATED' ? 'Verified' : v.status === 'FAILED' ? 'Disputed' : 'Under Review'}>{v.status}</Badge>
                  <span className="font-mono text-[10px] text-slate-500">{v.metadata?.crs || v.metadata?.crsStatus || '—'}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[12px] text-slate-500">Target area</label>
              <select value={locality} onChange={(e) => setLocality(e.target.value)} data-testid="elev-locality" className="input mt-1 !py-1 [&>option]:bg-white">
                {AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-slate-500">Source label</label>
              <select value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} data-testid="elev-source-label" className="input mt-1 !py-1 [&>option]:bg-white">
                <option value="ELEVATION_DEMO">ELEVATION_DEMO</option>
                <option value="RESEARCH_DATA">RESEARCH_DATA</option>
                <option value="TEST_FIXTURE">TEST_FIXTURE</option>
                <option value="USER_SUPPLIED">USER_SUPPLIED</option>
              </select>
            </div>
          </div>
          <div className="mt-2">
            <label className="text-[12px] text-slate-500">Building IDs (comma-separated — blank = every building in the area)</label>
            <input
              value={buildingIdsText}
              onChange={(e) => setBuildingIdsText(e.target.value)}
              placeholder="e.g. TN-CHN-123456789-B01"
              data-testid="elev-building-ids"
              className="input mt-1 w-full !py-1 font-mono text-[12px]"
            />
          </div>

          <button className="btn-primary mt-3 w-full justify-center" data-testid="elev-run" disabled={busy} onClick={run}>
            {busy ? <Spinner label="Processing elevation…" /> : <><Play size={15} /> 2 · Process — DEM/DSM → building height</>}
          </button>
          <ErrorNote error={error} onRetry={() => setError(null)} />
        </Card>

        <Card title="Pipeline">
          <ol className="space-y-1.5 text-[12px] text-slate-600">
            {(config?.pipeline || [
              'Point cloud / DEM / DSM input', 'Validation', 'Ground classification', 'DEM generation',
              'Surface classification', 'DSM generation', 'DSM − DEM height estimate', 'Building height sampling',
              'Quality & confidence', 'Building height results',
            ]).map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[10px]">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-slate-500">
            Ground/roof buffer: {config?.thresholds?.footprintBufferM ?? '—'} m · outlier clip [{config?.thresholds?.outlierLowPct ?? '—'}–{config?.thresholds?.outlierHighPct ?? '—'}] pct
          </p>
        </Card>
      </div>

      {result && (
        <div data-testid="elev-results">
          <Card className="mt-4" title="3 · Results" right={<Badge status={unavailable ? 'Under Review' : 'Verified'}>{result.status}</Badge>}>
            {unavailable ? (
              <p className="text-sm text-amber-700" data-testid="elev-unavailable">
                {result.status} — {result.reason || 'the AI service is not reachable. The rest of the app is unaffected.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Buildings" value={s?.total ?? 0} />
                  <Stat label="Valid" value={s?.valid ?? 0} />
                  <Stat label="Warning" value={s?.warning ?? 0} />
                  <Stat label="Error" value={s?.error ?? 0} />
                  <Stat label="High confidence" value={s?.high ?? 0} />
                  <Stat label="Medium" value={s?.medium ?? 0} />
                  <Stat label="Low" value={s?.low ?? 0} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {result.groundClassificationMethod ? `Ground classification: ${result.groundClassificationMethod} · ` : ''}
                  CRS: {result.crsComparison?.horizontalCRS?.status ?? '—'} · Vertical datum: {result.crsComparison?.verticalDatum?.status ?? '—'}
                </p>

                <div className="mt-3">
                  <DataTable
                    rowKey={(r) => r.buildingId}
                    onRowClick={openBuildingOnMap}
                    columns={[
                      { key: 'buildingId', header: 'Building', render: (r) => <span className="font-mono text-xs">{r.buildingId}</span> },
                      { key: 'groundElevationM', header: 'Ground (m)', render: (r) => r.groundElevationM ?? '—' },
                      { key: 'roofElevationM', header: 'Roof (m)', render: (r) => r.roofElevationM ?? '—' },
                      { key: 'buildingHeightM', header: 'Height (m)', render: (r) => r.buildingHeightM ?? '—' },
                      { key: 'qualityStatus', header: 'Quality', render: (r) => <Badge status={statusBadgeTone(r.qualityStatus)}>{r.qualityStatus}</Badge> },
                      { key: 'confidenceLevel', header: 'Confidence', render: (r) => <Badge>{r.confidenceLevel}</Badge> },
                      { key: 'existingHeightM', header: 'Existing (m)', render: (r) => (r.existingHeightM != null ? `${r.existingHeightM} (${r.existingHeightSource})` : '—') },
                      {
                        key: 'review', header: 'Review',
                        render: (r) => (
                          r.reviewStatus === 'ACCEPTED'
                            ? <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 size={12} /> Applied</span>
                            : r.reviewStatus === 'REJECTED'
                              ? <span className="text-[11px] text-slate-500">Rejected</span>
                              : can('change-detection:review') ? (
                                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                  <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={reviewBusy === r.buildingId || r.qualityStatus === 'ERROR'} onClick={() => review(r.buildingId, 'ACCEPT')}>Accept</button>
                                  <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={reviewBusy === r.buildingId} onClick={() => review(r.buildingId, 'REJECT')}>Reject</button>
                                </div>
                              ) : <span className="text-[11px] text-slate-500">Requires review permission</span>
                        ),
                      },
                    ]}
                    rows={result.buildings || []}
                    empty="No building height results."
                  />
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700">
                  <Mountain size={11} /> {result.disclaimer}
                </p>
              </>
            )}
          </Card>
        </div>
      )}
    </PageScroll>
  )
}
