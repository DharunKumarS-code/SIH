// TNGIS / Tamil Nilam — PUBLIC-source parcel-geometry integration E2E.
//
// The running backend serves the discovery test parcel (Sholinganallur survey
// 234) from a bundled public-response fixture, so this spec is deterministic
// and never depends on the live government server. It verifies: the drill-down
// fetch, the OFFICIAL_SOURCE provenance, that the official ULPIN stays
// unavailable (never fabricated), the parcel rendering inside the ONE Cesium
// viewer, the sidebar card, the building relationship, search, and that the
// existing DEMO ULPIN system + Building / Underground explorers are intact.

import { test, expect, login } from './helpers.js'

const RECORD_ID = 'tngis:cadastral_ulpin:113214445'

async function fetchTestParcel(page) {
  await page.goto('/tngis')
  await expect(page.getByRole('heading', { name: 'TNGIS / Tamil Nilam Parcels' })).toBeVisible({ timeout: 40_000 })
  await expect(page.getByText(/PUBLIC TNGIS INTEGRATION/)).toBeVisible()
  // District defaults to Chennai; drill Taluk -> Village -> Survey.
  await expect(page.getByTestId('tngis-district')).toHaveValue('02', { timeout: 20_000 })
  await page.getByTestId('tngis-taluk').selectOption('11')
  await expect(page.getByTestId('tngis-village')).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId('tngis-village').selectOption('013')
  await expect(page.getByTestId('tngis-survey')).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId('tngis-survey').selectOption('234')
  await page.getByTestId('tngis-fetch').click()
  await expect(page.locator('tbody tr', { hasText: RECORD_ID })).toBeVisible({ timeout: 30_000 })
}

