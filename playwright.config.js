import { defineConfig, devices } from '@playwright/test'

// Opt-in fast profile: `E2E_FAST=1 npx playwright test` (see `npm run test:e2e:fast`).
// The default profile below is unchanged. The fast profile changes only HOW
// the same tests run — every test, assertion, timeout and retry is identical:
//   - frontend: a fresh production build served by `vite preview` instead of the
//     Vite dev server (no unbundled dev modules, no React StrictMode double
//     mount — StrictMode re-creates every Cesium viewer twice in dev);
//   - WebGL: the machine's hardware GPU via ANGLE/D3D11 on Windows instead of
//     the CPU-emulated SwiftShader (verified to expose the real GPU to headless
//     Chromium here). Other platforms keep SwiftShader;
//   - workers: E2E_WORKERS (default 2) spec files in parallel. Tests inside a
//     file still run in order (fullyParallel: false). More than 2 exceeds the
//     backend's 600 req/min per-IP /api limit (all workers share 127.0.0.1)
//     and produces 429-driven flakes.
const FAST = process.env.E2E_FAST === '1'
const FRONTEND = FAST ? 'http://localhost:4173' : 'http://localhost:5173'

const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
]
const GPU_ARGS = [
  '--use-angle=d3d11',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--force_high_performance_gpu',
  '--disable-dev-shm-usage',
]
const launchArgs = FAST && process.platform === 'win32' ? GPU_ARGS : SWIFTSHADER_ARGS

// Built outside frontend/dist so a test run never overwrites a deploy build.
const E2E_DIST = 'node_modules/.cache/e2e-dist'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: FAST ? Number(process.env.E2E_WORKERS) || 2 : 1,
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
        launchOptions: { args: launchArgs },
      },
    },
  ],
  webServer: [
    {
      // Phase 3 AI service (Python/FastAPI). Optional at runtime, but the AI E2E
      // spec needs it. If Python deps are missing only that one spec is affected.
      command: 'python -m uvicorn app.main:app --port 8000 --log-level warning',
      cwd: 'ai-service',
      url: 'http://localhost:8000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm --prefix backend start',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    FAST
      ? {
          // Always a fresh build of the current source (never a stale preview).
          command: `npx vite build --outDir ${E2E_DIST} --emptyOutDir && npx vite preview --outDir ${E2E_DIST} --port 4173 --strictPort`,
          cwd: 'frontend',
          url: FRONTEND,
          reuseExistingServer: false,
          timeout: 300_000,
        }
      : {
          command: 'npm --prefix frontend run dev',
          url: FRONTEND,
          reuseExistingServer: true,
          timeout: 60_000,
        },
  ],
})
