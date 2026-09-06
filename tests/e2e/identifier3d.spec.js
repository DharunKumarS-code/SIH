// Phase 9 — Proposed 3D Property Identifier E2E (spec section 38).
// Verifies the page, the Official-ULPIN-vs-proposed-identifier distinction, the
// hierarchy, search (identifier + Official ULPIN), geometry version history
// (incl. SUPERSEDED), provenance, the conceptual (never-legal) rights model,
// malformed / invalid-hierarchy / collision rejection, focus in the SINGLE
// Cesium viewer, and the disclaimer.

import { test, expect, login } from './helpers.js'

const SEED_CANON = '3DPR:TN-CHN-123456789:B01:F02:U201:V0201:v2'
const SEED_ULPIN = 'TN-CHN-123456789'

async function openPageAndSelectSeed(page) {
  await page.goto('/identifier')
  await expect(page.getByRole("heading", { level: 1, name: /3D Property Identifier/i })).toBeVisible({ timeout: 40_000 })
  await page.getByTestId('identifier-search-input').fill(SEED_CANON)
  await page.getByRole('button', { name: /^Search$/ }).click()
  await expect(page.getByTestId('identifier-canonical')).toHaveText(SEED_CANON, { timeout: 20_000 })
}

test.describe('Phase 9 — Proposed 3D Property Identifier', () => {
  test('TEST 1 — the 3D Property Identifier page loads', async ({ page, diag }) => {
    await login(page)
    await page.goto('/identifier')
    await expect(page.getByRole("heading", { level: 1, name: /3D Property Identifier/i })).toBeVisible({ timeout: 40_000 })
    await expect(page.getByTestId('identifier-disclaimer')).toBeVisible()
    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('TEST 2 — a valid proposed identifier shows Official ULPIN + Building/Floor/Unit/Volume/Geometry Version', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await expect(page.getByTestId('identifier-official-ulpin')).toContainText(SEED_ULPIN)
    const h = page.getByTestId('identifier-hierarchy')
    await expect(h).toContainText('B01')
    await expect(h).toContainText('F02')
    await expect(h).toContainText('U201')
    await expect(h).toContainText('V0201')
    await expect(h).toContainText(/Geometry Version:\s*v2/)
  })

  test('TEST 3 — search by proposed identifier returns a result', async ({ page }) => {
    await login(page)
    await page.goto('/identifier')
    await page.getByTestId('identifier-search-input').fill(SEED_CANON)
    await page.getByRole('button', { name: /^Search$/ }).click()
    await expect(page.getByTestId('identifier-search-results')).toContainText(SEED_CANON, { timeout: 20_000 })
  })

  test('TEST 4 — selecting a result shows the hierarchy and (on the map) opens PropertySidebar', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await expect(page.getByTestId('identifier-hierarchy')).toBeVisible()
    // Focus routes to /map and reuses the existing unit selection -> sidebar
    await page.getByTestId('identifier-focus').click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    await expect(page.getByTestId('property-sidebar')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('proto-id')).toContainText('TN-CHN-123456789-B01-F02-U201')
    await expect(page.getByTestId('sidebar-identifier')).toContainText(SEED_CANON)
  })

  test('TEST 5 — Focus uses the existing Cesium viewer; exactly ONE canvas', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await page.getByTestId('identifier-focus').click()
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
    const before = await page.evaluate(() => {
      const c = window.viewer.camera.positionCartographic
      return [c.longitude, c.latitude, c.height]
    })
    await page.waitForTimeout(3000)
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
    expect(await page.locator('[data-testid="cesium-map"] canvas').count()).toBe(1)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)
    const after = await page.evaluate(() => {
      const c = window.viewer.camera.positionCartographic
      return [c.longitude, c.latitude, c.height]
    })
    expect(after.join(',') !== before.join(',')).toBe(true)
  })

  test('TEST 6 — look up by Official ULPIN lists associated proposed 3D references', async ({ page }) => {
    await login(page)
    await page.goto('/identifier')
    await page.getByTestId('identifier-ulpin-input').fill(SEED_ULPIN)
    await page.getByTestId('identifier-ulpin-run').click()
    const res = page.getByTestId('identifier-ulpin-results')
    await expect(res).toBeVisible({ timeout: 20_000 })
    await expect(res).toContainText(SEED_CANON)
    await expect(res).toContainText(/replace or upgrade the Official ULPIN/i)
  })

  test('TEST 7 — geometry version history shows v1 and v2', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    const v = page.getByTestId('identifier-versions')
    await expect(v).toContainText('v1')
    await expect(v).toContainText('v2')
  })

  test('TEST 8 — the superseded version remains available', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await expect(page.getByTestId('identifier-versions')).toContainText('SUPERSEDED')
    await expect(page.getByTestId('identifier-versions')).toContainText('ACTIVE')
  })

  test('TEST 9 — DEMO / PROPOSED provenance is clearly displayed', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await expect(page.getByTestId('identifier-canonical').locator('..')).toContainText(/PROPOSED \/ RESEARCH/i)
    const card = page.locator('[data-testid="identifier-detail-disclaimer"]').locator('..')
    await expect(card).toContainText('PROPOSED')
    await expect(card).toContainText('DEMO')
    await expect(card).not.toContainText('Official ULPIN: OFFICIAL')
  })

  test('TEST 10 — no legal ownership is inferred from a demo record', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    const rights = page.getByTestId('identifier-rights')
    await expect(rights).toContainText(/NOT_ESTABLISHED/)
    await expect(rights).toContainText(/NOT_PROVIDED/)
    await expect(rights).not.toContainText(/owner has legal rights/i)
    // the conceptual legal-status block is present and shows non-authoritative values
    await expect(page.getByText('Legal status (conceptual only)')).toBeVisible()
    await expect(page.getByTestId('identifier-detail-disclaimer').locator('..')).not.toContainText(/owns (the )?(unit|volume|property|apartment)/i)
  })

  test('TEST 11 — a malformed identifier is rejected', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123') // 3didentifier:validate
    await page.goto('/identifier')
    await page.getByTestId('identifier-validate-input').fill('3DPR:TN-CHN-123456789:B1:F02:U201:V0201:v1')
    await page.getByTestId('identifier-validate-run').click()
    const r = page.getByTestId('identifier-validate-result')
    await expect(r).toContainText('ERROR', { timeout: 20_000 })
    await expect(r).toContainText('ID3D_MALFORMED_IDENTIFIER')
  })

  test('TEST 12 — an invalid hierarchy is rejected', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/identifier')
    await page.getByTestId('identifier-validate-input').fill('3DPR:TN-CHN-123456789:B01:F97:U999:V0201:v1')
    await page.getByTestId('identifier-validate-run').click()
    const r = page.getByTestId('identifier-validate-result')
    await expect(r).toContainText('ERROR', { timeout: 20_000 })
    await expect(r).toContainText(/ID3D_FLOOR_NOT_FOUND|ID3D_UNIT_NOT_FOUND/)
  })

  test('TEST 13 — an identifier collision is reported, never silently renamed', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await page.goto('/identifier')
    // validating an already-stored canonical surfaces the duplicate rule
    await page.getByTestId('identifier-validate-input').fill(SEED_CANON)
    await page.getByTestId('identifier-validate-run').click()
    const r = page.getByTestId('identifier-validate-result')
    await expect(r).toContainText('ID3D_DUPLICATE_IDENTIFIER', { timeout: 20_000 })
  })

  test('TEST 14 — the disclaimer is visible', async ({ page }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await expect(page.getByTestId('identifier-disclaimer')).toContainText(/NOT an officially approved Government of India or Tamil Nadu 3D ULPIN/i)
    await expect(page.getByTestId('identifier-detail-disclaimer')).toContainText(/does not replace the official parcel-level/i)
  })

  test('console / network — no fatal errors on the 3D Property Identifier page', async ({ page, diag }) => {
    await login(page)
    await openPageAndSelectSeed(page)
    await page.getByTestId('identifier-ulpin-run').click()
    await page.waitForTimeout(1500)
    const { pageErrors, consoleErrors, failedRequests } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
    expect(failedRequests, failedRequests.join('\n')).toEqual([])
  })
})
