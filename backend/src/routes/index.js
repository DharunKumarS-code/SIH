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
import * as infra from '../controllers/undergroundController.js'
import * as id3d from '../controllers/identifierController.js'
import * as tngis from '../controllers/tngisController.js'

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
r.get('/ulpins/:ulpin/3d-identifiers', optionalAuth, id3d.byOfficialUlpin) // Phase 9 — proposed 3D refs for an Official ULPIN
r.get('/ulpins/:ulpin', optionalAuth, land.getUlpin)

/* -------------------------------------------------------------- buildings */
r.get('/buildings', optionalAuth, prop.listBuildings)
r.get('/buildings/:buildingId', optionalAuth, prop.getBuilding)
r.get('/buildings/:buildingId/floors', optionalAuth, prop.listFloors)
r.get('/buildings/:buildingId/approval', optionalAuth, gov.getBuildingApproval)
// 3D ULPIN (Land Officer only) — see services/threeDUlpin.js. Distinct from
// the Phase 9 /3d-identifiers routes below.
r.post('/buildings/:buildingId/generate-3d-ulpin', requireAuth, requirePermission('3dulpin:create'), prop.generateBuildingThreeDUlpin)

/* ----------------------------------------------------------------- floors */
r.get('/floors/:floorId', optionalAuth, prop.getFloor)

/* ------------------------------------------------------------------ units */
r.get('/units', optionalAuth, prop.listUnits)
r.get('/units/:propertyId', optionalAuth, prop.getUnit)
r.post('/units/:propertyId/verify', requireAuth, requirePermission('property:verify'), prop.verifyUnit)
r.post('/units/:propertyId/generate-3d-ulpin', requireAuth, requirePermission('3dulpin:create'), prop.generateUnitThreeDUlpin)
r.get('/common-areas', optionalAuth, prop.listCommonAreas)

/* ------------------------------------------------------------- governance */
r.get('/governance/overview', optionalAuth, gov.getGovernanceOverview) // Phase 10 — read-only roll-up
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
r.get('/gis/underground-infrastructure', optionalAuth, infra.gisUndergroundInfrastructure) // Phase 8 — underground infrastructure
r.get('/gis/tngis-parcels/bbox', optionalAuth, tngis.gisTngisParcelsViewport) // TNGIS — Chennai-wide viewport (BBOX) parcel loader
r.get('/gis/tngis-parcels', optionalAuth, tngis.gisTngisParcels) // TNGIS / Tamil Nilam — public-source parcel geometry

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

/* Phase 8 — underground 3D infrastructure mapping (additive; graceful if the
   Python ai-service is unavailable — CRS transform for a projected CRS then
   reports TRANSFORMATION_FAILED, never a guess). Own `undergroundInfrastructure`
   / `infrastructureValidationResults` / `infrastructureJobs` collections — never
   touches parcels/buildings/floors/propertyUnits. Rendered inside the EXISTING
   Chennai-wide Cesium viewer. */
r.get('/infrastructure/config', optionalAuth, infra.getConfig)
r.get('/infrastructure/summary', optionalAuth, infra.getSummary)
r.get('/infrastructure/validation-results', requireAuth, requirePermission('infrastructure:read'), infra.listValidationResults)
r.get('/infrastructure/validation-results/:id', requireAuth, requirePermission('infrastructure:read'), infra.getValidationResult)
r.get('/infrastructure', optionalAuth, infra.listInfrastructure)
r.get('/infrastructure/:id', optionalAuth, infra.getInfrastructure)
r.get('/infrastructure/:id/relations', optionalAuth, infra.getRelations)
r.get('/infrastructure/:id/elevation', optionalAuth, infra.getElevation)
r.post('/infrastructure/upload', requireAuth, requirePermission('infrastructure:upload'), infra.uploadSingle, infra.uploadValidate)
r.post('/infrastructure/import', requireAuth, requirePermission('infrastructure:upload'), infra.uploadSingle, infra.uploadImport)
r.post('/infrastructure/validate', requireAuth, requirePermission('infrastructure:validate'), infra.validateInfrastructure)
r.post('/infrastructure/collisions', requireAuth, requirePermission('infrastructure:validate'), infra.getCollisions)
r.patch('/infrastructure/:id/review', requireAuth, requirePermission('infrastructure:review'), infra.reviewInfrastructure)

/* Phase 9 — Proposed 3D Property Identifier (a.k.a. "3D Cadastral Reference ID").
   A RESEARCH / PROTOTYPE application-level reference linking an Official parcel
   ULPIN with Building → Floor → Unit → 3D Volume → Geometry Version. It is NOT
   an official government 3D ULPIN standard and never replaces the Official
   ULPIN. Own `proposed3DPropertyIdentifiers` / `geometryVersions` collections —
   pointers only, never touches parcels/buildings/floors/propertyUnits. */
r.get('/3d-identifiers/config', optionalAuth, id3d.getConfig)
r.get('/3d-identifiers/search', optionalAuth, id3d.search)
r.get('/3d-identifiers', optionalAuth, id3d.listAll)
r.post('/3d-identifiers', requireAuth, requirePermission('3didentifier:create'), id3d.create)
r.post('/3d-identifiers/validate', requireAuth, requirePermission('3didentifier:validate'), id3d.validate)
r.get('/3d-identifiers/:identifierId', optionalAuth, id3d.getOne)
r.get('/3d-identifiers/:identifierId/hierarchy', optionalAuth, id3d.getHierarchy)
r.get('/3d-identifiers/:identifierId/geometry', optionalAuth, id3d.getGeometry)
r.get('/3d-identifiers/:identifierId/versions', optionalAuth, id3d.getVersions)
r.post('/3d-identifiers/:identifierId/versions', requireAuth, requirePermission('3didentifier:create'), id3d.addVersion)
r.patch('/3d-identifiers/:identifierId/versions/review', requireAuth, requirePermission('3didentifier:review'), id3d.reviewVersion)
r.post('/3d-identifiers/:identifierId/revalidate', requireAuth, requirePermission('3didentifier:validate'), id3d.revalidate)

/* --------------- TNGIS / Tamil Nilam — PUBLIC parcel-geometry integration.
   Reads ONLY the public, unauthenticated TNGIS endpoints (admin hierarchy +
   LGD codes, generic_api/v1/get_geom, GeoServer WFS). The authenticated /
   encrypted gi_mvc API (ULPIN, Patta, EC, Property Tax, ownership) is NEVER
   called. officialULPIN is always null. Own `tngisParcels` collection — never
   touches parcels/buildings/floors/propertyUnits. Rendered inside the EXISTING
   Chennai-wide Cesium viewer (additive layer, OFF by default). */
r.get('/tngis/config', optionalAuth, tngis.getConfig)
r.get('/tngis/districts', optionalAuth, tngis.getDistricts)
r.get('/tngis/taluks', optionalAuth, tngis.getTaluks)
r.get('/tngis/villages', optionalAuth, tngis.getVillages)
r.get('/tngis/survey-numbers', optionalAuth, tngis.getSurveyNumbers)
r.get('/tngis/parcels', optionalAuth, tngis.listParcels)
r.post('/tngis/parcels/fetch', requireAuth, requirePermission('parcel:search'), validate(tngis.fetchParcelSchema), tngis.fetchOneParcel)
r.get('/tngis/parcels/:id', optionalAuth, tngis.getParcel)
r.get('/tngis/parcels/:id/relations', optionalAuth, tngis.getRelations)
r.post('/tngis/parcels/:id/validate-topology', requireAuth, requirePermission('topology:validate'), tngis.validateTopology)

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
