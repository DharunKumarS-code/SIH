import { Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { Spinner } from './components/ui/primitives.jsx'
import { lazyWithRetry } from './lib/lazyWithRetry.js'
import { loadMap3D } from './lib/preloadMap.js'

// Detailed 3D Building Explorer — standalone tab, lazy-loaded so its Three.js
// bundle never touches the main Chennai CesiumJS viewer. lazyWithRetry survives
// a transient dev-server dep re-optimize / stale-chunk 404 instead of blanking
// the app.
const BuildingExplorer3D = lazyWithRetry(() => import('./pages/BuildingExplorer3D.jsx'), 'BuildingExplorer3D')

// Underground Infrastructure 3D Explorer — standalone tab, lazy-loaded for the
// same reason. ONE Three.js scene, NOT a second Chennai geographic viewer.
const UndergroundExplorer3D = lazyWithRetry(() => import('./pages/UndergroundExplorer3D.jsx'), 'UndergroundExplorer3D')

// Coimbatore Demonstration Property 3D Explorer — standalone tab, lazy-loaded
// for the same reason. Loads the user-provided ODM textured model (OBJ + MTL
// + 21 textures, ~55MB) ONLY when this route is actually opened — Chennai
// startup never pays for it, and the main Cesium viewer never loads it either.
const CoimbatoreExplorer3D = lazyWithRetry(() => import('./pages/CoimbatoreExplorer3D.jsx'), 'CoimbatoreExplorer3D')

// 3D Map — lazy-loaded so CesiumJS (the bulk of the bundle) is fetched only
// when /map is opened, not on login/dashboard. Same single-viewer component;
// only its loading is deferred.
const Map3D = lazyWithRetry(loadMap3D, 'Map3D')

import Login from './pages/Login.jsx'

// Everything behind authentication is code-split: the login screen downloads
// only what it needs, and each page (incl. the Recharts dashboards) loads on
// first visit. Same lazyWithRetry resilience as the 3D routes above.
const AppShell = lazyWithRetry(() => import('./components/layout/AppShell.jsx').then((m) => ({ default: m.AppShell })), 'AppShell')
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard.jsx'), 'Dashboard')
const LandParcels = lazyWithRetry(() => import('./pages/LandParcels.jsx'), 'LandParcels')
const UlpinSearch = lazyWithRetry(() => import('./pages/UlpinSearch.jsx'), 'UlpinSearch')
const Buildings = lazyWithRetry(() => import('./pages/Buildings.jsx'), 'Buildings')
const FloorUnitExplorer = lazyWithRetry(() => import('./pages/FloorUnitExplorer.jsx'), 'FloorUnitExplorer')
const GovernanceTable = lazyWithRetry(() => import('./pages/GovernanceTable.jsx'), 'GovernanceTable')
const Disputes = lazyWithRetry(() => import('./pages/Disputes.jsx'), 'Disputes')
const Analytics = lazyWithRetry(() => import('./pages/Analytics.jsx'), 'Analytics')
const AiStudio = lazyWithRetry(() => import('./pages/AiStudio.jsx'), 'AiStudio')
const AiBuildingExtraction = lazyWithRetry(() => import('./pages/AiBuildingExtraction.jsx'), 'AiBuildingExtraction')
const AiFloorPlanSegmentation = lazyWithRetry(() => import('./pages/AiFloorPlanSegmentation.jsx'), 'AiFloorPlanSegmentation')
const ElevationLiDAR = lazyWithRetry(() => import('./pages/ElevationLiDAR.jsx'), 'ElevationLiDAR')
const GNSSControlPoints = lazyWithRetry(() => import('./pages/GNSSControlPoints.jsx'), 'GNSSControlPoints')
const TopologyValidation = lazyWithRetry(() => import('./pages/TopologyValidation.jsx'), 'TopologyValidation')
const UndergroundInfrastructure = lazyWithRetry(() => import('./pages/UndergroundInfrastructure.jsx'), 'UndergroundInfrastructure')
const TngisParcels = lazyWithRetry(() => import('./pages/TngisParcels.jsx'), 'TngisParcels')
const Property3DIdentifier = lazyWithRetry(() => import('./pages/Property3DIdentifier.jsx'), 'Property3DIdentifier')
const Governance = lazyWithRetry(() => import('./pages/Governance.jsx'), 'Governance')
const Services = lazyWithRetry(() => import('./pages/Services.jsx'), 'Services')
const Reports = lazyWithRetry(() => import('./pages/Reports.jsx'), 'Reports')
const UsersRoles = lazyWithRetry(() => import('./pages/UsersRoles.jsx'), 'UsersRoles')
const Settings = lazyWithRetry(() => import('./pages/Settings.jsx'), 'Settings')
const NotFound = lazyWithRetry(() => import('./pages/NotFound.jsx'), 'NotFound')

// A signed-in direct load (or reload) of a page would otherwise suspend twice
// (shell chunk, then page chunk), and React holds a revealed Suspense
// boundary back for up to ~300ms. So when a session token is stored, the
// shell and the current route's page are preloaded in parallel and main.jsx
// waits for `startupReady` (bounded) before the first render: both then render
// synchronously. No token (the login screen) => nothing is preloaded.
const PAGE_FOR_PATH = {
  '': Dashboard, dashboard: Dashboard, parcels: LandParcels, 'ulpin-search': UlpinSearch,
  buildings: Buildings, explorer: FloorUnitExplorer, 'land-records': GovernanceTable,
  registration: GovernanceTable, permissions: GovernanceTable, tax: GovernanceTable,
  disputes: Disputes, analytics: Analytics, ai: AiStudio, 'ai-buildings': AiBuildingExtraction,
  'ai-floorplans': AiFloorPlanSegmentation, elevation: ElevationLiDAR, gnss: GNSSControlPoints,
  topology: TopologyValidation, underground: UndergroundInfrastructure, tngis: TngisParcels,
  identifier: Property3DIdentifier, governance: Governance, services: Services, reports: Reports,
  users: UsersRoles, settings: Settings,
}
export const startupReady = (() => {
  let token = null
  try {
    token = window.localStorage.getItem('landstack.token')
  } catch {
    /* storage unavailable -> no preload */
  }
  const seg = window.location.pathname.split('/')[1] || ''
  if (!token || ['login', '3d-explorer', 'underground-explorer', 'coimbatore-explorer'].includes(seg)) {
    return Promise.resolve()
  }
  const page = seg === 'map' ? Map3D : PAGE_FOR_PATH[seg] || NotFound
  return Promise.all([AppShell.preload(), page.preload()])
})()

// After sign-in, warm the remaining (small) page chunks while the browser is
// idle so in-app navigation stays instant. Map3D/Cesium is deliberately NOT
// included — it still downloads only when /map is opened.
function IdlePreload() {
  useEffect(() => {
    const run = () => [...new Set(Object.values(PAGE_FOR_PATH)), NotFound].forEach((c) => c.preload())
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [])
  return null
}

const pageFallback = (
  <div className="grid h-full place-items-center">
    <Spinner label="Loading…" />
  </div>
)

function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting LAND STACK…" />
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/3d-explorer"
        element={
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label="Loading 3D Building Explorer…" /></div>}>
            <BuildingExplorer3D />
          </Suspense>
        }
      />
      <Route
        path="/underground-explorer"
        element={
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label="Loading Underground Infrastructure Explorer…" /></div>}>
            <UndergroundExplorer3D />
          </Suspense>
        }
      />
      <Route
        path="/coimbatore-explorer"
        element={
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label="Loading 3D Property Explorer…" /></div>}>
            <CoimbatoreExplorer3D />
          </Suspense>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={pageFallback}>
              <AppShell>
                <IdlePreload />
                <Suspense fallback={pageFallback}>
                  <Routes>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="parcels" element={<LandParcels />} />
                    <Route path="parcels/:ulpin" element={<LandParcels />} />
                    <Route path="ulpin-search" element={<UlpinSearch />} />
                    <Route
                      path="map"
                      element={
                        <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label="Loading 3D Map…" /></div>}>
                          <Map3D />
                        </Suspense>
                      }
                    />
                    <Route path="buildings" element={<Buildings />} />
                    <Route path="explorer" element={<FloorUnitExplorer />} />
                    <Route path="land-records" element={<GovernanceTable kind="ror" />} />
                    <Route path="registration" element={<GovernanceTable kind="registration" />} />
                    <Route path="permissions" element={<GovernanceTable kind="approval" />} />
                    <Route path="tax" element={<GovernanceTable kind="tax" />} />
                    <Route path="disputes" element={<Disputes />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="ai" element={<AiStudio />} />
                    <Route path="ai-buildings" element={<AiBuildingExtraction />} />
                    <Route path="ai-floorplans" element={<AiFloorPlanSegmentation />} />
                    <Route path="elevation" element={<ElevationLiDAR />} />
                    <Route path="gnss" element={<GNSSControlPoints />} />
                    <Route path="topology" element={<TopologyValidation />} />
                    <Route path="underground" element={<UndergroundInfrastructure />} />
                    <Route path="tngis" element={<TngisParcels />} />
                    <Route path="identifier" element={<Property3DIdentifier />} />
                    <Route path="governance" element={<Governance />} />
                    <Route path="services" element={<Services />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="users" element={<UsersRoles />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </AppShell>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
