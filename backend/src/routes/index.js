import { Router } from 'express'
import { z } from 'zod'

import { validate } from '../middleware/validate.js'
import { requireAuth, optionalAuth, requirePermission, requireRole } from '../middleware/auth.js'

import * as auth from '../controllers/authController.js'
import * as land from '../controllers/landController.js'
import * as prop from '../controllers/propertyController.js'
import * as gov from '../controllers/governanceController.js'
import * as misc from '../controllers/miscController.js'

const r = Router()
const ulpinParam = { params: z.object({ ulpin: z.string().min(3) }) }

/* ------------------------------------------------------------------- auth */
r.post('/auth/register', validate(auth.registerSchema), auth.register)
r.post('/auth/login', validate(auth.loginSchema), auth.login)
r.get('/auth/me', requireAuth, auth.me)

/* ---------------------------------------------------------------- parcels */
r.get('/parcels', optionalAuth, land.listParcels)
r.get('/parcels/:ulpin', optionalAuth, validate(ulpinParam), land.getParcel)
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
r.get('/gis/parcels', land.gisParcels)
r.get('/gis/buildings', land.gisBuildings)
r.get('/gis/units', land.gisUnits)
r.get('/gis/common-areas', land.gisCommonAreas)
r.get('/gis/layer/:layer', land.gisLayer)

/* -------------------------------------------------- dashboard / analytics */
r.get('/dashboard/stats', optionalAuth, misc.getDashboard)
r.get('/analytics', optionalAuth, misc.getAnalytics)

/* --------------------------------------------------------------- disputes */
r.get('/disputes', optionalAuth, misc.listDisputes)
r.get('/disputes/:disputeId', optionalAuth, misc.getDispute)

/* --------------------------------------------------------------------- ai */
r.get('/ai/status', optionalAuth, misc.getAiStatus)
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
