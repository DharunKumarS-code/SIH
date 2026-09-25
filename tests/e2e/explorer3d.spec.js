import { test, expect, login } from './helpers.js'

const ULPIN = 'TN-CHN-123456789'
const PROTO_ID = 'TN-CHN-123456789-B01-F02-U201'

// Phase 10 — Detailed 3D Building Explorer. Opens in a NEW BROWSER TAB from a
// unit record, receives the selected property through a deep link, renders a
// focused Three.js massing view of ONE building, and never disturbs the single
// Chennai CesiumJS viewer it was launched from.

test.describe('Phase 10 — detailed 3D Building Explorer (new tab, Three.js)', () => {
  test('unit sidebar → opens explorer in a new tab with the deep link → loads clean → close leaves the map intact', async ({ page, context, diag }) => {
    test.slow()
    await login(page)

    // Drill Parcel → Building B01 → Floor F02 → Unit U201 on the ONE Cesium viewer.
    await page.goto('/ulpin-search')
    await page.getByRole('textbox').first().fill(ULPIN)
    await page.getByRole('button', { name: /Search/i }).click()
    await page.getByRole('button', { name: /Explore in 3D/i }).click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    await page.evaluate(() => { window.__vref = window.viewer })

    await page.getByTestId('building-block-B01').click()
    await page.getByTestId('floor-row-F02').click()
    await page.getByTestId('floorplan-unit-U201').click()
    await expect(page.getByTestId('proto-id')).toContainText(PROTO_ID)

    // "Open 3D Building Explorer" opens a NEW TAB.
    const [explorer] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('open-3d-explorer').click(),
    ])
    await explorer.waitForLoadState('domcontentloaded')

    // Correct property/building/floor/unit transferred through the deep link.
    const url = new URL(explorer.url())
    expect(url.pathname).toBe('/3d-explorer')
    expect(url.searchParams.get('ulpin')).toBe(ULPIN)
    expect(url.searchParams.get('buildingId')).toBe('B01')
    expect(url.searchParams.get('floorId')).toBe('F02')
    expect(url.searchParams.get('unitId')).toBe('U201')
    expect(url.searchParams.get('area')).toBe('sholinganallur')

    // Explorer renders: masthead, prototype labelling, the 3D scene, and the
    // selected hierarchy — all from the existing backend.
    await expect(explorer.getByRole('heading', { name: '3D Building Explorer' })).toBeVisible()
    await expect(explorer.getByText(/Not an Official ULPIN/i).first()).toBeVisible()
    await expect(explorer.getByTestId('building-scene')).toBeVisible({ timeout: 30_000 })
    await expect(explorer.locator('[data-testid="building-scene"] canvas')).toBeVisible({ timeout: 30_000 })
    await expect(explorer.getByTestId('explorer-floor-list')).toContainText('Floor 02')
    await expect(explorer.getByTestId('explorer-unit-list')).toContainText('U201')
    await expect(explorer.getByText(PROTO_ID).first()).toBeVisible()
    // Volume / provenance panel present and honestly labelled.
    await expect(explorer.getByText('3D volume information')).toBeVisible()
    await expect(explorer.getByText(/PROTOTYPE \/ AI_DERIVED/)).toBeVisible()

    // Phase 9 — Proposed 3D Property Identifier is shown at BUILDING level
    // (reusing the same identifier3d service as the unit-level sidebar panel),
    // and the officialULPIN it displays is exactly what the backend returned —
    // never a fabricated/invented value, never labelled as an official ULPIN itself.
    const idPanel = explorer.getByTestId('explorer-identifier')
    await expect(idPanel).toBeVisible()
    await expect(idPanel).toContainText('3DPR:')
    await expect(idPanel).toContainText('Official ULPIN')
    await expect(idPanel).toContainText(ULPIN)
    await expect(explorer.getByText(/not an Official 3D ULPIN/i)).toBeVisible()
    await expect(explorer.getByTestId('explorer-identifier-unavailable')).toHaveCount(0)

    // This building has real seeded floor data — the honest-unavailable path
    // must NOT fire when data actually exists.
    await expect(explorer.getByTestId('explorer-floors-unavailable')).toHaveCount(0)
    await expect(explorer.getByText('Loading floors…')).toHaveCount(0)

    // Floor navigation works inside the explorer.
    await explorer.getByTestId('explorer-floor-F01').click()
    await expect(explorer.getByTestId('explorer-floor-F01')).toHaveClass(/text-primary/)

    // No fatal errors on the explorer tab.
    const explorerErrors = []
    explorer.on('pageerror', (e) => explorerErrors.push(e.stack || String(e)))
    await explorer.waitForTimeout(500)
    expect(explorerErrors, explorerErrors.join('\n')).toEqual([])

    // Closing the explorer must not corrupt the original application state —
    // the ONE Cesium viewer is still alive and is the same instance.
    await explorer.close()
    await page.bringToFront()
    await expect(page.getByTestId('property-sidebar')).toBeVisible()
    expect(await page.evaluate(() => window.viewer === window.__vref && !window.viewer.isDestroyed())).toBe(true)
    expect(await page.locator('canvas').count()).toBe(1)

    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('deep link opens standalone (no app shell) and needs no prior navigation', async ({ page }) => {
    await login(page)
    await page.goto(`/3d-explorer?area=adyar&ulpin=TN-CHN-223456789&buildingId=B01&floorId=F01`)
    await expect(page.getByRole('heading', { name: '3D Building Explorer' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('building-scene')).toBeVisible({ timeout: 30_000 })
    // Standalone chrome — the authenticated portal shell (global search + grouped
    // side navigation) is NOT mounted here; only the breadcrumb nav exists.
    await expect(page.getByTestId('global-search')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'AI Studio', exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    // Return control is always available.
    await expect(page.getByRole('button', { name: /Return to 3D map/i })).toBeVisible()
  })

  test('honest unavailable states when a building has no floor/interior data or proposed identifier', async ({ page }) => {
    // Every currently-seeded Sholinganallur/Adyar/Anna Nagar building has real
    // floor and identifier data, so there is no genuinely "empty" building to
    // point this deep link at without inventing one. Instead this intercepts
    // the SAME real backend responses for building B01 and strips them down —
    // a controlled fixture, not a fabricated building — purely to exercise the
    // UI's honest-unavailable rendering path.
    await login(page)

    await page.route('**/api/buildings/TN-CHN-123456789-B01', async (route) => {
      const res = await route.fetch()
      const json = await res.json()
      json.data.floors = []
      json.data.unitCount = 0
      await route.fulfill({ response: res, json })
    })
    await page.route('**/api/3d-identifiers*', async (route) => {
      await route.fulfill({ json: { ok: true, data: [] } })
    })

    await page.goto('/3d-explorer?area=sholinganallur&ulpin=TN-CHN-123456789&buildingId=B01')
    await expect(page.getByRole('heading', { name: '3D Building Explorer' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('building-scene')).toBeVisible({ timeout: 30_000 })

    // Floors: an explicit "unavailable" once the request settles — never a
    // perpetual "Loading floors…" spinner, and no fabricated floor rows.
    await expect(page.getByTestId('explorer-floors-unavailable')).toBeVisible()
    await expect(page.getByText('Floor data unavailable.')).toBeVisible()
    await expect(page.getByText('Loading floors…')).toHaveCount(0)
    await expect(page.getByTestId('explorer-floor-list').getByRole('button')).toHaveCount(0)

    // Interior / cutaway / floor-plan modes: honest "unavailable" banner, no
    // fabricated interior geometry standing in for missing data.
    await page.getByTestId('explorer-mode-INTERIOR').click()
    await expect(page.getByTestId('explorer-interior-unavailable')).toContainText('INTERIOR DATA UNAVAILABLE')
    await page.getByTestId('explorer-mode-CUTAWAY').click()
    await expect(page.getByTestId('explorer-interior-unavailable')).toBeVisible()
    await page.getByTestId('explorer-mode-FLOOR_PLAN').click()
    await expect(page.getByTestId('explorer-interior-unavailable')).toBeVisible()
    // EXTERIOR always has real footprint/height data — no unavailable banner there.
    await page.getByTestId('explorer-mode-EXTERIOR').click()
    await expect(page.getByTestId('explorer-interior-unavailable')).toHaveCount(0)

    // Proposed 3D Property Identifier: an explicit "unavailable" message, never
    // a fabricated 3DPR: id and never presented as an official ULPIN.
    await expect(page.getByTestId('explorer-identifier-unavailable')).toBeVisible()
    await expect(page.getByText('3D Property Identifier: Unavailable')).toBeVisible()
    await expect(page.getByTestId('explorer-identifier')).toHaveCount(0)

    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)))
    await page.waitForTimeout(500)
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})
