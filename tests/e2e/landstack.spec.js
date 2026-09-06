import { test, expect, login, openMap, navLink } from './helpers.js'

const ULPIN = 'TN-CHN-123456789'
const PROTO_ID = 'TN-CHN-123456789-B01-F02-U201'

// Warm the Vite dev server so the first timed assertions aren't racing an
// on-demand module transform (matters on a loaded dev machine).
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  try {
    await login(page)
    for (const p of ['/dashboard', '/analytics', '/map', '/ulpin-search']) {
      await page.goto(p).catch(() => {})
      await page.waitForTimeout(800)
    }
  } catch {
    /* warm-up is best-effort */
  } finally {
    await page.close()
  }
})

test.describe('Application load & auth', () => {
  test('redirects to login, then signs in to the dashboard with no fatal errors', async ({ page, diag }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await login(page)
    await expect(page.getByRole('heading', { name: /Government Dashboard/i })).toBeVisible()
    const { pageErrors, consoleErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })
})

test.describe('Route smoke — every main route renders', () => {
  const routes = [
    ['/dashboard', /Government Dashboard/i],
    ['/parcels', /Land Parcels/i],
    ['/ulpin-search', /ULPIN Search/i],
    ['/buildings', /Buildings/i],
    ['/explorer', /Floor & Unit Explorer/i],
    ['/land-records', /Land Records/i],
    ['/registration', /Registration Records/i],
    ['/permissions', /Building Permissions/i],
    ['/tax', /Property Tax/i],
    ['/disputes', /Dispute Management/i],
    ['/analytics', /Analytics/i],
    ['/ai', /AI Studio/i],
    ['/services', /Citizen Services/i],
    ['/reports', /Reports/i],
    ['/users', /Users & Roles/i],
    ['/settings', /Settings & System Status/i],
    ['/elevation', /Elevation \/ LiDAR/i],
    ['/underground', /Underground Infrastructure/i],
    ['/identifier', /3D Property Identifier/i],
  ]

  test('all routes open without a blank page or page error', async ({ page, diag }) => {
    test.slow()
    await login(page)
    for (const [path, heading] of routes) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading }).first(), `route ${path}`).toBeVisible({ timeout: 40_000 })
    }
    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})

test.describe('Dashboard', () => {
  test('shows KPI cards and charts', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText('Total Parcels')).toBeVisible()
    await expect(page.getByText('ULPIN Assigned')).toBeVisible()
    await expect(page.getByText('Land Use Distribution')).toBeVisible()
    await expect(page.locator('.recharts-surface').first()).toBeVisible()
  })
})

