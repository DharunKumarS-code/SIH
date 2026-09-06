// Phase 8 — underground 3D infrastructure mapping E2E (spec section 37).
// Verifies the layer, selection, sidebar, Focus, search, depth display,
// provenance, spatial-vs-legal separation, layer toggle, the SINGLE Cesium
// viewer, area navigation, and that a 2D crossing with different Z is not
// reported as a 3D collision.

import { test, expect, login, openMap } from './helpers.js'

const infraEntities = async (page) => page.evaluate(() => {
  const v = window.viewer
  if (!v || v.isDestroyed()) return { total: 0, visible: 0 }
  let total = 0
  let visible = 0
  for (const e of v.entities.values) {
    const k = e.properties?.kind?.getValue?.() ?? e.properties?.kind
    if (k === 'infra') { total += 1; if (e.show) visible += 1 }
  }
  return { total, visible }
})

const enableLayer = async (page) => {
  const cb = page.getByTestId('layer-undergroundInfrastructure')
  if (!(await cb.isChecked())) await cb.check()
  await page.waitForTimeout(1200)
}

test.describe('Phase 8 — Underground Infrastructure', () => {
  test('TEST 1 — the Underground Infrastructure page loads', async ({ page, diag }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByRole('heading', { name: /Underground Infrastructure/i })).toBeVisible({ timeout: 40_000 })
    await expect(page.getByTestId('infra-page-disclaimer')).toContainText(/Spatial intersection does not establish legal ownership/i)
    await expect(page.getByTestId('infra-summary')).toBeVisible()
    await expect(page.getByTestId('infra-table')).toBeVisible()
    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('TEST 2 — enabling the layer makes underground infrastructure visible in the ONE viewer', async ({ page }) => {
    await login(page)
    await openMap(page)
    expect((await infraEntities(page)).visible).toBe(0)
    await enableLayer(page)
    await expect.poll(async () => (await infraEntities(page)).visible, { timeout: 20_000 }).toBeGreaterThan(0)
  })

  test('TEST 3 — selecting infrastructure opens the sidebar with the correct infrastructureId', async ({ page }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    const firstRow = page.locator('[data-testid="infra-table"] tbody tr').first()
    const id = (await firstRow.locator('td').first().innerText()).trim()
    await firstRow.click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    await expect(page.getByTestId('property-sidebar')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('infra-id')).toHaveText(id)
  })

  test('TEST 4 — Focus flies the existing camera to the object (no second viewer)', async ({ page }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    await page.locator('[data-testid="infra-table"] tbody tr').first().click()
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    await expect(page.getByTestId('infra-focus')).toBeVisible()
    const before = await page.evaluate(() => {
      const c = window.viewer.camera.positionCartographic
      return { lon: c.longitude, lat: c.latitude, h: c.height }
    })
    await page.getByTestId('infra-focus').click()
    await page.waitForTimeout(2500)
    const moved = await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))
    expect(moved).toBe(true)
    const after = await page.evaluate(() => {
      const c = window.viewer.camera.positionCartographic
      return { lon: c.longitude, lat: c.latitude, h: c.height }
    })
    expect(after.lon !== before.lon || after.lat !== before.lat || after.h !== before.h).toBe(true)
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
  })

  test('TEST 5 — search resolves an infrastructureId and focuses it', async ({ page }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    const id = (await page.locator('[data-testid="infra-table"] tbody tr').first().locator('td').first().innerText()).trim()
    await page.getByTestId('global-search').fill(id)
    await expect(page.getByTestId('search-results')).toBeVisible()
    await page.getByTestId('search-results').getByText(id, { exact: true }).first().click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    await expect(page.getByTestId('infra-id')).toHaveText(id, { timeout: 30_000 })
  })

  test('TEST 6 — the sidebar shows a depth / elevation reading', async ({ page }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    await page.locator('[data-testid="infra-table"] tbody tr').first().click()
    await expect(page.getByTestId('property-sidebar')).toBeVisible({ timeout: 30_000 })
    const diagram = page.getByTestId('infra-depth-diagram')
    const unknown = page.getByTestId('infra-depth-unknown')
    await expect(diagram.or(unknown)).toBeVisible()
    await expect(page.getByTestId('property-sidebar')).toContainText(/Depth (Below Surface|UNKNOWN)/i)
  })

  test('TEST 7 — DEMO provenance is visible on the selected object', async ({ page }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    // pick a DEMO row (they are the majority)
    await page.locator('[data-testid="infra-table"] tbody tr').first().click()
    await expect(page.getByTestId('infra-source')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('infra-card')).toContainText(/DEMO/)
    await expect(page.getByTestId('infra-disclaimer')).toContainText(/Demonstration data is clearly labelled DEMO/i)
  })

  test('TEST 8 — a parcel intersection does NOT imply ownership', async ({ page }) => {
    await login(page)
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    await page.locator('[data-testid="infra-table"] tbody tr').first().click()
    await expect(page.getByTestId('infra-card')).toBeVisible({ timeout: 30_000 })
    const card = page.getByTestId('infra-card')
    await expect(card).toContainText(/Spatial Relation/i)
    await expect(card).toContainText('NOT_PROVIDED')
    await expect(card).not.toContainText(/owns (the )?(pipeline|infrastructure)/i)
  })

  test('TEST 9 — disabling the layer hides underground infrastructure', async ({ page }) => {
    await login(page)
    await openMap(page)
    await enableLayer(page)
    await expect.poll(async () => (await infraEntities(page)).visible, { timeout: 20_000 }).toBeGreaterThan(0)
    await page.getByTestId('layer-undergroundInfrastructure').uncheck()
    await page.waitForTimeout(1000)
    await expect.poll(async () => (await infraEntities(page)).visible, { timeout: 10_000 }).toBe(0)
  })

  test('TEST 10 — exactly ONE Cesium canvas / viewer exists', async ({ page }) => {
    await login(page)
    await openMap(page)
    await enableLayer(page)
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
    expect(await page.locator('[data-testid="cesium-map"] canvas').count()).toBe(1)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
  })

  test('TEST 11 — Sholinganallur → Adyar → Anna Nagar reuses the same viewer, area-loads, no stale data', async ({ page }) => {
    await login(page)
    await openMap(page)
    await enableLayer(page)
    const viewerId = await page.evaluate(() => { window.__vref = window.viewer; return window.viewer.container.id || 'viewer' })
    const visFor = (area) => page.evaluate((a) => {
      const v = window.viewer
      let visibleWrongArea = 0
      let visibleThisArea = 0
      for (const e of v.entities.values) {
        const k = e.properties?.kind?.getValue?.() ?? e.properties?.kind
        if (k !== 'infra' || !e.show) continue
        if (e.__area === a) visibleThisArea += 1
        else visibleWrongArea += 1
      }
      return { visibleThisArea, visibleWrongArea }
    }, area)

    for (const area of ['adyar', 'annanagar', 'sholinganallur']) {
      await page.getByTestId('area-select').selectOption(area)
      // demand-loading a fresh area runs many sequential fetches — poll, don't guess
      await expect.poll(async () => (await visFor(area)).visibleThisArea, { timeout: 30_000 })
        .toBeGreaterThan(0)
      await expect.poll(async () => (await visFor(area)).visibleWrongArea, { timeout: 10_000 })
        .toBe(0)
      // same viewer object throughout
      expect(await page.evaluate(() => window.__vref === window.viewer && !window.viewer.isDestroyed())).toBe(true)
      expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
    }
    expect(viewerId).toBeTruthy()
  })

  test('TEST 12 — a 2D crossing with different Z is NOT reported as a 3D collision', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123') // infrastructure:validate
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    await page.getByTestId('infra-run-collisions').click()
    await expect(page.getByTestId('infra-collision-results')).toBeVisible({ timeout: 20_000 })
    const results = page.getByTestId('infra-collision-results')
    // the seeded demo network is deliberately collision-free
    await expect(results).toContainText('3D collisions')
    await expect(results).toContainText('2D only')
    // the water × sewer showcase pair is a 2D_INTERSECTION
    await expect(results).toContainText('2D_INTERSECTION')
    await expect(results).not.toContainText('3D_COLLISION')
  })

  test('console / network — no fatal errors while using the underground layer', async ({ page, diag }) => {
    await login(page)
    await openMap(page)
    await enableLayer(page)
    await page.getByTestId('area-select').selectOption('adyar')
    await page.waitForTimeout(2000)
    const { pageErrors, consoleErrors, failedRequests } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
    expect(failedRequests, failedRequests.join('\n')).toEqual([])
  })
})
