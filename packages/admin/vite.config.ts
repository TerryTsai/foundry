import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Admin SPA. Stubbed today — the day-to-day product lives in
// @foundry/site. This package exists so the architecture's site/admin
// split is real and packages/admin can be fleshed out without
// disturbing the customer surface.

export default defineConfig({
  plugins: [react()],
  server: { port: 3007, host: true },
  build:  { outDir: 'dist' },
})