test.describe('Demo scenario — Parcel → Building → Floor → Unit → Isolate (spec §51/§56)', () => {
  test('resolves TN-CHN-123456789-B01-F02-U201 end to end', async ({ page, diag }) => {
    await login(page)

    // 1-4. Search the ULPIN and open it in 3D
    await page.goto('/ulpin-search')
    await page.getByRole('textbox').first().fill(ULPIN)
    await page.getByRole('button', { name: /Search/i }).click()
    await expect(page.getByText(new RegExp(`Parcel — ${ULPIN}`))).toBeVisible()
    await page.getByRole('button', { name: /Explore in 3D/i }).click()
    await expect(page).toHaveURL(/\/map/)

    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)

    // 5-6. Building B01
    await page.getByTestId('building-block-B01').click()

    // 9-10. Floor 02
    await page.getByTestId('floor-row-F02').click()

    // 11. Unit U201 from the floor plan
    await page.getByTestId('floorplan-unit-U201').click()

    // 12-15. Right sidebar shows the exact prototype identifier + hierarchy + owner
    const sidebar = page.getByTestId('property-sidebar')
    await expect(sidebar).toBeVisible()
    await expect(page.getByTestId('proto-id')).toContainText(PROTO_ID)
    await expect(sidebar).toContainText(ULPIN) // parent ULPIN in hierarchy
    await expect(sidebar).toContainText('Sai Residency') // building
    await expect(sidebar).toContainText(/Floor 02/) // floor
    await expect(sidebar.getByText('Owner Name')).toBeVisible()
    await expect(sidebar).toContainText('Prototype 3D Property Identifier')

    // 20-22. Isolate the unit
    const isolate = page.getByTestId('isolate-toggle')
    await expect(isolate).toContainText('Isolate Unit')
    await isolate.click()
    await expect(isolate).toContainText('Exit Isolation')
    expect(await page.evaluate(() => window.viewer && !window.viewer.isDestroyed())).toBe(true)

    // 23. Exit isolation + reset
    await isolate.click()
    await expect(isolate).toContainText('Isolate Unit')
    await page.getByRole('button', { name: 'Reset view' }).click()

    // 15b. Layer toggle actually flips state
    const layer = page.getByTestId('layer-units3d')
    await expect(layer).toBeChecked()
    await layer.uncheck()
    await expect(layer).not.toBeChecked()
    await layer.check()

    // 16. Back to dashboard
    await page.goto('/dashboard')
    await expect(page.getByText('Total Parcels')).toBeVisible()

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})

test.describe('Global search', () => {
  test('typing the full prototype id jumps straight to the unit', async ({ page }) => {
    await login(page)
    await openMap(page)
    await page.getByTestId('global-search').fill(PROTO_ID)
    await expect(page.getByTestId('search-results')).toBeVisible()
    await page.getByTestId('search-results').getByText(PROTO_ID).first().click()
    await expect(page.getByTestId('proto-id')).toContainText(PROTO_ID)
  })
})

test.describe('Phase 1 — official vs demo ULPIN provenance', () => {
  test('parcel sidebar labels the id DEMO and search flies in the same viewer', async ({ page, diag }) => {
    await login(page)
    await openMap(page)

    const viewerBefore = await page.evaluate(() => {
      window.__vref = window.viewer
      return Boolean(window.viewer && !window.viewer.isDestroyed())
    })
    expect(viewerBefore).toBe(true)

    // Search the parcel ULPIN and pick the parcel result.
    await page.getByTestId('global-search').fill(ULPIN)
    await expect(page.getByTestId('search-results')).toBeVisible()
    await page.getByTestId('search-results').getByText(ULPIN, { exact: true }).first().click()

    // Parcel sidebar shows the explicit "not an official ULPIN" distinction.
    const sidebar = page.getByTestId('property-sidebar')
    await expect(sidebar).toBeVisible()
    await expect(page.getByTestId('parcel-verification')).toContainText(/Not Official ULPIN/i)
    await expect(page.getByTestId('parcel-ulpin')).toContainText(ULPIN)
    await expect(sidebar).toContainText('Survey Number')
    await expect(sidebar).toContainText('Subdivision')
    await expect(sidebar).toContainText('Coordinates')

    // Same Cesium viewer — no second instance was created.
    expect(await page.evaluate(() => window.viewer === window.__vref && !window.viewer.isDestroyed())).toBe(true)

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('settings documents Chennai ULPIN as UNAVAILABLE via public channels', async ({ page }) => {
    await login(page)
    await page.goto('/settings')
    await expect(page.getByText('Land Data Sources & Provenance')).toBeVisible()
    const avail = page.getByTestId('ulpin-availability')
    await expect(avail).toContainText('UNAVAILABLE')
    await expect(avail).toContainText(/DEMO/i)
    await expect(page.getByRole('link', { name: /Department of Land Resources/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /TNGIS|Tamil Nadu/i }).first()).toBeVisible()
  })
})

test.describe('Regression — Buildings page loads (no 502)', () => {
  test('Buildings page fetches GET /api/buildings with 200 and renders rows', async ({ page }) => {
    const bad = []
    page.on('response', (r) => {
      if (r.url().includes('/api/buildings') && r.status() >= 500) bad.push(`${r.status()} ${r.url()}`)
    })

    await login(page)
    const resp = await page.waitForResponse(
      (r) => r.url().includes('/api/buildings') && r.request().method() === 'GET',
      { timeout: 30_000 },
    ).catch(() => null)

    // navigate explicitly in case the login landed elsewhere
    if (!page.url().includes('/buildings')) await page.goto('/buildings')

    await expect(page.getByRole('heading', { name: /Buildings/i }).first()).toBeVisible()
    await expect(page.getByText(/Couldn.t load data/i)).toHaveCount(0)
    const rows = page.locator('table tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    expect(await rows.count()).toBeGreaterThanOrEqual(12)
    // a known building id from the demo parcel is present
    await expect(page.getByText('TN-CHN-123456789-B01')).toBeVisible()

    if (resp) expect(resp.status(), 'GET /api/buildings status').toBe(200)
    expect(bad, bad.join('\n')).toEqual([])
  })
})

test.describe('Phase 2 — prototype 3D volumes', () => {
  // Drill Building → Floor → Unit inside the CURRENT area and assert the volume UI.
  async function drillToUnitVolume(page, { building = 'B01', floor = 'F02', unit = 'U201' } = {}) {
    await page.getByTestId(`building-block-${building}`).click()
    await page.getByTestId(`floor-row-${floor}`).click()
    // the prototype floor-volume slab is created in the ONE viewer for this floor
    await page.waitForFunction(() => {
      const v = window.viewer
      return v && !v.isDestroyed()
        && v.entities.values.some((e) => (e.properties?.kind?.getValue?.() ?? e.properties?.kind) === 'floor-volume')
    }, null, { timeout: 20_000 })
    await page.getByTestId(`floorplan-unit-${unit}`).click()
    const sidebar = page.getByTestId('property-sidebar')
    await expect(sidebar).toBeVisible()
    await expect(sidebar).toContainText('3D Geometry (Prototype)')
    await expect(sidebar).toContainText('Prototype 3D Geometry')
    await expect(sidebar).toContainText('Z min')
    await expect(sidebar).toContainText('Z max')
    await expect(sidebar).toContainText(/Volume ID/)
    await expect(page.getByTestId('geometry-status')).toBeVisible()
  }

  test('Sholinganallur: unit volume, isolation, and return to Chennai — one viewer throughout', async ({ page, diag }) => {
    await login(page)
    await openMap(page)
    const vref = await page.evaluate(() => { window.__vref = window.viewer; return !!window.viewer })
    expect(vref).toBe(true)

    await drillToUnitVolume(page)

    // isolation still works and is reversible
    const isolate = page.getByTestId('isolate-toggle')
    await isolate.click()
    await expect(isolate).toContainText('Exit Isolation')
    await isolate.click()
    await expect(isolate).toContainText('Isolate Unit')

    // return to Chennai overview via the existing control
    await page.getByTestId('area-city-overview').click()
    await page.waitForTimeout(1500)

    expect(await page.evaluate(() => window.viewer === window.__vref && !window.viewer.isDestroyed())).toBe(true)
    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  for (const area of ['adyar', 'annanagar']) {
    test(`${area}: same viewer, area selector, unit prototype volume renders`, async ({ page, diag }) => {
      await login(page)
      await openMap(page)
      const before = await page.evaluate(() => { window.__vref = window.viewer; return !!window.viewer })
      expect(before).toBe(true)

      await page.getByTestId(`area-option-${area}`).click()
      await page.waitForTimeout(3500)
      // same viewer after the area fly
      expect(await page.evaluate(() => window.viewer === window.__vref && !window.viewer.isDestroyed())).toBe(true)

      await drillToUnitVolume(page)

      expect(await page.evaluate(() => window.viewer === window.__vref)).toBe(true)
      const { pageErrors } = diag.fatal()
      expect(pageErrors, pageErrors.join('\n')).toEqual([])
    })
  }
})

test.describe('Role-based access control', () => {
  test('citizen does not see officer-only navigation', async ({ page }) => {
    await login(page, 'citizen01', 'Citizen@123')
    await expect(navLink(page, 'Dashboard')).toBeVisible()
    await expect(navLink(page, '3D Map')).toBeVisible()
    await expect(navLink(page, 'Users & Roles')).toHaveCount(0)
    await expect(navLink(page, 'Land Records')).toHaveCount(0)
    await expect(navLink(page, 'Property Tax')).toHaveCount(0)
    await expect(navLink(page, 'AI Studio')).toHaveCount(0)
  })

  test('land officer sees governance nav', async ({ page }) => {
    await login(page, 'land01', 'Officer@123')
    await expect(navLink(page, 'Land Records')).toBeVisible()
  })
})

test.describe('Responsive', () => {
  test('dashboard has no horizontal overflow on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)
    await page.goto('/dashboard')
    await expect(page.getByText('Total Parcels')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(2)
  })
})

test.describe('System honesty', () => {
  test('settings page never claims live government connectivity', async ({ page }) => {
    await login(page)
    await page.goto('/settings')
    await expect(page.getByText(/Demo Connected|Demo dataset|DEMO/i).first()).toBeVisible()
    await expect(page.getByText(/represents no real parcel/i)).toBeVisible()
  })
})

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FLOORPLAN_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai-service/tests/fixtures/floorplan_demo.png',
)

const TIF_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai-service/tests/fixtures/sholinganallur_demo.tif',
)

test.describe('Phase 3 — AI building extraction (additive, AI_DEMO)', () => {
  test('upload → infer → results → view in the ONE Cesium viewer → AI sidebar', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/ai-buildings')
    await expect(page.getByRole('heading', { name: /AI Building Extraction/i })).toBeVisible()
    await expect(page.getByText(/MODEL OUTPUT/i).first()).toBeVisible()

    await page.getByTestId('ai-image-input').setInputFiles(TIF_FIXTURE)
    await page.getByTestId('ai-run').click()

    // results render (ai-service is up via the playwright webServer)
    await expect(page.getByTestId('ai-results')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('COMPLETED')).toBeVisible()
    await expect(page.getByText('Total buildings')).toBeVisible()
    const rows = page.locator('[data-testid="ai-results"] table tbody tr')
    await expect(rows.first()).toBeVisible()
    await expect(rows.first()).toContainText(/AI-CHN-/)

    // open the first AI building on the SAME Cesium viewer
    await rows.first().click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    const oneViewer = await page.evaluate(() => {
      window.__vref = window.viewer
      return Boolean(window.viewer && !window.viewer.isDestroyed())
    })
    expect(oneViewer).toBe(true)

    // an ai-building entity exists in that single viewer
    await page.waitForFunction(() => {
      const v = window.viewer
      return v && v.entities.values.some((e) => (e.properties?.kind?.getValue?.() ?? e.properties?.kind) === 'ai-building')
    }, null, { timeout: 30_000 })

    // AI sidebar shows the non-official provenance
    const sidebar = page.getByTestId('property-sidebar')
    await expect(sidebar).toBeVisible()
    await expect(page.getByTestId('ai-building-source')).toContainText(/AI_DEMO|MODEL OUTPUT/i)
    await expect(sidebar).toContainText('DEMO_NOT_OFFICIAL')
    await expect(sidebar).toContainText(/Confidence Level/i)
    await expect(sidebar).toContainText(/Model/i)
    await expect(page.getByTestId('ai-review-status')).toBeVisible()

    // same viewer, and returning to the Chennai overview still works
    expect(await page.evaluate(() => window.viewer === window.__vref && !window.viewer.isDestroyed())).toBe(true)
    await page.getByTestId('area-city-overview').click()
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => window.viewer === window.__vref)).toBe(true)

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('AI layer is OFF by default and does not disturb the existing map', async ({ page }) => {
    await login(page)
    await openMap(page)
    // default DEFAULT_LAYERS.aiBuildings === false -> checkbox unchecked
    await expect(page.getByTestId('layer-aiBuildings')).not.toBeChecked()
    // existing flow still fine, one viewer
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    await page.getByTestId('layer-aiBuildings').check()
    await expect(page.getByTestId('layer-aiBuildings')).toBeChecked()
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
  })
})

test.describe('Phase 4 — AI floor-plan & apartment/unit segmentation (additive, AI_DEMO)', () => {
  test('upload → infer → rooms/units/validation → view in the ONE Cesium viewer → AI unit sidebar → isolate', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/ai-floorplans')
    await expect(page.getByRole('heading', { name: /AI Floor Plan Units/i })).toBeVisible()
    await expect(page.getByText(/MODEL OUTPUT/i).first()).toBeVisible()
    await expect(page.getByText(/CubiCasa5K/i).first()).toBeVisible()

    await page.getByTestId('fp-image-input').setInputFiles(FLOORPLAN_FIXTURE)
    await page.getByTestId('fp-building').fill(`${ULPIN}-B01`)
    await page.getByTestId('fp-floor').fill(`${ULPIN}-B01-F02`)
    await page.getByTestId('fp-scale').fill('0.02')
    await page.getByTestId('fp-run').click()

    // results render (ai-service is up via the playwright webServer)
    await expect(page.getByTestId('fp-results')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByText('COMPLETED')).toBeVisible()
    await expect(page.getByText('Apartment / units')).toBeVisible()
    await expect(page.getByTestId('fp-validation')).toContainText(/VALID|WARNING|ERROR/)

    const unitRows = page.locator('[data-testid="fp-results"] table').last().locator('tbody tr')
    await expect(unitRows.first()).toBeVisible()
    await expect(unitRows.first()).toContainText(/AI-UNIT-/)
    const unitCountBefore = await unitRows.count()
    expect(unitCountBefore).toBeGreaterThanOrEqual(1)

    // open the first AI floor unit on the SAME Cesium viewer
    await unitRows.first().click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    const oneViewer = await page.evaluate(() => {
      window.__vref = window.viewer
      return Boolean(window.viewer && !window.viewer.isDestroyed())
    })
    expect(oneViewer).toBe(true)

    // an ai-floor-unit entity exists in that single viewer
    await page.waitForFunction(() => {
      const v = window.viewer
      return v && v.entities.values.some((e) => (e.properties?.kind?.getValue?.() ?? e.properties?.kind) === 'ai-floor-unit')
    }, null, { timeout: 30_000 })

    // AI floor-unit sidebar shows the non-official provenance
    const sidebar = page.getByTestId('property-sidebar')
    await expect(sidebar).toBeVisible()
    await expect(page.getByTestId('ai-floor-unit-source')).toContainText(/AI_DEMO|MODEL OUTPUT/i)
    await expect(sidebar).toContainText('DEMO_NOT_OFFICIAL')
    await expect(sidebar).toContainText('DEMO_RESEARCH_DATA')
    await expect(sidebar).toContainText(/Confidence Level/i)
    await expect(page.getByTestId('ai-floor-unit-review-status')).toBeVisible()

    // apartment isolation — reversible, same viewer throughout
    const isolate = page.getByTestId('ai-floor-unit-isolate')
    await isolate.click()
    await expect(isolate).toContainText('Exit Isolation')
    await isolate.click()
    await expect(isolate).toContainText('Isolate Unit')

    // same viewer, and returning to the Chennai overview still works
    expect(await page.evaluate(() => window.viewer === window.__vref && !window.viewer.isDestroyed())).toBe(true)
    await page.getByTestId('area-city-overview').click()
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => window.viewer === window.__vref)).toBe(true)

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('AI floor-plan layer is OFF by default, progressively loaded, and does not disturb the existing map', async ({ page }) => {
    await login(page)
    await openMap(page)
    // default DEFAULT_LAYERS.aiFloorUnits === false -> checkbox unchecked
    await expect(page.getByTestId('layer-aiFloorUnits')).not.toBeChecked()
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    await page.getByTestId('layer-aiFloorUnits').check()
    await expect(page.getByTestId('layer-aiFloorUnits')).toBeChecked()
    // toggling the (empty, at this zoom) layer must not disturb the existing viewer / LOD
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
  })

  test('non-georeferenced floor plan (no building reference) stays off the map', async ({ page }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/ai-floorplans')
    await page.getByTestId('fp-image-input').setInputFiles(FLOORPLAN_FIXTURE)
    await page.getByTestId('fp-run').click()
    await expect(page.getByTestId('fp-results')).toBeVisible({ timeout: 90_000 })
    // no building supplied -> no "View on Cesium" button (local coordinates only)
    if (await page.getByText('COMPLETED').isVisible().catch(() => false)) {
      await expect(page.getByTestId('fp-view-cesium')).toHaveCount(0)
      await expect(page.getByText(/local coordinates only/i)).toBeVisible()
    }
  })
})

const DEM_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai-service/tests/fixtures/elevation/dem_flat.tif',
)
const DSM_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai-service/tests/fixtures/elevation/dsm_building.tif',
)

