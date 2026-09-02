import {
  test,
  expect,
  gotoApp,
  getTileset,
  countTilesets,
  tilesetPresent,
  waitForBuildings,
  flyTo,
  cameraCartographic,
  selectBuilding,
} from './helpers.js'

// Dense Chennai spot (T. Nagar) used for building-picking tests.
const DENSE = { lon: 80.2337, lat: 13.0405, height: 550 }

test.describe('Application load', () => {
  test('loads, mounts Cesium, no fatal JS errors', async ({ page, diag }) => {
    await gotoApp(page)
    await expect(page.getByText('3D ULPIN')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()

    const state = await page.evaluate(() => ({
      hasViewer: !!window.viewer && !window.viewer.isDestroyed(),
      hasScene: !!(window.viewer && window.viewer.scene),
    }))
    expect(state.hasViewer).toBe(true)
    expect(state.hasScene).toBe(true)

    const { pageErrors, consoleErrors } = diag.fatal()
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })

  test('no blank screen — header, controls and data panel render', async ({ page }) => {
    await gotoApp(page)
    await expect(page.getByRole('button', { name: 'Reset View' })).toBeVisible()
    await expect(page.getByRole('button', { name: /3D Buildings/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Terrain/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Satellite/ })).toBeVisible()
    await expect(page.getByLabel('Data sources')).toBeVisible()
  })
})

test.describe('Cesium / Chennai / 3D buildings', () => {
  test('OSM building tileset is present, ready and singular', async ({ page }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, DENSE.height)
    await waitForBuildings(page, 3)

    const ts = await getTileset(page)
    expect(ts).not.toBeNull()
    expect(ts.show).toBe(true)
    expect(ts.tilesReady).toBeGreaterThan(0) // buildings actually loaded
    expect(ts.mse).toBe(12) // our density tuning applied
    expect(ts.dynamicSse).toBe(true)

    expect(await countTilesets(page), 'exactly one OSM building tileset').toBe(1)
  })

  test('initial camera sits over Chennai with a 3D (tilted) perspective', async ({ page }) => {
    await gotoApp(page)
    const cam = await cameraCartographic(page)
    expect(cam.finite).toBe(true)
    expect(cam.lon).toBeGreaterThan(79.8)
    expect(cam.lon).toBeLessThan(80.8)
    expect(cam.lat).toBeGreaterThan(12.7)
    expect(cam.lat).toBeLessThan(13.4)
    expect(cam.height).toBeLessThan(20_000) // not a global/space view
    const pitch = await page.evaluate(() =>
      window.Cesium.Math.toDegrees(window.viewer.camera.pitch),
    )
    expect(pitch).toBeLessThan(-8) // looking down at an angle, not straight nadir edge case
    expect(pitch).toBeGreaterThan(-89)
  })
})

test.describe('Camera navigation / scroll', () => {
  test('mouse wheel zooms the real 3D camera in and out', async ({ page }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, 1500)
    const box = await page.getByTestId('cesium-container').boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)

    const h0 = (await cameraCartographic(page)).height
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, -240) // scroll up => zoom toward city
      await page.waitForTimeout(120)
    }
    const h1 = (await cameraCartographic(page)).height
    expect(h1, 'scroll up should reduce camera height').toBeLessThan(h0)

    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 240) // scroll down => zoom away
      await page.waitForTimeout(120)
    }
    const h2 = (await cameraCartographic(page)).height
    expect(h2, 'scroll down should increase camera height').toBeGreaterThan(h1)

    const cam = await cameraCartographic(page)
    expect(cam.finite).toBe(true)
    expect(cam.destroyed).toBe(false)
  })

  test('camera inputs are enabled by default', async ({ page }) => {
    await gotoApp(page)
    const ssc = await page.evaluate(() => {
      const c = window.viewer.scene.screenSpaceCameraController
      return { inputs: c.enableInputs, zoom: c.enableZoom, rotate: c.enableRotate, tilt: c.enableTilt }
    })
    expect(ssc).toEqual({ inputs: true, zoom: true, rotate: true, tilt: true })
  })
})

