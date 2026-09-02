import { test, expect, login, openMap } from './helpers.js'

const ULPIN = 'TN-CHN-123456789'
const PROTO_ID = 'TN-CHN-123456789-B01-F02-U201'

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
  ]

  test('all routes open without a blank page or page error', async ({ page, diag }) => {
    await login(page)
    for (const [path, heading] of routes) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading }).first(), `route ${path}`).toBeVisible({ timeout: 25_000 })
    }
    const { pageErrors } = diag.fatal()
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})

test.describe('Dashboard', () => {
  test('shows KPI cards and charts', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard')
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

test.describe('Role-based access control', () => {
  test('citizen does not see officer-only navigation', async ({ page }) => {
    await login(page, 'citizen01', 'Citizen@123')
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: '3D Map' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users & Roles' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Land Records' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Property Tax' })).toHaveCount(0)
  })

  test('land officer sees governance nav', async ({ page }) => {
    await login(page, 'land01', 'Officer@123')
    await expect(page.getByRole('link', { name: 'Land Records' })).toBeVisible()
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
