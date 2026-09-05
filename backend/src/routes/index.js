import { Router } from 'express'
import { z } from 'zod'

import { validate } from '../middleware/validate.js'
import { requireAuth, optionalAuth, requirePermission, requireRole } from '../middleware/auth.js'

import * as auth from '../controllers/authController.js'
import * as land from '../controllers/landController.js'
import * as prop from '../controllers/propertyController.js'
import * as gov from '../controllers/governanceController.js'
import * as misc from '../controllers/miscController.js'
import * as aiBld from '../controllers/aiBuildingController.js'
import * as aiFp from '../controllers/aiFloorPlanController.js'
import * as aiElev from '../controllers/aiElevationController.js'
import * as gnss from '../controllers/gnssController.js'
import * as topo from '../controllers/topologyController.js'

const r = Router()
const ulpinParam = { params: z.object({ ulpin: z.string().min(3) }) }

/* ------------------------------------------------------------------- auth */
r.post('/auth/register', validate(auth.registerSchema), auth.register)
r.post('/auth/login', validate(auth.loginSchema), auth.login)
r.get('/auth/me', requireAuth, auth.me)

/* ------------------------------------------------------- land data sources */
r.get('/land-sources', land.getLandSources)

/* ---------------------------------------------------------------- parcels */
r.get('/parcels', optionalAuth, land.listParcels)
r.get('/parcels/:ulpin', optionalAuth, validate(ulpinParam), land.getParcel)
r.get('/parcels/:ulpin/provenance', optionalAuth, validate(ulpinParam), land.getParcelProvenance)
r.get('/parcels/:ulpin/volumes', optionalAuth, validate(ulpinParam), land.getParcelVolumes)
r.post('/parcels', requireAuth, requirePermission('parcel:search'), validate(land.createParcelSchema), land.createParcel)
r.post('/parcels/:ulpin/verify', requireAuth, requirePermission('parcel:verify'), validate(ulpinParam), land.verifyParcel)

/* ----------------------------------------------------------------- ulpins */
r.get('/ulpins', optionalAuth, land.listUlpins)
r.get('/ulpins/:ulpin', optionalAuth, land.getUlpin)

/* -------------------------------------------------------------- buildings */
r.get('/buildings', optionalAuth, prop.listBuildings)
r.get('/buildings/:buildingId', optionalAuth, prop.getBuilding)
r.get('/buildings/:buildingId/floors', optionalAuth, prop.listFloors)
r.get('/buildings/:buildingId/approval', optionalAuth, gov.getBuildingApproval)

/* ----------------------------------------------------------------- floors */
r.get('/floors/:floorId', optionalAuth, prop.getFloor)

/* ------------------------------------------------------------------ units */
r.get('/units', optionalAuth, prop.listUnits)
r.get('/units/:propertyId', optionalAuth, prop.getUnit)
r.post('/units/:propertyId/verify', requireAuth, requirePermission('property:verify'), prop.verifyUnit)
r.get('/common-areas', optionalAuth, prop.listCommonAreas)

/* ------------------------------------------------------------- governance */
r.get('/ror/:ulpin', optionalAuth, gov.getRoR)
r.get('/registration/:ulpin', optionalAuth, gov.getRegistration)
r.get('/encumbrance/:ulpin', optionalAuth, gov.getEncumbrance)
r.get('/property-tax/:ulpin', optionalAuth, gov.getPropertyTax)
r.get('/building-approval/:buildingId', optionalAuth, gov.getBuildingApproval)
r.get('/land-use/:ulpin', optionalAuth, gov.getLandUse)
r.get('/master-plan', optionalAuth, gov.getMasterPlan)

/* ------------------------------------------------ interoperability layer */
r.get('/interop/:ulpin', optionalAuth, gov.getUnifiedRecord)
r.get('/interop/:ulpin/:department', optionalAuth, gov.getDepartmentView)

/* -------------------------------------------------------------------- gis */
r.get('/gis/localities', land.listLocalities)
r.get('/gis/parcels', land.gisParcels)
r.get('/gis/buildings', land.gisBuildings)
r.get('/gis/units', land.gisUnits)
r.get('/gis/common-areas', land.gisCommonAreas)
r.get('/gis/layer/:layer', land.gisLayer)
r.get('/gis/ai-buildings', optionalAuth, aiBld.gisAiBuildings) // Phase 3 — AI-derived buildings (AI_DEMO)
r.get('/gis/ai-floor-units', optionalAuth, aiFp.gisAiFloorUnits) // Phase 4 — AI floor-plan units (AI_DEMO)
r.get('/gis/gnss-control-points', optionalAuth, gnss.gisGnssControlPoints) // Phase 6 — GNSS/CORS control points

