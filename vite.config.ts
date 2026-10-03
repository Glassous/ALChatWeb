import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { dirname, join, basename } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

// Keep PDF resources local in both development and production deployments.
function pdfResources(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const folders = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  return {
    name: 'local-pdf-resources',
    generateBundle() {
      for (const folder of folders) for (const file of readdirSync(join(root, folder), { withFileTypes: true })) {
        if (file.isFile()) this.emitFile({ type: 'asset', fileName: `pdf-assets/${folder}/${file.name}`, source: readFileSync(join(root, folder, file.name)) })
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = request.url?.split('?')[0].match(/\/pdf-assets\/(cmaps|standard_fonts|wasm|iccs)\/([^/]+)$/)
        if (!match || basename(match[2]) !== match[2] || match[2].includes('..')) return next()
        try {
          const bytes = readFileSync(join(root, match[1], match[2]))
          response.setHeader('Content-Type', match[2].endsWith('.wasm') ? 'application/wasm' : match[2].endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
          response.end(bytes)
        } catch { next() }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pdfResources()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Keep CommonJS React initializers outside entry/preview chunk cycles.
          groups: [{ name: 'react-runtime', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
  server: {
    host: 'localhost',
    port: 3000,
  }
})