test.describe('Building selection & property panel', () => {
  test('clicking a building opens the Unified Property Record with demo hierarchy', async ({ page, diag }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, DENSE.height, -32)

    const sel = await selectBuilding(page)
    expect(sel, 'a building feature was picked').not.toBeNull()

    const panel = page.getByTestId('property-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Unified Property Record')).toBeVisible()
    await expect(panel.getByText(/DEMO \/ prototype data/)).toBeVisible()
    await expect(page.getByTestId('verification-score')).toBeVisible()
    await expect(panel.getByText('Parcel / Land')).toBeVisible()
    await expect(panel.getByText('Building', { exact: true })).toBeVisible()

    // Hierarchy section: expand and check a Unit PIN is shown.
    await panel.getByRole('button', { name: /Hierarchy/ }).click()
    await expect(panel.getByText(/UNIT-BLD/).first()).toBeVisible()
    await expect(panel.getByText(/DEMO-ULPIN-/).first()).toBeVisible()

    // The open panel must not cover / block the top-right map controls.
    await page.getByRole('button', { name: 'Dashboard' }).click()
    await expect(page.getByTestId('dashboard-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Dashboard' }).click()

    // Close button restores things.
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel).toBeHidden()

    const { pageErrors } = diag.fatal()
    expect(pageErrors).toEqual([])
  })
})

test.describe('Focus Building', () => {
  test('Focus flies to the building and stays local to Chennai', async ({ page, diag }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, DENSE.height, -32)
    expect(await selectBuilding(page)).not.toBeNull()

    await page.getByRole('button', { name: 'Focus Building' }).click()
    await page.waitForTimeout(2500)

    const cam = await cameraCartographic(page)
    expect(cam.finite).toBe(true)
    expect(cam.destroyed).toBe(false)
    expect(cam.lon).toBeGreaterThan(79.8)
    expect(cam.lon).toBeLessThan(80.8)
    expect(cam.lat).toBeGreaterThan(12.7)
    expect(cam.lat).toBeLessThan(13.4)
    expect(cam.height).toBeLessThan(4000)

    const { pageErrors } = diag.fatal()
    expect(pageErrors).toEqual([])
  })
})

test.describe('360° orbit — white-screen regression', () => {
  test('start / pause / resume / exit without breaking the renderer', async ({ page, diag }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, DENSE.height, -30)
    expect(await selectBuilding(page)).not.toBeNull()

    const frames0 = await page.evaluate(() => window.viewer.scene.frameState.frameNumber)

    await page.getByRole('button', { name: '360° View' }).click()
    await expect(page.getByTestId('orbit-controls')).toBeVisible()
    await page.waitForTimeout(2500)

    // Renderer still alive & advancing frames (no white screen / frozen scene).
    const mid = await page.evaluate(() => ({
      destroyed: window.viewer.isDestroyed(),
      frames: window.viewer.scene.frameState.frameNumber,
      camFinite: Number.isFinite(window.viewer.camera.positionWC.x),
    }))
    expect(mid.destroyed).toBe(false)
    expect(await tilesetPresent(page), 'building tileset not removed by 360°').toBe(true)
    expect(mid.camFinite).toBe(true)
    expect(mid.frames).toBeGreaterThan(frames0)

    // Orbit actually moves the camera heading over time.
    const hA = await page.evaluate(() => window.viewer.camera.heading)
    await page.waitForTimeout(1500)
    const hB = await page.evaluate(() => window.viewer.camera.heading)
    expect(Math.abs(hA - hB)).toBeGreaterThan(0.001)

    await page.getByRole('button', { name: 'Pause' }).click()
    const hP1 = await page.evaluate(() => window.viewer.camera.heading)
    await page.waitForTimeout(1200)
    const hP2 = await page.evaluate(() => window.viewer.camera.heading)
    expect(Math.abs(hP1 - hP2), 'camera is stationary while paused').toBeLessThan(0.02)

    await page.getByRole('button', { name: 'Resume' }).click()
    await page.waitForTimeout(1200)
    const hR = await page.evaluate(() => window.viewer.camera.heading)
    expect(Math.abs(hR - hP2), 'orbit resumes').toBeGreaterThan(0.001)

    await page.getByRole('button', { name: 'Exit 360°' }).click()
    await expect(page.getByTestId('orbit-controls')).toBeHidden()
    await page.waitForTimeout(1500)

    const after = await cameraCartographic(page)
    expect(after.destroyed).toBe(false)
    expect(after.finite).toBe(true)
    expect(after.lon).toBeGreaterThan(79.8)
    expect(after.lon).toBeLessThan(80.8)
    expect(after.lat).toBeGreaterThan(12.7)
    expect(after.lat).toBeLessThan(13.4)

    const inputsBack = await page.evaluate(
      () => window.viewer.scene.screenSpaceCameraController.enableInputs,
    )
    expect(inputsBack, 'camera controls restored after 360°').toBe(true)

    const { pageErrors, consoleErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
    const devErrors = consoleErrors.filter((t) => /DeveloperError|RuntimeError|NaN/.test(t))
    expect(devErrors, devErrors.join('\n')).toEqual([])
  })
})