test.describe('TNGIS / Tamil Nilam — public-source parcel integration', () => {
  test('fetch → OFFICIAL_SOURCE, no fabricated ULPIN, EPSG:4326, cached + listed', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await fetchTestParcel(page)

    const row = page.locator('tbody tr', { hasText: RECORD_ID })
    await expect(row).toContainText('234')
    await expect(row).toContainText('933868') // village LGD code
    await expect(row).toContainText('EPSG:4326')
    await expect(row).toContainText('OFFICIAL_SOURCE')
    await expect(row).toContainText(/Unavailable \(public source\)/)
    await expect(page.getByText(/official ULPIN UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE/)).toBeVisible()

    const { pageErrors, failedRequests } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(failedRequests, failedRequests.join('\n')).toEqual([])
  })

  test('open on map → renders in the ONE Cesium viewer, sidebar card is honest, geometry matches source', async ({ page, diag }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')
    await fetchTestParcel(page)

    await page.locator('tbody tr', { hasText: RECORD_ID }).click()
    await expect(page).toHaveURL(/\/map/)
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })

    // exactly ONE Cesium viewer
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)
    expect(await page.locator('[data-testid="cesium-map"] canvas').count()).toBe(1)
    expect(await page.evaluate(() => Boolean(window.viewer && !window.viewer.isDestroyed()))).toBe(true)

    // layer auto-enabled + present in the layer manager
    await expect(page.getByTestId('layer-tngisParcels')).toBeChecked()

    // the parcel polygons are in the scene, and the first drawn vertex equals
    // the first coordinate of the public get_geom response (geometry preserved).
    const scene = await page.evaluate(() => {
      const v = window.viewer
      let shown = 0
      let firstDeg = null
      for (const e of v.entities.values) {
        const k = e.properties?.kind?.getValue?.() ?? e.properties?.kind
        if (k !== 'tngis-parcel' || !e.show) continue
        shown += 1
        if (!firstDeg) {
          const h = e.polygon?.hierarchy?.getValue?.(Cesium.JulianDate.now())
          const pos = (h && (h.positions || h)) || []
          if (pos.length) {
            const c = Cesium.Cartographic.fromCartesian(pos[0])
            firstDeg = [+Cesium.Math.toDegrees(c.longitude).toFixed(6), +Cesium.Math.toDegrees(c.latitude).toFixed(6)]
          }
        }
      }
      return { shown, firstDeg }
    })
    expect(scene.shown).toBeGreaterThan(0)
    expect(scene.firstDeg).toEqual([80.237927, 12.896751]) // == source get_geom feature[0] ring[0][0]

    // sidebar card — OFFICIAL SOURCE, admin + LGD, CRS, and NO ULPIN
    const sb = page.getByTestId('property-sidebar')
    await expect(sb).toContainText('TNGIS / Tamil Nilam Parcel')
    await expect(page.getByTestId('tngis-source')).toContainText(/OFFICIAL SOURCE · SOURCE-VERIFIED GEOMETRY/)
    await expect(page.getByTestId('tngis-record-id')).toHaveText(RECORD_ID)
    await expect(sb).toContainText('Sholinganallur (11)')
    await expect(sb).toContainText('933868') // village LGD
    await expect(sb).toContainText('234') // survey number
    await expect(sb).toContainText('EPSG:4326')
    await expect(sb).toContainText('Sub Division')
    await expect(sb).toContainText('Unavailable from public TNGIS source')
    await expect(page.getByTestId('tngis-ulpin')).toContainText(/Unavailable from current public source/)
    await expect(page.getByTestId('tngis-ulpin')).toContainText('UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE')
    await expect(sb).toContainText('OFFICIAL_SOURCE')
    // building relationship section (spatial only)
    await expect(page.getByText(/spatial fact only/i)).toBeVisible()

    // Focus button flies the SAME camera (no second viewer)
    await page.getByTestId('tngis-focus').click()
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => document.querySelectorAll('.cesium-widget').length)).toBe(1)

    const { pageErrors, consoleErrors, failedRequests } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
    expect(failedRequests, failedRequests.join('\n')).toEqual([])
  })

  test('the TNGIS layer can be toggled off in the ONE viewer', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    await fetchTestParcel(page)
    await page.locator('tbody tr', { hasText: RECORD_ID }).click()
    await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })

    const visible = () => page.evaluate(() => {
      let n = 0
      for (const e of window.viewer.entities.values) {
        const k = e.properties?.kind?.getValue?.() ?? e.properties?.kind
        if (k === 'tngis-parcel' && e.show) n += 1
      }
      return n
    })
    await expect.poll(visible, { timeout: 15_000 }).toBeGreaterThan(0)
    await page.getByTestId('layer-tngisParcels').uncheck()
    await expect.poll(visible, { timeout: 10_000 }).toBe(0)
  })

  test('config endpoint states CRS + that ULPIN is not integrated', async ({ page }) => {
    await login(page, 'survey01', 'Officer@123')
    const cfg = await page.evaluate(async () => (await fetch('/api/tngis/config')).json())
    expect(cfg.data.sourceCRS).toBe('EPSG:4326')
    expect(cfg.data.officialUlpin).toBe('UNAVAILABLE_FROM_PUBLIC_TNGIS_SOURCE')
    expect(cfg.data.notIntegratedFields).toContain('officialULPIN')
    expect(cfg.data.integratedFields).toContain('geometry')
  })

  test('existing DEMO ULPIN system + Building/Underground explorers are intact', async ({ page }) => {
    test.slow()
    await login(page, 'survey01', 'Officer@123')

    // DEMO parcel still resolves and is still DEMO (not promoted to SOURCE_VERIFIED)
    const parcel = await page.evaluate(async () => (await fetch('/api/parcels/TN-CHN-123456789')).json())
    expect(parcel.data.parcel.ulpin).toBe('TN-CHN-123456789')
    expect(parcel.data.provenance.verificationStatus).not.toBe('SOURCE_VERIFIED')

    // Building Explorer standalone tab still loads
    await page.goto('/3d-explorer?area=sholinganallur&ulpin=TN-CHN-123456789&buildingId=B01')
    await expect(page.getByRole('heading', { name: '3D Building Explorer' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('building-scene')).toBeVisible({ timeout: 30_000 })

    // Underground Explorer standalone tab still loads
    await page.goto('/underground-explorer?area=sholinganallur')
    await expect(page.getByRole('heading', { name: 'Underground Infrastructure Explorer' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-testid="underground-scene"] canvas')).toBeVisible({ timeout: 30_000 })
  })
})
