import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

import { config } from './core/config.js'
import { createDatabase } from './core/db.js'
import { errors } from './core/http.js'
import { assertKeyConfigured } from '@foundry/crud'

import { authRoutes }       from './auth/routes.js'
import { requireAuth, rateLimit } from '@foundry/auth'

import { projectRoutes }    from './projects/routes.js'
import { connectionRoutes } from './connections/routes.js'
import { ticketRoutes }     from './tickets/routes.js'
import { agentRoutes }      from './agents/routes.js'
import { sessionRoutes }    from './sessions/routes.js'
import { executionRoutes }  from './executions/routes.js'
import { analyticsRoutes }  from './analytics/routes.js'
import { attachmentRoutes, ticketAttachmentRoutes, commentAttachmentRoutes } from './attachments/routes.js'

import { reconcilerGlobalStart, reconcilerStopAll, shutdownDrain } from './reconciler/reconciler.js'
import { stopAllSessionContainers } from '@foundry/sandbox'

// Fail fast if FOUNDRY_ENCRYPTION_KEY is missing or malformed — better here
// than on the first connection write.
assertKeyConfigured()

const db  = createDatabase(config.dbPath)
const app = express()

app.use(express.json())

// ── Public routes (no auth) ──
app.get('/health',        (_req, res) => res.json({ ok: true }))
app.get('/health/detail', (_req, res) => res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' }))

// Rate-limit the auth surface — prevents brute force on the OAuth state /
// callback endpoints. Bucket per IP. Public so it lives ABOVE requireAuth.
app.use('/auth', rateLimit({ windowMs: 5 * 60 * 1000, max: 30, bucket: 'auth' }))
app.use('/auth', authRoutes(db, config))

// ── Static web app (production) ──
// Serve the built web app from ../web/dist. In dev (tsx watch) this is a
// no-op because web/dist doesn't exist yet; Vite serves the app on :3006.
// Must be ABOVE requireAuth so the login page and its assets can load
// without a session cookie.
const __dirname = dirname(fileURLToPath(import.meta.url))
const webDist   = join(__dirname, '../../web/dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  // SPA fallback: serve index.html for client-side routing. API paths pass
  // through to requireAuth + route handlers below.
  //
  // Two kinds of API prefixes:
  //   - `apiOnly`: no matching SPA route (e.g. /attachment serves raw
  //     bytes). Always passes through so a direct <a href> navigation
  //     renders the image/PDF instead of the SPA.
  //   - `dualUse`: path is both a page AND an endpoint (e.g. /analytics).
  //     Browsers (Accept: text/html) get the SPA; fetch/XHR gets the API.
  const apiOnly  = ['/attachment', '/auth', '/health', '/connection', '/agent', '/execution']
  const dualUse  = ['/project', '/ticket', '/session', '/analytics']
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    if (apiOnly.some(p => req.path.startsWith(p))) return next()
    const accept = req.headers.accept ?? ''
    if (accept.includes('text/html')) return res.sendFile(join(webDist, 'index.html'))
    if (dualUse.some(p => req.path.startsWith(p))) return next()
    res.sendFile(join(webDist, 'index.html'))
  })
}

// ── Authenticated routes ──
app.use(requireAuth(db, config))

// Per-account write throttle. Bucket key is account id (req.account.id is
// set by requireAuth). 600/min comfortably covers sandbox bursts; cookie
// callers won't notice.
app.use(rateLimit({
  windowMs: 60 * 1000, max: 600, bucket: 'write',
  keyFn: (req) => req.account?.id ?? req.ip ?? 'anon',
}))

app.use('/project',    projectRoutes(db))
app.use('/connection', connectionRoutes(db))
app.use('/ticket',     ticketRoutes(db))
app.use('/agent',      agentRoutes(db))
app.use('/session',    sessionRoutes(db))
app.use('/execution',  executionRoutes(db, config))
app.use('/analytics',  analyticsRoutes(db))
app.use('/attachment', attachmentRoutes(db))

// Raw-body parser, scoped to attachment upload. JSON parser stays default
// everywhere else; this one kicks in only when we actually want bytes.
app.use('/ticket/:id/attachment',  express.raw({ type: '*/*', limit: '15mb' }), ticketAttachmentRoutes(db))
app.use('/comment/:id/attachment', express.raw({ type: '*/*', limit: '15mb' }), commentAttachmentRoutes(db))

app.use(errors)

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  ;(globalThis as any).__foundryConfig = config
  reconcilerGlobalStart(db)
})

// ── Graceful shutdown on deploy restart ──
process.on('SIGTERM', () => {
  console.log('SIGTERM received, draining…')
  reconcilerStopAll()
  shutdownDrain(db)
  stopAllSessionContainers()
  try { execSync('podman kill --all', { timeout: 5000, stdio: 'ignore' }) } catch {}
  console.log('drain complete, exiting')
  process.exit(0)
})

export { app }
