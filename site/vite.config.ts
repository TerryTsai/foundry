import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /auth needs the original Host header preserved on its way to the service so
// the OAuth callback URL gets derived from the user-facing host (e.g. a LAN
// name like t470.lan:3006), not localhost. changeOrigin:false is the default
// but pinning it here makes the requirement obvious.
const target = 'http://localhost:3000'
const passthrough = { target, changeOrigin: false }

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3006,
    host: true,
    // LAN access: vite blocks unknown Host headers by default since 5.x.
    // List the hostnames Foundry is reachable on so dogfooding from phones
    // and other LAN devices works.
    allowedHosts: ['t470.lan', 'localhost'],
    proxy: {
      '/api':         passthrough,
      '/health':     passthrough,
      '/auth':       passthrough,
    },
  },
})