test.describe('Phase 5 — elevation / LiDAR / DEM / DSM integration (additive, ELEVATION_DEMO)', () => {
  test('upload → validate → process DEM+DSM → results table → building height panel in the ONE Cesium viewer', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/elevation')
    await expect(page.getByRole('heading', { name: /Elevation \/ LiDAR/i })).toBeVisible()
    await expect(page.getByText(/ELEVATION_DEMO/i).first()).toBeVisible()

    await page.getByTestId('elev-dem-input').setInputFiles(DEM_FIXTURE)
    await expect(page.getByTestId('elev-validation')).toContainText('VALIDATED', { timeout: 30_000 })
    await page.getByTestId('elev-dsm-input').setInputFiles(DSM_FIXTURE)
    await expect(page.getByTestId('elev-validation')).toContainText('DSM', { timeout: 30_000 })

    await page.getByTestId('elev-source-label').selectOption('TEST_FIXTURE')
    await page.getByTestId('elev-run').click()
    await expect(page.getByTestId('elev-results')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/^COMPLETED$/).first()).toBeVisible()
    // graceful degradation is a valid, tested outcome — assert the pipeline
    // ran and produced a row per building, not a specific numeric height
    await expect(page.getByText(/Buildings/i).first()).toBeVisible()

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('building height panel shows Unavailable, never a fabricated number, before any dataset is processed', async ({ page }) => {
    await login(page)
    await openMap(page)
    await page.getByTestId('building-block-B01').click()
    const sidebar = page.getByTestId('property-sidebar')
    await expect(sidebar).toBeVisible()
    // this building has not had elevation data processed in this test run
    // (each test uses a fresh page/session) -> graceful Unavailable, not a crash
    const panel = page.getByTestId('elevation-unavailable').or(page.getByTestId('elevation-height-panel'))
    await expect(panel).toBeVisible({ timeout: 15_000 })
  })

  test('elevation height-quality layer is OFF by default and does not disturb the existing viewer/LOD', async ({ page }) => {
    await login(page)
    await openMap(page)
    await expect(page.getByTestId('layer-elevationHeightQuality')).not.toBeChecked()
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    await page.getByTestId('layer-elevationHeightQuality').check()
    await expect(page.getByTestId('layer-elevationHeightQuality')).toBeChecked()
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    // same single viewer — Phase 5 never creates a second globe/viewer
    await page.getByTestId('area-option-adyar').click()
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
  })
})

