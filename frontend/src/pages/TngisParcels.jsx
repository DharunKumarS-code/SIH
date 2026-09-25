import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Landmark, ShieldCheck, Waypoints, Search } from 'lucide-react'
import { api } from '../lib/api.js'
import { useApi } from '../lib/useApi.js'
import { useSelection } from '../context/SelectionContext.jsx'
import {
  PageHeader, PageScroll, Card, Badge, Spinner, ErrorNote, DataTable,
} from '../components/ui/primitives.jsx'

// ---------------------------------------------------------------------------
// TNGIS / Tamil Nilam — PUBLIC-source parcel geometry.
//
// Reads ONLY the public, unauthenticated TNGIS endpoints (admin hierarchy +
// LGD codes, generic_api/v1/get_geom, GeoServer WFS). The official ULPIN /
// Patta / EC / Property Tax / ownership are NOT integrated — they live behind
// the authenticated, encrypted TNGIS API. Nothing is bulk-loaded: the user
// drills District → Taluk → Village → Survey and fetches ONE parcel at a time.
// ---------------------------------------------------------------------------

export default function TngisParcels() {
  const navigate = useNavigate()
  const { selectArea, selectTngisParcel, setLayerGroup, area } = useSelection()

  const [pickedDistrict, setPickedDistrict] = useState('')
  const [talukCode, setTalukCode] = useState('')
  const [villageCode, setVillageCode] = useState('')
  const [surveyNumber, setSurveyNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [lastFetched, setLastFetched] = useState(null)

  const cfgQ = useApi(() => api.tngisConfig().catch(() => null), [])
  const districtsQ = useApi(() => api.tngisDistricts().catch(() => ({ error: true })), [])
  const districts = useMemo(() => (Array.isArray(districtsQ.data) ? districtsQ.data : []), [districtsQ.data])
  // Effective district: the user's pick, else Chennai once the list loads —
  // derived (no effect, no state-sync).
  const defaultDistrict = useMemo(
    () => districts.find((d) => /chennai/i.test(d.name || ''))?.districtCode || '',
    [districts],
  )
  const districtCode = pickedDistrict || defaultDistrict
  const setDistrictCode = setPickedDistrict

  const taluksQ = useApi(
    () => (districtCode ? api.tngisTaluks(districtCode).catch(() => ({ error: true })) : Promise.resolve([])),
    [districtCode],
  )
  const villagesQ = useApi(
    () => (districtCode && talukCode ? api.tngisVillages(districtCode, talukCode).catch(() => ({ error: true })) : Promise.resolve([])),
    [districtCode, talukCode],
  )
  const surveysQ = useApi(
    () => (districtCode && talukCode && villageCode
      ? api.tngisSurveyNumbers(districtCode, talukCode, villageCode).catch(() => ({ error: true }))
      : Promise.resolve({ surveyNumbers: [] })),
    [districtCode, talukCode, villageCode],
  )
  const listQ = useApi(() => api.tngisParcels({ limit: 100 }).catch(() => []), [lastFetched])

  const taluks = Array.isArray(taluksQ.data) ? taluksQ.data : []
  const villages = Array.isArray(villagesQ.data) ? villagesQ.data : []
  const surveys = Array.isArray(surveysQ.data?.surveyNumbers) ? surveysQ.data.surveyNumbers : []
  const rows = Array.isArray(listQ.data) ? listQ.data : []

  const canFetch = districtCode && talukCode && villageCode && surveyNumber && !busy

  const doFetch = async () => {
    if (!canFetch) return
    setBusy(true); setFetchError(null)
    try {
      const rec = await api.tngisFetchParcel({ districtCode, talukCode, villageCode, surveyNumber })
      setLastFetched(rec.sourceRecordId)
    } catch (e) {
      setFetchError(e)
    } finally {
      setBusy(false)
    }
  }

  const openOnMap = (row) => {
    setLayerGroup(['tngisParcels'], true)
    if (row.locality && row.locality !== area?.id) selectArea(row.locality)
    selectTngisParcel(row.sourceRecordId)
    navigate('/map')
  }

  const cfg = cfgQ.data
  const sourceUnreachable = useMemo(
    () => districtsQ.data && !Array.isArray(districtsQ.data),
    [districtsQ.data],
  )

  return (
    <PageScroll>
      <PageHeader
        title="TNGIS / Tamil Nilam Parcels"
        subtitle="Public-source Tamil Nadu GIS parcel geometry — official geometry, no ULPIN. Rendered inside the one Chennai Cesium viewer."
      >
        <span className="inline-flex items-center gap-1.5 rounded bg-brass/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-brass">
          <ShieldCheck size={12} /> Official Source
        </span>
      </PageHeader>

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-brass/30 bg-brass/10 p-2.5 text-[12px] leading-relaxed text-brass">
        <Landmark size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>PUBLIC TNGIS INTEGRATION.</strong> Parcel geometry, the District → Taluk → Village hierarchy and LGD codes are
          sourced verbatim from the publicly accessible Tamil Nadu GIS (TNGIS / Tamil Nilam) and are labelled
          <b> OFFICIAL_SOURCE</b>. The official <b>ULPIN</b>, Patta, FMB attributes, G-Value, EC, Property Tax and ownership are served only
          by the authenticated, encrypted TNGIS API and are <b>not integrated</b> — they show as
          <i> Unavailable from current public source</i>, never fabricated. Existing DEMO / prototype ULPIN records are unaffected.
          See <code className="mx-1">docs/tngis-source-discovery.md</code>.
        </span>
      </p>

      {sourceUnreachable && (
        <p className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-[12px] text-warn" data-testid="tngis-source-unavailable">
          TNGIS source temporarily unavailable. Parcels already fetched remain listed below; new lookups will resume when the source responds.
        </p>
      )}

      <Card title="Fetch one parcel (District → Taluk → Village → Survey)">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <label className="text-[11px] text-slate-500">District
            <select
              value={districtCode}
              onChange={(e) => { setDistrictCode(e.target.value); setTalukCode(''); setVillageCode(''); setSurveyNumber('') }}
              data-testid="tngis-district"
              className="input mt-1 !py-1 [&>option]:bg-surface"
            >
              <option value="">Select District</option>
              {districts.map((d) => <option key={d.districtCode} value={d.districtCode}>{d.name} ({d.districtCode})</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Taluk
            <select
              value={talukCode}
              onChange={(e) => { setTalukCode(e.target.value); setVillageCode(''); setSurveyNumber('') }}
              disabled={!districtCode || taluksQ.loading}
              data-testid="tngis-taluk"
              className="input mt-1 !py-1 [&>option]:bg-surface"
            >
              <option value="">{taluksQ.loading ? 'Loading…' : 'Select Taluk'}</option>
              {taluks.map((t) => <option key={t.talukCode} value={t.talukCode}>{t.name} · LGD {t.lgdTalukCode}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Village
            <select
              value={villageCode}
              onChange={(e) => { setVillageCode(e.target.value); setSurveyNumber('') }}
              disabled={!talukCode || villagesQ.loading}
              data-testid="tngis-village"
              className="input mt-1 !py-1 [&>option]:bg-surface"
            >
              <option value="">{villagesQ.loading ? 'Loading…' : 'Select Village'}</option>
              {villages.map((v) => <option key={v.villageCode} value={v.villageCode}>{v.name} · LGD {v.lgdVillageCode}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Survey Number
            <select
              value={surveyNumber}
              onChange={(e) => setSurveyNumber(e.target.value)}
              disabled={!villageCode || surveysQ.loading}
              data-testid="tngis-survey"
              className="input mt-1 !py-1 [&>option]:bg-surface"
            >
              <option value="">{surveysQ.loading ? 'Loading…' : 'Select Survey Number'}</option>
              {surveys.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-primary" data-testid="tngis-fetch" disabled={!canFetch} onClick={doFetch}>
            {busy ? <Spinner label="Fetching from TNGIS…" /> : <><Search size={14} /> Fetch parcel</>}
          </button>
          <span className="text-[11px] text-slate-500">One parcel per fetch · results cached · no bulk download</span>
        </div>
        <ErrorNote error={fetchError} />
        {cfg && (
          <p className="mt-2 text-[10px] text-slate-500">
            Source CRS <b>{cfg.sourceCRS}</b> · official ULPIN <b>{cfg.officialUlpin}</b> ·
            live <b>{String(cfg.live)}</b> · min interval {cfg.rateLimit?.minIntervalMsBetweenLiveCalls} ms
          </p>
        )}
      </Card>

      <Card className="mt-4" title="Fetched TNGIS parcels" right={<span className="text-[11px] text-slate-500">{rows.length} cached</span>}>
        {listQ.loading && <Spinner />}
        <ErrorNote error={listQ.error} onRetry={listQ.reload} />
        {!listQ.loading && (
          <DataTable
            rowKey={(r) => r.sourceRecordId}
            onRowClick={openOnMap}
            columns={[
              { key: 'sourceRecordId', header: 'Source Record', render: (r) => <span className="font-mono text-[11px]">{r.sourceRecordId}</span> },
              { key: 'survey', header: 'Survey / Sub', render: (r) => `${r.surveyNumber}${r.subDivision ? `/${r.subDivision}` : ''}` },
              { key: 'village', header: 'Village (LGD)', render: (r) => `${r.villageName || r.villageCode} · ${r.lgdVillageCode || '—'}` },
              { key: 'taluk', header: 'Taluk', render: (r) => r.talukName || r.talukCode },
              { key: 'crs', header: 'CRS', render: (r) => <Badge>{r.sourceCRS}</Badge> },
              { key: 'ulpin', header: 'Official ULPIN', render: () => <span className="text-[11px] text-warn">Unavailable (public source)</span> },
              { key: 'prov', header: 'Provenance', render: (r) => <Badge status="Verified">{r.provenance}</Badge> },
            ]}
            rows={rows}
            empty="No TNGIS parcels fetched yet. Pick a District → Taluk → Village → Survey Number above."
          />
        )}
        <button
          className="btn-ghost mt-3 justify-center"
          data-testid="tngis-open-map"
          onClick={() => { setLayerGroup(['tngisParcels'], true); navigate('/map') }}
        >
          <Waypoints size={14} /> Open in 3D map (TNGIS Parcels layer)
        </button>
      </Card>
    </PageScroll>
  )
}
