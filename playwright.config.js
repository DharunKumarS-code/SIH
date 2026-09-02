import { defineConfig, devices } from '@playwright/test'

// Default: run against the Vite dev server. Set PW_TARGET=preview to run the
// same suite against the production build (`npm run build` + `npm run preview`).
const TARGET = process.env.PW_TARGET === 'preview' ? 'preview' : 'dev'
const PORT = TARGET === 'preview' ? 4180 : 5180
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  // Generous because CI / loaded dev machines render Cesium via software WebGL
  // (SwiftShader), which is slow. These are not used to mask failures — the
  // readiness conditions in tests/helpers.js still gate on real scene state.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--enable-webgl',
            '--disable-dev-shm-usage',
          ],
        },
      },
    },
  ],
  webServer: {
    command: TARGET === 'preview' ? 'npm run preview' : 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
