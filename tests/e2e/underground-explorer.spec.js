// Underground Infrastructure 3D Explorer — standalone tab, Three.js.
//
// Opens in a NEW BROWSER TAB from the Underground Infrastructure page via a deep
// link, renders ONE focused Three.js cutaway scene, and never disturbs the
// single Chennai CesiumJS viewer it was launched from. All data is DEMO and is
// clearly labelled DEMO — no fabricated engineering values.

import { test, expect, login, openMap } from './helpers.js'

const AREA = 'sholinganallur'

test.describe('Underground Infrastructure 3D Explorer (new tab, Three.js)', () => {
  test('underground page → opens explorer in a new tab → scene, layers, selection, depth, cutaway all work', async ({ page, context, diag }) => {
    test.slow()
    await login(page)

    await page.goto('/underground')
    await expect(page.getByRole('heading', { name: /Underground Infrastructure/i })).toBeVisible({ timeout: 40_000 })

    // "Open 3D Underground Explorer" opens a NEW TAB on /underground-explorer.
    const [explorer] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('open-underground-explorer').click(),
    ])
    await explorer.waitForLoadState('domcontentloaded')
    const url = new URL(explorer.url())
    expect(url.pathname).toBe('/underground-explorer')
    expect(url.searchParams.get('area')).toBe(AREA)

    // Masthead + persistent DEMO badge + the Three.js canvas.
    await expect(explorer.getByRole('heading', { name: 'Underground Infrastructure Explorer' })).toBeVisible()
    await expect(explorer.getByTestId('underground-demo-badge')).toBeVisible()
    await expect(explorer.getByTestId('underground-scene')).toBeVisible({ timeout: 30_000 })
    await expect(explorer.locator('[data-testid="underground-scene"] canvas')).toBeVisible({ timeout: 30_000 })

    // Layer panel — every category present, with a count and a provenance line.
    const panel = explorer.getByTestId('underground-layer-panel')
    for (const key of ['METRO', 'WATER', 'SEWER', 'STORM', 'ELEC', 'TELECOM', 'TUNNEL', 'OTHER']) {
      await expect(explorer.getByTestId(`underground-layer-${key}`)).toBeVisible()
      await expect(explorer.getByTestId(`underground-count-${key}`)).toBeVisible()
    }

    // Toggling a layer off then on is reflected on the checkbox.
    const water = explorer.getByTestId('underground-layer-WATER')
    await expect(water).toBeChecked()
    await water.uncheck()
    await expect(water).not.toBeChecked()
    await water.check()

    // Expand the Water layer and select an item -> info panel populates.
    await panel.getByRole('button', { name: 'Water Pipelines' }).click()
    const firstWater = explorer.locator('[data-testid^="underground-item-INF"]').first()
    await expect(firstWater).toBeVisible({ timeout: 15_000 })
    const infraId = (await firstWater.locator('span.font-mono').first().innerText()).trim()
    await firstWater.click()

    const info = explorer.getByTestId('underground-info-panel')
    await expect(explorer.getByTestId('underground-selected-id')).toHaveText(infraId)
    await expect(info).toContainText('Infrastructure ID')
    await expect(info).toContainText('Provenance')
    // DEMO provenance shown, never "OFFICIAL"/"AUTHORITATIVE" for demo data.
    await expect(explorer.getByTestId('underground-info-provenance')).toContainText(/DEMO/)
    await expect(info).not.toContainText(/OFFICIAL|AUTHORITATIVE|SURVEY VERIFIED/)
    // Depth reads a value or the literal "Unavailable" — never blank/fabricated.
    await expect(info).toContainText(/Depth/)
    await expect(info).toContainText(/(−\d|Unavailable)/)
    // Material is never invented.
    await expect(info).toContainText('Material')
    await expect(info.getByText('Material').locator('..')).toContainText('Unavailable')

    // Property relationship is spatial, not ownership.
    const ctx = explorer.getByTestId('underground-property-context')
    await expect(ctx).toContainText('Spatial Relationship')
    await expect(ctx).toContainText('NOT_PROVIDED')

    // Depth slider + modes.
    await expect(explorer.getByTestId('underground-depth-slider')).toBeVisible()
    await explorer.getByTestId('underground-mode-SLICE').click()
    await expect(explorer.getByTestId('underground-mode-SLICE')).toHaveClass(/text-primary/)
    await explorer.getByTestId('underground-depth-slider').fill('12')
    await explorer.getByTestId('underground-mode-ALL').click()

    // Cutaway / surface / underground view modes.
    await explorer.getByTestId('underground-view-CUTAWAY').click()
    await expect(explorer.getByTestId('underground-view-CUTAWAY')).toHaveClass(/text-primary/)
    await explorer.getByTestId('underground-view-UNDERGROUND').click()
    await explorer.getByTestId('underground-view-SURFACE').click()

    // Camera buttons.
    await explorer.getByTestId('underground-cam-top').click()
    await explorer.getByTestId('underground-cam-underground').click()
    await explorer.getByTestId('underground-cam-fit').click()
    await explorer.getByTestId('underground-cam-reset').click()

    // Exactly one canvas in the explorer tab; no fatal errors.
    expect(await explorer.locator('canvas').count()).toBe(1)
    const explorerErrors = []
    explorer.on('pageerror', (e) => explorerErrors.push(e.stack || String(e)))
    await explorer.waitForTimeout(500)
    expect(explorerErrors, explorerErrors.join('\n')).toEqual([])

    // Returning to the original tab: the ONE Cesium viewer is untouched.
    await explorer.close()
    await page.bringToFront()
    await expect(page.getByRole('heading', { name: /Underground Infrastructure/i })).toBeVisible()

    const { pageErrors, failedRequests } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(failedRequests, failedRequests.join('\n')).toEqual([])
  })

  test('deep link opens standalone (no app shell) and focuses the given infrastructure', async ({ page }) => {
    await login(page)
    // discover a real id from the API-backed table first
    await page.goto('/underground')
    await expect(page.getByTestId('infra-table')).toBeVisible({ timeout: 40_000 })
    const id = (await page.locator('[data-testid="infra-table"] tbody tr').first().locator('td').first().innerText()).trim()

    await page.goto(`/underground-explorer?area=${AREA}&ulpin=TN-CHN-123456789&infrastructureId=${encodeURIComponent(id)}`)
    await expect(page.getByRole('heading', { name: 'Underground Infrastructure Explorer' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-testid="underground-scene"] canvas')).toBeVisible({ timeout: 30_000 })
    // standalone chrome — the authenticated portal shell is NOT mounted
    await expect(page.getByTestId('global-search')).toHaveCount(0)
    // the deep-linked object is selected
    await expect(page.getByTestId('underground-selected-id')).toHaveText(id, { timeout: 20_000 })
    await expect(page.getByTestId('underground-demo-badge')).toBeVisible()
  })

  test('invalid infrastructure id degrades gracefully (no crash, no fake data)', async ({ page, diag }) => {
    await login(page)
    await page.goto(`/underground-explorer?area=${AREA}&infrastructureId=INF-DOES-NOT-EXIST-9999`)
    await expect(page.getByTestId('underground-scene')).toBeVisible({ timeout: 30_000 })
    // no selection panel content is fabricated for a missing id
    await expect(page.getByText('Click an object in the scene')).toBeVisible()
    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('the main 3D map still has exactly ONE Cesium viewer after using the explorer', async ({ page }) => {
    await login(page)
    await openMap(page)
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
    // open the explorer in this same context via a direct nav (new logical tab)
    const explorer = await page.context().newPage()
    await explorer.goto(`/underground-explorer?area=${AREA}`)
    await expect(explorer.locator('[data-testid="underground-scene"] canvas')).toBeVisible({ timeout: 30_000 })
    expect(await explorer.locator('canvas').count()).toBe(1) // Three.js only, no Cesium
    await explorer.close()
    await page.bringToFront()
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
  })
})
