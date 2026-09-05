import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              maxSize: 400 * 1024,
            },
          ],
        },
      },
    },
  },
  server: {
    host: 'localhost',
    port: 3000,
  }
})
