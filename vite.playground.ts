import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const NODE_BUILTINS = ['node:zlib', 'node:module']

/** Shim node builtins that just-bash references but never actually calls in the browser. */
function shimNodeBuiltins(): Plugin {
  return {
    name: 'shim-node-builtins',
    enforce: 'pre',
    resolveId(source) {
      if (NODE_BUILTINS.includes(source)) return `\0shim:${source}`
      return null
    },
    load(id) {
      if (!id.startsWith('\0shim:')) return null
      // Export a Proxy as both default and named so any property access returns a no-op
      const noop = `() => { throw new Error('not available in browser') }`
      return `
        export default {}
        export const gunzipSync = ${noop}
        export const gzipSync = ${noop}
        export const constants = {}
        export const createRequire = ${noop}
      `
    },
  }
}

export default defineConfig({
  root: 'playground',
  plugins: [shimNodeBuiltins(), react(), tailwindcss()],
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