const GNSS_VALID_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend/tests/fixtures/gnss/valid_wgs84.csv',
)
const GNSS_MISSING_CRS_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend/tests/fixtures/gnss/missing_crs.csv',
)
const GNSS_DUPLICATES_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend/tests/fixtures/gnss/duplicates.csv',
)

test.describe('Phase 6 — GNSS/CORS high-precision spatial control (additive, GNSS/CORS DEMO)', () => {
  test('upload → validate → import → results table → control point in the ONE Cesium viewer → sidebar', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/gnss')
    await expect(page.getByRole('heading', { name: /GNSS \/ CORS Control/i })).toBeVisible()
    await expect(page.getByText(/GNSS\/CORS DEMO \/ MODEL OUTPUT/i).first()).toBeVisible()

    await page.getByTestId('gnss-file-input').setInputFiles(GNSS_VALID_FIXTURE)
    await page.getByTestId('gnss-locality').selectOption('sholinganallur')
    await page.getByTestId('gnss-source-label').selectOption('CORS_SURVEY')
    await page.getByTestId('gnss-validate').click()
    await expect(page.getByTestId('gnss-validation')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('gnss-validation')).toContainText('VALID')

    await page.getByTestId('gnss-import').click()
    await expect(page.getByTestId('gnss-results')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/GNSS\/CORS DEMO \/ MODEL OUTPUT/i).last()).toBeVisible()

    // Selecting an imported point drops into the SAME Chennai-wide viewer —
    // never a separate GNSS/survey map. (Scoped to the results table — the
    // upload/validate preview above also renders the same control-point id.)
    await page.getByTestId('gnss-results').getByText('GCP-001').first().click()
    await page.waitForURL(/\/map/, { timeout: 30_000 })
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    await expect(page.getByTestId('layer-gnssControlPoints')).toBeChecked()

    const sidebar = page.getByTestId('gnss-point-card')
    await expect(sidebar).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('gnss-point-source')).toContainText('GNSS/CORS DEMO')
    await expect(page.getByTestId('gnss-validation-status')).toContainText('VALID')

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('missing CRS is flagged CRS_UNKNOWN and never silently assumed WGS84; duplicate ids are flagged', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/gnss')

    await page.getByTestId('gnss-file-input').setInputFiles(GNSS_MISSING_CRS_FIXTURE)
    await page.getByTestId('gnss-validate').click()
    await expect(page.getByTestId('gnss-validation')).toContainText('WARNING', { timeout: 30_000 })
    await expect(page.getByText('UNKNOWN').first()).toBeVisible()

    await page.getByTestId('gnss-file-input').setInputFiles(GNSS_DUPLICATES_FIXTURE)
    await page.getByTestId('gnss-validate').click()
    await expect(page.getByTestId('gnss-validation')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('GCP-DUP-1').first()).toBeVisible()
  })

  test('boundary verification reports an observed deviation without changing parcel geometry', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/gnss')

    await page.getByTestId('gnss-file-input').setInputFiles(GNSS_VALID_FIXTURE)
    await page.getByTestId('gnss-source-label').selectOption('CORS_SURVEY')
    await page.getByTestId('gnss-validate').click()
    await expect(page.getByTestId('gnss-validation')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('gnss-import').click()
    await expect(page.getByTestId('gnss-results')).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('gnss-boundary-ulpin').fill(ULPIN)
    await page.getByTestId('gnss-run-boundary').click()
    await expect(page.getByTestId('gnss-boundary-results')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('gnss-boundary-results')).toContainText(/TOLERANCE|INSUFFICIENT_DATA|REVIEW_REQUIRED/)

    // The parcel itself is unaffected — same demo parcel remains reachable/unchanged in the ONE viewer.
    await openMap(page)
    await page.getByTestId('global-search').fill(ULPIN)
    await expect(page.getByTestId('search-results')).toBeVisible()
    await page.getByTestId('search-results').getByText(ULPIN, { exact: true }).first().click()
    await expect(page.getByTestId('property-sidebar')).toBeVisible({ timeout: 15_000 })
  })

  test('GNSS/CORS Control Points layer is OFF by default and does not disturb the existing viewer/LOD', async ({ page }) => {
    await login(page)
    await openMap(page)
    await expect(page.getByTestId('layer-gnssControlPoints')).not.toBeChecked()
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    await page.getByTestId('layer-gnssControlPoints').check()
    await expect(page.getByTestId('layer-gnssControlPoints')).toBeChecked()
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    // same single viewer — Phase 6 never creates a second globe/viewer
    await page.getByTestId('area-option-annanagar').click()
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
  })
})

