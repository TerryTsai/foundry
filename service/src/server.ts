import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { config } from './config.js'
import { createDatabase } from './database.js'
import {
  authRoutes, projectRoutes, connectionRoutes, ticketRoutes,
  agentRoutes, sessionRoutes, executionRoutes, analyticsRoutes,
} from './router.js'
import { errors, requireAuth } from './middleware.js'
import { schedulerRecover, schedulerGlobalStart, schedulerStopAll, shutdownDrain } from './domain/scheduler.js'

const db  = createDatabase(config.dbPath)
const app = express()

app.use(express.json())

// ── Public routes (no auth) ──
app.get('/health', (_req, res) => res.json({ ok: true }))
app.get('/health/detail', (_req, res) => res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' }))
app.use('/auth', authRoutes(db, config))

// ── Static web app (production) ──
// Serve the built web app from ../web/dist. In dev (tsx watch) this is a
// no-op because web/dist doesn't exist yet; Vite serves the app on :3006.
// Must be ABOVE requireAuth so the login page and its assets can load
// without a session cookie.
const __dirname = dirname(fileURLToPath(import.meta.url))
const webDist = join(__dirname, '../../web/dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  // SPA fallback: serve index.html for client-side routing. API paths pass
  // through to requireAuth + route handlers below.
  //
  // Edge case: when the UI route path collides with an API mount point
  // (e.g. /analytics is BOTH a page and an endpoint), a browser reload
  // would otherwise hit the JSON API. Disambiguate by Accept header —
  // top-level navigations request text/html; fetch/XHR calls request
  // application/json. HTML-preferring requests always get the SPA.
  const apiPrefixes = ['/project', '/connection', '/ticket', '/agent', '/session', '/execution', '/analytics', '/health', '/auth']
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    const accept = req.headers.accept ?? ''
    const wantsHtml = accept.includes('text/html')
    if (wantsHtml) return res.sendFile(join(webDist, 'index.html'))
    if (apiPrefixes.some(p => req.path.startsWith(p))) return next()
    res.sendFile(join(webDist, 'index.html'))
  })
}

// ── Authenticated routes ──
app.use(requireAuth(db, config))

app.use('/project',    projectRoutes(db))
app.use('/connection', connectionRoutes(db))
app.use('/ticket',     ticketRoutes(db))
app.use('/agent',      agentRoutes(db, config))
app.use('/session',    sessionRoutes(db))
app.use('/execution',  executionRoutes(db, config))
app.use('/analytics',  analyticsRoutes(db))

app.use(errors)

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  schedulerRecover(db).catch(console.error)
  schedulerGlobalStart(db)
})

// ── Graceful shutdown on deploy restart ──
process.on('SIGTERM', () => {
  console.log('SIGTERM received, draining…')
  schedulerStopAll()
  shutdownDrain(db)
  try { execSync('podman kill --all', { timeout: 5000, stdio: 'ignore' }) } catch {}
  console.log('drain complete, exiting')
  process.exit(0)
})

export { app }
