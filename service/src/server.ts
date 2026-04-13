import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { config } from './config.js'
import { createDatabase } from './database.js'
import * as router from './router.js'
import { errors, requireAuth } from './middleware.js'
import * as domain from './domain.js'

const db  = createDatabase(config.dbPath)
const app = express()

app.use(express.json())

// ── Public routes (no auth) ──
app.get('/health', (_req, res) => res.json({ ok: true }))
app.get('/health/detail', (_req, res) => res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' }))
app.use('/auth', router.auth(db, config))

// ── Static web app (production) ──
// Serve the built web app from ../web/dist. In dev (tsx watch) this is a
// no-op because web/dist doesn't exist yet; Vite serves the app on :3006.
// Must be ABOVE requireAuth so the login page and its assets can load
// without a session cookie.
const __dirname = dirname(fileURLToPath(import.meta.url))
const webDist = join(__dirname, '../../web/dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  // SPA fallback: non-API GET requests serve index.html for client-side
  // routing. API paths pass through to requireAuth + route handlers below.
  const apiPrefixes = ['/project', '/connection', '/ticket', '/agent', '/session', '/execution', '/analytics', '/health', '/auth']
  app.use((req, res, next) => {
    if (req.method !== 'GET' || apiPrefixes.some(p => req.path.startsWith(p))) return next()
    res.sendFile(join(webDist, 'index.html'))
  })
}

// ── Authenticated routes ──
app.use(requireAuth(db, config))

app.use('/project',    router.project(db))
app.use('/connection', router.connection(db))
app.use('/ticket',     router.ticket(db))
app.use('/agent',     router.agent(db, config))
app.use('/session',   router.session(db))
app.use('/execution', router.execution(db, config))
app.use('/analytics', router.analytics(db))

app.use(errors)

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  domain.schedulerRecover(db).catch(console.error)
  domain.schedulerGlobalStart(db)
})

// ── Graceful shutdown on deploy restart ──
process.on('SIGTERM', () => {
  console.log('SIGTERM received, draining…')
  domain.schedulerStopAll()
  domain.shutdownDrain(db)
  try { execSync('podman kill --all', { timeout: 5000, stdio: 'ignore' }) } catch {}
  console.log('drain complete, exiting')
  process.exit(0)
})

export { app }