/* -------------------------------------------------- dashboard / analytics */
r.get('/dashboard/stats', optionalAuth, misc.getDashboard)
r.get('/analytics', optionalAuth, misc.getAnalytics)

/* --------------------------------------------------------------- disputes */
r.get('/disputes', optionalAuth, misc.listDisputes)
r.get('/disputes/:disputeId', optionalAuth, misc.getDispute)

/* --------------------------------------------------------------------- ai */
r.get('/ai/status', optionalAuth, misc.getAiStatus)

/* Phase 3 — AI building-footprint extraction (additive; graceful if the Python
   ai-service is unavailable). Registered before the /ai/:feature catch-all. */
r.post('/ai/buildings/infer', requireAuth, requirePermission('ai:run'), aiBld.uploadImage, aiBld.inferAiBuildings)
r.get('/ai/buildings', optionalAuth, aiBld.listAiBuildings)
r.get('/ai/buildings/:id', optionalAuth, aiBld.getAiBuilding)
r.patch('/ai/buildings/:id/review', requireAuth, requirePermission('change-detection:review'), aiBld.reviewAiBuilding)
r.get('/ai/jobs', optionalAuth, aiBld.listAiJobs)
r.get('/ai/jobs/:id', optionalAuth, aiBld.getAiJob)

/* Phase 4 — AI floor-plan & apartment/unit segmentation (additive; graceful if
   the Python ai-service is unavailable). Registered before the /ai/:feature
   catch-all. Own collections — never touches buildings / floors / propertyUnits. */
r.post('/ai/floorplans/infer', requireAuth, requirePermission('ai:run'), aiFp.uploadImage, aiFp.inferAiFloorPlan)
r.get('/ai/floorplans', optionalAuth, aiFp.listAiFloorPlans)
r.get('/ai/floorplans/:id', optionalAuth, aiFp.getAiFloorPlan)
r.get('/ai/floorplans/:id/rooms', optionalAuth, aiFp.getAiFloorPlanRooms)
r.get('/ai/floorplans/:id/units', optionalAuth, aiFp.getAiFloorPlanUnits)
r.get('/ai/floorplans/:id/validation', optionalAuth, aiFp.getAiFloorPlanValidation)
r.get('/ai/floorplans/:id/status', optionalAuth, aiFp.getAiFloorPlanStatus)
r.patch('/ai/floorplans/:id/review', requireAuth, requirePermission('change-detection:review'), aiFp.reviewAiFloorPlan)
r.get('/ai/floor-units/:id', optionalAuth, aiFp.getAiFloorUnit)
r.patch('/ai/floor-units/:id/review', requireAuth, requirePermission('change-detection:review'), aiFp.reviewAiFloorUnit)

/* Phase 5 — elevation / LiDAR / point-cloud / DEM / DSM integration (additive;
   graceful if the Python ai-service is unavailable). Registered before the
   /ai/:feature catch-all. Own collections — never touches `buildings` except
   via the explicit, reversible review/accept action below. */
r.get('/elevation/config', optionalAuth, aiElev.getConfig)
r.post('/elevation/upload', requireAuth, requirePermission('ai:run'), aiElev.uploadSingle, aiElev.uploadDataset)
r.post('/elevation/process', requireAuth, requirePermission('ai:run'), aiElev.uploadProcessFiles, aiElev.processDataset)
r.get('/elevation/datasets', optionalAuth, aiElev.listDatasets)
r.get('/elevation/datasets/:id', optionalAuth, aiElev.getDataset)
r.get('/elevation/datasets/:id/status', optionalAuth, aiElev.getDatasetStatus)
r.get('/elevation/coverage', optionalAuth, aiElev.getCoverage)
r.get('/elevation/buildings/:buildingId/height', optionalAuth, aiElev.getBuildingHeight)
r.get('/elevation/buildings/:buildingId/quality', optionalAuth, aiElev.getBuildingQuality)
r.patch('/elevation/buildings/:buildingId/review', requireAuth, requirePermission('change-detection:review'), aiElev.reviewBuildingHeight)
r.post('/elevation/buildings/:buildingId/revert', requireAuth, requirePermission('change-detection:review'), aiElev.revertBuildingHeight)

/* Phase 6 — GNSS/CORS high-precision spatial control (additive). Own
   `gnssControlPoints` / `boundaryVerification` / `geometryReviewProposals`
   collections — existing `parcels` geometry is only ever touched by the
   explicit reviewer-gated proposal-accept action below. */
