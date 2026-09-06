import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { AppShell } from './components/layout/AppShell.jsx'
import { Spinner } from './components/ui/primitives.jsx'

import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LandParcels from './pages/LandParcels.jsx'
import UlpinSearch from './pages/UlpinSearch.jsx'
import Map3D from './pages/Map3D.jsx'
import Buildings from './pages/Buildings.jsx'
import FloorUnitExplorer from './pages/FloorUnitExplorer.jsx'
import GovernanceTable from './pages/GovernanceTable.jsx'
import Disputes from './pages/Disputes.jsx'
import Analytics from './pages/Analytics.jsx'
import AiStudio from './pages/AiStudio.jsx'
import AiBuildingExtraction from './pages/AiBuildingExtraction.jsx'
import AiFloorPlanSegmentation from './pages/AiFloorPlanSegmentation.jsx'
import ElevationLiDAR from './pages/ElevationLiDAR.jsx'
import GNSSControlPoints from './pages/GNSSControlPoints.jsx'
import TopologyValidation from './pages/TopologyValidation.jsx'
import UndergroundInfrastructure from './pages/UndergroundInfrastructure.jsx'
import Property3DIdentifier from './pages/Property3DIdentifier.jsx'
import Services from './pages/Services.jsx'
import Reports from './pages/Reports.jsx'
import UsersRoles from './pages/UsersRoles.jsx'
import Settings from './pages/Settings.jsx'
import NotFound from './pages/NotFound.jsx'

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
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="parcels" element={<LandParcels />} />
                <Route path="parcels/:ulpin" element={<LandParcels />} />
                <Route path="ulpin-search" element={<UlpinSearch />} />
                <Route path="map" element={<Map3D />} />
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
                <Route path="identifier" element={<Property3DIdentifier />} />
                <Route path="services" element={<Services />} />
                <Route path="reports" element={<Reports />} />
                <Route path="users" element={<UsersRoles />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