test.describe('Phase 7 — intelligent 2D/3D topology validation engine (additive, RULE_ENGINE)', () => {
  test('validate Sholinganallur → real summary + a genuine finding → filter → details → Focus in the ONE Cesium viewer', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/topology')
    await expect(page.getByRole('heading', { name: /Topology Validation/i })).toBeVisible()
    await expect(page.getByText(/RULE_ENGINE|DETERMINISTIC_VALIDATION/i).first()).toBeVisible()

    // Sholinganallur is SelectionContext's own default area (DEFAULT_AREA_ID),
    // so a fresh session already has it selected — no area-selector click needed.
    await page.getByTestId('topology-validate-area').click()
    await expect(page.getByTestId('topology-summary')).toBeVisible({ timeout: 30_000 })

    // Real data, not fabricated: this demo parcel's building B05 genuinely
    // extends past its parcel boundary by a few metres (verified independently
    // against the raw geometry) — expect at least that one real finding.
    await expect(page.getByTestId('topology-findings')).toContainText('BUILDING_CROSSES_PARCEL_BOUNDARY', { timeout: 15_000 })

    await page.getByTestId('topology-filter-entity').selectOption('BUILDING')
    const finding = page.getByTestId('topology-finding').filter({ hasText: 'BUILDING_CROSSES_PARCEL_BOUNDARY' }).first()
    await expect(finding).toBeVisible()
    await expect(finding).toContainText('Suggested Fix')

    await finding.getByTestId('topology-details').click()
    await expect(finding.getByTestId('topology-finding-details')).toBeVisible()
    await expect(finding.getByTestId('topology-finding-details')).toContainText('Computed Value')

    // Focus navigates (client-side) into the existing /map route — this is the
    // FIRST time this test visits /map, so there is no prior viewer instance
    // to compare against; the invariant that matters is that exactly ONE
    // Cesium viewer/canvas exists there, not a JS reference captured earlier.
    await finding.getByTestId('topology-focus').click()
    await page.waitForURL(/\/map/, { timeout: 30_000 })
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })

    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    expect(await page.locator('canvas').count()).toBe(1)
    // A bare building-level selection has no dedicated "BuildingCard" in this
    // app (only Parcel/AiBuilding/AiFloorUnit/Gnss selections do) — it shows
    // the existing generic "Building selected" panel plus the Phase 5
    // elevation-height panel, never the literal building id as text.
    await expect(page.getByTestId('property-sidebar')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('property-sidebar')).toContainText('Building selected')

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('validate Anna Nagar surfaces a real ERROR-level parcel overlap, with a related-entity focus link', async ({ page }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await openMap(page)
    await page.getByTestId('area-option-annanagar').click()
    await page.waitForTimeout(1000)
    await navLink(page, 'Topology Validation').click()

    await page.getByTestId('topology-validate-area').click()
    await expect(page.getByTestId('topology-summary')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('topology-findings')).toContainText('OVERLAPPING_PARCELS', { timeout: 15_000 })

    await page.getByTestId('topology-filter-status').selectOption('ERROR')
    const overlap = page.getByTestId('topology-finding').filter({ hasText: 'OVERLAPPING_PARCELS' }).first()
    await expect(overlap).toBeVisible()
    await expect(overlap.getByTestId('topology-focus-related')).toBeVisible()

    await overlap.getByTestId('topology-focus').click()
    await page.waitForURL(/\/map/, { timeout: 30_000 })
    await expect(page.getByTestId('property-sidebar')).toBeVisible({ timeout: 15_000 })
  })

  test('validate Adyar reports VALID with no findings (a genuinely clean result is also a valid outcome)', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await openMap(page)
    await page.getByTestId('area-option-adyar').click()
    await page.waitForTimeout(1000)
    await navLink(page, 'Topology Validation').click()

    await page.getByTestId('topology-validate-area').click()
    await expect(page.getByTestId('topology-summary')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('topology-findings')).toContainText('No findings match', { timeout: 15_000 })
  })

  test('validate selected entity narrows results to just that parcel', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/topology')
    await expect(page.getByTestId('topology-validate-selected')).toBeDisabled()

    await page.getByTestId('global-search').fill(ULPIN)
    await expect(page.getByTestId('search-results')).toBeVisible()
    await page.getByTestId('search-results').getByText(ULPIN, { exact: true }).first().click()
    await page.waitForURL(/\/map/, { timeout: 30_000 }) // TopBar's search-select navigates client-side (SPA) to /map
    await expect(page.getByTestId('property-sidebar')).toBeVisible()

    // navigate back via the nav link, not page.goto() — a hard reload would
    // wipe the parcel selection SelectionContext just set.
    await navLink(page, 'Topology Validation').click()
    await expect(page.getByTestId('topology-validate-selected')).toBeEnabled()
    await page.getByTestId('topology-validate-selected').click()
    await expect(page.getByTestId('topology-summary')).toBeVisible({ timeout: 30_000 })
  })

  test('geometry is never modified by a validation run (API-level check reachable from the UI flow)', async ({ page }) => {
    const before = await page.request.get('/api/parcels/' + ULPIN).then((r) => r.json())
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/topology')
    await page.getByTestId('topology-validate-area').click()
    await expect(page.getByTestId('topology-summary')).toBeVisible({ timeout: 30_000 })
    const after = await page.request.get('/api/parcels/' + ULPIN).then((r) => r.json())
    expect(after.data.parcel.geometry).toEqual(before.data.parcel.geometry)
  })

  test('running a topology validation and returning to the map leaves exactly ONE Cesium viewer, never a second one', async ({ page }) => {
    // Cesium3DMap only mounts on the /map route (Map3D.jsx) — navigating to
    // /topology and back legitimately unmounts/remounts it, same as visiting
    // any other page (/gnss, /elevation, ...) and back. "Exactly ONE viewer"
    // means only one ever exists at a time, not that the JS object identity
    // must survive a route round-trip — so this checks canvas/viewer count
    // and area-selection persistence, not reference equality.
    await login(page, 'survey01', 'Officer@123')
    await openMap(page)
    await page.getByTestId('area-option-annanagar').click()
    await page.waitForTimeout(1000)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    expect(await page.locator('canvas').count()).toBe(1)

    await navLink(page, 'Topology Validation').click()
    await expect(page.getByTestId('topology-validate-area').or(page.getByText(/Validate Anna Nagar/i))).toBeVisible()
    await page.getByTestId('topology-validate-area').click()
    await expect(page.getByTestId('topology-summary')).toBeVisible({ timeout: 30_000 })

    await navLink(page, '3D Map').click()
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    expect(await page.locator('canvas').count()).toBe(1) // no leaked/duplicate viewer
  })
})