r.get('/gnss/config', optionalAuth, gnss.getConfig)
r.post('/gnss/control-points/validate', requireAuth, requirePermission('ai:run'), gnss.uploadSingle, gnss.validateUpload_)
r.post('/gnss/control-points/import', requireAuth, requirePermission('ai:run'), gnss.uploadSingle, gnss.importUpload)
r.get('/gnss/control-points', optionalAuth, gnss.listControlPoints)
r.get('/gnss/control-points/:id', optionalAuth, gnss.getControlPoint)
r.get('/gnss/control-points/:id/validation', optionalAuth, gnss.getControlPointValidation)
r.get('/gnss/control-points/:id/elevation-residual', optionalAuth, gnss.getControlPointElevationResidual)
r.post('/gnss/review', requireAuth, requirePermission('change-detection:review'), gnss.reviewControlPoint)
r.get('/gnss/parcels/:ulpin/control-points', optionalAuth, gnss.listParcelControlPoints)
r.get('/gnss/parcels/:ulpin/boundary-verification', optionalAuth, gnss.getParcelBoundaryVerification)
r.post('/gnss/boundary-analysis', requireAuth, requirePermission('ai:run'), gnss.runBoundaryAnalysis)
r.post('/gnss/transform', requireAuth, requirePermission('ai:run'), gnss.transform)
r.post('/gnss/proposals', requireAuth, requirePermission('parcel:boundary-review'), gnss.createGeometryProposal)
r.get('/gnss/proposals', optionalAuth, gnss.listGeometryProposals)
r.get('/gnss/proposals/:id', optionalAuth, gnss.getGeometryProposal)
r.patch('/gnss/proposals/:id/review', requireAuth, requirePermission('change-detection:review'), gnss.reviewGeometryProposal)

/* Phase 7 — intelligent 2D/3D topology validation engine (additive; graceful
   if the Python ai-service is unavailable). Own `topologyValidationResults`
   collection — never touches parcels/buildings/floors/propertyUnits. */
r.get('/topology/config', optionalAuth, topo.getConfig)
r.post('/topology/validate', requireAuth, requirePermission('topology:validate'), topo.validateAll)
r.post('/topology/validate/area/:areaId', requireAuth, requirePermission('topology:validate'), topo.validateArea)
r.post('/topology/validate/parcel/:ulpin', requireAuth, requirePermission('topology:validate'), topo.validateParcel)
r.post('/topology/validate/building/:buildingId', requireAuth, requirePermission('topology:validate'), topo.validateBuilding)
r.post('/topology/validate/floor/:floorId', requireAuth, requirePermission('topology:validate'), topo.validateFloor)
r.post('/topology/validate/unit/:propertyId', requireAuth, requirePermission('topology:validate'), topo.validateUnit)
r.get('/topology/results', requireAuth, requirePermission('topology:read'), topo.listResults)
r.get('/topology/results/:id', requireAuth, requirePermission('topology:read'), topo.getResult)
r.get('/topology/summary', requireAuth, requirePermission('topology:read'), topo.getLatestSummary)
r.patch('/topology/results/:id/findings/:validationId/review', requireAuth, requirePermission('topology:review'), topo.reviewFinding)

r.post('/ai/:feature', requireAuth, requirePermission('ai:run'), misc.runAi)

/* --------------------------------------------------------- citizen services */
r.get('/services', requireAuth, misc.listServices)
r.get('/services/:requestId', requireAuth, misc.getService)
r.post('/services', requireAuth, requirePermission('service:create'), validate(misc.serviceSchema), misc.createService)
r.post('/services/:requestId/advance', requireAuth, requirePermission('service:process'), misc.advanceService)

/* ---------------------------------------------------------------- reports */
r.get('/reports', optionalAuth, misc.getReport)

/* ---------------------------------------------------------- notifications */
r.get('/notifications', requireAuth, misc.listNotifications)
r.post('/notifications/:id/read', requireAuth, misc.markNotificationRead)

/* ------------------------------------------------------------- admin */
r.get('/users', requireAuth, requireRole('Administrator'), misc.listUsers)
r.get('/audit', requireAuth, requirePermission('audit:view-own'), misc.listAudit)

/* ------------------------------------------------------------- system */
r.get('/system/status', misc.getSystemStatus)
r.get('/system/demo-credentials', misc.getDemoCredentials)
r.get('/search', optionalAuth, misc.search)

export default r
