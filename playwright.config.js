import { defineConfig, devices } from '@playwright/test'

const FRONTEND = 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // One retry absorbs transient Vite-dev cold-compile stalls on a loaded dev
  // machine; it does not mask deterministic failures.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONTEND,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
            '--disable-dev-shm-usage',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'npm --prefix backend start',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm --prefix frontend run dev',
      url: FRONTEND,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
