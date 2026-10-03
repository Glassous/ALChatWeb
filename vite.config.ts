import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to every interface (both IPv4 0.0.0.0 and IPv6 ::).
    // `host: 'localhost'` resolves to the IPv6 loopback only on Windows,
    // which makes http://127.0.0.1:3000 refuse connections and breaks
    // every module request (ERR_CONNECTION_REFUSED).
    host: true,
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
  },
})
