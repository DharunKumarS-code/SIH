import { test as base, expect } from '@playwright/test'

// Console / page-error / network noise we tolerate. These are transient
// third-party imagery/tile CDN hiccups (Cesium retries; imagery still renders)
// and headless-iframe warnings — none of them break the app.
const BENIGN = [
  /favicon\.ico/i,
  /ResizeObserver loop/i,
  /\b404\b.*\.(terrain|json|b3dm|glb|png|jpe?g)\b/i,
  /tile\.googleapis|assets\.ion\.cesium|api\.cesium\.com.*\b404\b/i,
  /Failed to load resource.*\b404\b/i,
  /Blocked script execution in 'about:blank'/i, // Cesium sandboxed iframe, harmless
  /sandboxed and the 'allow-scripts' permission/i,
  // Transient base-imagery CDN failures (Bing / VirtualEarth tiles): CORS /
  // ERR_FAILED on individual tiles. Cesium retries these; the map still renders.
  /virtualearth\.net|dev\.virtualearth\.net|ecn\.t\d\.tiles/i,
  /has been blocked by CORS policy/i,
  /Failed to load resource:.*net::ERR_(FAILED|TIMED_OUT|NETWORK_CHANGED|CONNECTION)/i,
]

export const test = base.extend({
  diag: async ({ page }, use) => {
    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)))
    page.on('requestfailed', (r) => {
      const t = r.failure()?.errorText || ''
      if (!/ERR_ABORTED/.test(t)) failedRequests.push(`${r.url()} :: ${t}`)
    })
    page.on('response', (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`)
    })
    const fatal = () => ({
      consoleErrors: consoleErrors.filter((t) => !BENIGN.some((re) => re.test(t))),
      pageErrors,
      failedRequests: failedRequests.filter((t) => !BENIGN.some((re) => re.test(t))),
      raw: { consoleErrors, failedRequests },
    })
    await use({ fatal })
  },
})

export { expect }

export async function gotoApp(page) {
  await page.goto('/')
  await expect(page.getByTestId('cesium-container')).toBeVisible()
  await page.waitForFunction(() => window.__appReady === true, null, { timeout: 90_000 })
  // Give the first camera flight + a few render frames time to settle.
  await page.waitForTimeout(1500)
}

// `constructor.name` is unreliable — Cesium's class names are mangled in the
// production (minified) bundle. Match on the real class + a duck-type fallback.
export const TILESET_FINDER = `
  (function findTileset() {
    var v = window.viewer;
    if (!v || v.isDestroyed()) return null;
    var TS = window.Cesium && window.Cesium.Cesium3DTileset;
    var prims = v.scene.primitives;
    for (var i = 0; i < prims.length; i += 1) {
      var p = prims.get(i);
      var isTs = p && ((TS && p instanceof TS) ||
        (typeof p.maximumScreenSpaceError === 'number' && 'dynamicScreenSpaceError' in p && p.statistics));
      if (isTs) return p;
    }
    return null;
  })()
`

export async function getTileset(page) {
  return page.evaluate(`
    (() => {
      const p = ${TILESET_FINDER};
      if (!p) return null;
      return {
        tilesReady: p.statistics ? p.statistics.numberOfTilesWithContentReady : 0,
        tilesTotal: p.statistics ? p.statistics.numberOfTilesTotal : 0,
        show: p.show,
        mse: p.maximumScreenSpaceError,
        dynamicSse: p.dynamicScreenSpaceError,
      };
    })()
  `)
}

export async function countTilesets(page) {
  return page.evaluate(`
    (() => {
      const v = window.viewer;
      const TS = window.Cesium && window.Cesium.Cesium3DTileset;
      const prims = v.scene.primitives;
      let n = 0;
      for (let i = 0; i < prims.length; i += 1) {
        const p = prims.get(i);
        if (p && ((TS && p instanceof TS) ||
          (typeof p.maximumScreenSpaceError === 'number' && 'dynamicScreenSpaceError' in p && p.statistics))) n += 1;
      }
      return n;
    })()
  `)
}

export async function tilesetPresent(page) {
  return page.evaluate(`!!${TILESET_FINDER}`)
}

export async function waitForBuildings(page, minTiles = 1) {
  await page.waitForFunction(
    `(() => {
      const p = ${TILESET_FINDER};
      if (!p) return false;
      const n = p.statistics ? p.statistics.numberOfTilesWithContentReady : 0;
      return p.show && n >= ${minTiles};
    })()`,
    null,
    { timeout: 90_000, polling: 500 },
  )
  await page.waitForTimeout(1500)
}

export async function flyTo(page, lon, lat, height, pitchDeg = -35) {
  await page.evaluate(
    ([lo, la, h, pd]) => {
      const { viewer, Cesium } = window
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lo, la, h),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(pd),
          roll: 0,
        },
        duration: 0,
      })
    },
    [lon, lat, height, pitchDeg],
  )
  await page.waitForTimeout(500)
}

export async function cameraCartographic(page) {
  return page.evaluate(() => {
    const { viewer, Cesium } = window
    const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC)
    return {
      lon: Cesium.Math.toDegrees(c.longitude),
      lat: Cesium.Math.toDegrees(c.latitude),
      height: c.height,
      finite:
        Number.isFinite(c.longitude) &&
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.height),
      destroyed: viewer.isDestroyed(),
    }
  })
}

// Wait until an OSM building feature is actually rendered & pickable somewhere
// near the canvas centre, then real-click that exact pixel. This is a reliable
// readiness condition rather than a fixed sleep.
export async function selectBuilding(page) {
  const handle = await page.waitForFunction(
    () => {
      const v = window.viewer
      const C = window.Cesium
      if (!v || v.isDestroyed() || !C) return null
      const cv = v.scene.canvas
      const w = cv.clientWidth
      const h = cv.clientHeight
      const frac = [
        [0, 0], [0.06, 0.05], [-0.06, -0.05], [0.13, -0.08], [-0.13, 0.08],
        [0, 0.16], [0, -0.16], [0.22, 0.03], [-0.22, -0.03], [0.16, 0.16], [-0.16, -0.16],
        [0.3, 0], [-0.3, 0], [0.1, -0.22], [-0.1, 0.22],
      ]
      for (const [fx, fy] of frac) {
        const x = Math.round(w / 2 + fx * w)
        const y = Math.round(h / 2 + fy * h)
        const picked = v.scene.pick(new C.Cartesian2(x, y))
        if (picked && picked instanceof C.Cesium3DTileFeature) return { x, y }
      }
      return null
    },
    null,
    { timeout: 90_000, polling: 1000 },
  )
  const { x, y } = await handle.jsonValue()
  const box = await page.getByTestId('cesium-container').boundingBox()
  await page.mouse.click(box.x + x, box.y + y)
  await page.waitForTimeout(600)
  return page.evaluate(() => window.__lastSelection || null)
}
