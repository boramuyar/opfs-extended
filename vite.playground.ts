import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'node:path'

export default defineConfig({
  root: 'playground',
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ['zlib', 'module', 'stream'],
    }),
  ],
  resolve: {
    alias: {
      'opfs-extended': path.resolve(__dirname, 'src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  define: {
    'process.env': '{}',
    'process.platform': '"browser"',
    'process.version': '"v20.0.0"',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
