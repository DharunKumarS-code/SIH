import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/cesium/Build/Cesium/Workers/**/*',
          dest: 'cesium/Workers',
          rename: { stripBase: 5 },
        },
        {
          src: 'node_modules/cesium/Build/Cesium/ThirdParty/**/*',
          dest: 'cesium/ThirdParty',
          rename: { stripBase: 5 },
        },
        {
          src: 'node_modules/cesium/Build/Cesium/Assets/**/*',
          dest: 'cesium/Assets',
          rename: { stripBase: 5 },
        },
        {
          src: 'node_modules/cesium/Build/Cesium/Widgets/**/*',
          dest: 'cesium/Widgets',
          rename: { stripBase: 5 },
        },
      ],
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 4180,
    strictPort: true,
  },
})
