import { test as base, expect } from '@playwright/test'

const BENIGN = [
  /favicon/i,
  /ResizeObserver loop/i,
  /\b404\b.*\.(terrain|json|b3dm|glb|png|jpe?g|bin)\b/i,
  /virtualearth\.net|ecn\.t\d\.tiles|assets\.ion\.cesium|tile\.googleapis/i,
  /has been blocked by CORS policy/i,
  /Failed to load resource:.*net::ERR_(FAILED|TIMED_OUT|NETWORK_CHANGED|CONNECTION|ABORTED)/i,
  /Blocked script execution in 'about:blank'/i,
  /Cesium ion/i,
  /\[Deprecation\]/i,
  /Download the React DevTools/i,
]

export const test = base.extend({
  diag: async ({ page }, use) => {
    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
    page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)))
    page.on('response', (r) => {
      if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url()}`)
    })
    const fatal = () => ({
      consoleErrors: consoleErrors.filter((t) => !BENIGN.some((re) => re.test(t))),
      pageErrors: pageErrors.filter((t) => !BENIGN.some((re) => re.test(t))),
      failedRequests,
    })
    await use({ fatal, consoleErrors, pageErrors, failedRequests })
  },
})

export { expect }

export async function login(page, username = 'land01', password = 'Officer@123') {
  await page.goto('/login')
  await page.getByTestId('login-username').fill(username)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(/\/(dashboard|map|parcels)/, { timeout: 30_000 })
}

export async function openMap(page) {
  await page.goto('/map')
  await page.waitForFunction(() => window.__map && window.__map.ready === true, null, { timeout: 90_000 })
  await page.waitForTimeout(1500)
}
