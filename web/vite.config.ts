import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3006,
    host: true,
    proxy: {
      '/project': 'http://localhost:3001',
      '/ticket': 'http://localhost:3002',
      '/repo': 'http://localhost:3003',
      '/sandbox': 'http://localhost:3004',
      '/agent': 'http://localhost:3005',
    },
  },
})