test.describe('Layer controls', () => {
  test('buildings / terrain / satellite / parcels toggles work', async ({ page }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, 1200)
    await waitForBuildings(page, 1)

    const btnBuildings = page.getByRole('button', { name: /3D Buildings/ })
    await btnBuildings.click()
    await expect(btnBuildings).toHaveAttribute('aria-pressed', 'false')
    expect((await getTileset(page)).show).toBe(false)
    await btnBuildings.click()
    await expect(btnBuildings).toHaveAttribute('aria-pressed', 'true')

    const btnSat = page.getByRole('button', { name: /Satellite/ })
    await btnSat.click()
    await expect(btnSat).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => window.viewer.imageryLayers.get(0).show)).toBe(false)
    await btnSat.click()

    const btnTerrain = page.getByRole('button', { name: /Terrain/ })
    await btnTerrain.click()
    await expect(btnTerrain).toHaveAttribute('aria-pressed', 'false')
    await page.waitForTimeout(500)
    await btnTerrain.click()
    await expect(btnTerrain).toHaveAttribute('aria-pressed', 'true')

    const btnParcels = page.getByRole('button', { name: /Parcels/ })
    await btnParcels.click()
    await expect(btnParcels).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => window.viewer.entities.values.length)).toBeGreaterThan(0)
    await btnParcels.click()
    expect(await page.evaluate(() => window.viewer.entities.values.length)).toBe(0)
  })
})

test.describe('Search', () => {
  test('search finds a demo parcel and flies the camera to it', async ({ page }) => {
    await gotoApp(page)
    const input = page.getByLabel('Search demo property records')
    await input.fill('Adyar')
    await expect(page.getByTestId('search-results')).toBeVisible()
    const result = page.getByRole('button', { name: /PCL-CHN-118/ })
    await expect(result).toBeVisible()
    await result.click()
    await page.waitForTimeout(2500)

    const cam = await cameraCartographic(page)
    expect(cam.finite).toBe(true)
    // Adyar demo coords ~ 80.2565 / 13.0068
    expect(cam.lon).toBeGreaterThan(80.15)
    expect(cam.lon).toBeLessThan(80.36)
    expect(cam.lat).toBeGreaterThan(12.92)
    expect(cam.lat).toBeLessThan(13.08)
  })

  test('search with no match shows an empty state', async ({ page }) => {
    await gotoApp(page)
    const input = page.getByLabel('Search demo property records')
    await input.fill('zzzznomatch')
    await expect(page.getByTestId('search-results')).toContainText('No demo records match')
  })
})

test.describe('Dashboard', () => {
  test('dashboard opens with KPI cards and a chart', async ({ page }) => {
    await gotoApp(page)
    await page.getByRole('button', { name: 'Dashboard' }).click()
    const dash = page.getByTestId('dashboard-panel')
    await expect(dash).toBeVisible()
    await expect(dash.getByText('Total Parcels')).toBeVisible()
    await expect(dash.getByText('Total Buildings')).toBeVisible()
    await expect(dash.getByText('Total Units')).toBeVisible()
    await expect(dash.getByText(/Properties by land use/)).toBeVisible()
    await expect(dash.locator('.kpi-card')).toHaveCount(8)
    await dash.getByRole('button', { name: 'Close' }).click()
    await expect(dash).toBeHidden()
  })
})

test.describe('Responsive', () => {
  test('renders on a narrow viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 896 })
    await gotoApp(page)
    await expect(page.getByText('3D ULPIN')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(2)
  })
})

test.describe('Network', () => {
  test('no unexpected 4xx/5xx on core assets', async ({ page, diag }) => {
    await gotoApp(page)
    await flyTo(page, DENSE.lon, DENSE.lat, 1000)
    await page.waitForTimeout(3000)
    const { failedRequests } = diag.fatal()
    // Allow individual tile 404s (filtered as benign); flag anything else.
    const serious = failedRequests.filter((t) => !/\b404\b/.test(t) || /main\.jsx|App\.jsx|\.css|localhost:5180/.test(t))
    expect(serious, serious.join('\n')).toEqual([])
  })
})
