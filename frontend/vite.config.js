import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const cesiumSource = 'node_modules/cesium/Build/Cesium'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumSource}/${dir}/**/*`,
        dest: `cesium/${dir}`,
        rename: { stripBase: 5 },
      })),
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  // The two standalone Three.js "explorer" routes (/3d-explorer,
  // /underground-explorer) pull `three` + OrbitControls, but only behind a
  // React.lazy() dynamic import. Vite's dep optimizer does not always see those
  // at cold start, so the FIRST visit to an explorer route on a long-running
  // dev server can trigger a mid-session re-optimize + full reload that rejects
  // the in-flight import() with "Failed to fetch dynamically imported module".
  // Pre-declaring the deps here makes Vite bundle them in the initial optimize
  // pass, so the lazy chunk always resolves. (This does not change the
  // lazy-loading architecture — the routes stay lazy(() => import(...)).)
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      // Coimbatore 3D Property Explorer (/coimbatore-explorer) — same
      // lazy-chunk cold-start issue as OrbitControls above.
      'three/examples/jsm/controls/PointerLockControls.js',
      'three/examples/jsm/loaders/OBJLoader.js',
      'three/examples/jsm/loaders/MTLLoader.js',
      // 3D Property Certificate download (PropertySidebar's "Download
      // Certificate" button) — same lazy-chunk cold-start issue: jspdf/qrcode
      // are only pulled in behind PropertyCertificateModal's lazy(() =>
      // import(...)), so without this they aren't discovered until the first
      // click, triggering the same mid-session re-optimize + reload.
      'jspdf',
      'qrcode',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
      '/demo-docs': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
