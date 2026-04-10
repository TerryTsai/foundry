import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3006,
    host: true,
    proxy: {
      '/project': 'http://localhost:3000',
      '/ticket': 'http://localhost:3000',
      '/file': 'http://localhost:3000',
      '/git': 'http://localhost:3000',
      '/execution': 'http://localhost:3000',
      '/agent': 'http://localhost:3000',
      '/session': 'http://localhost:3000',
      '/provider': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
})
