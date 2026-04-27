import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

import { config } from './config.js'
import { createDatabase } from '@foundry/db'
import { errors } from './http.js'

import { authRoutes }       from './routes/auth.js'
import { requireAuth, rateLimit } from '@foundry/auth'

import { projectRoutes }    from './routes/projects.js'
import { connectionRoutes } from './routes/connections.js'
import { ticketRoutes }     from './routes/tickets.js'
import { agentRoutes }      from './routes/agents.js'
import { sessionRoutes }    from './routes/sessions.js'
import { executionRoutes }  from './routes/executions.js'
import { analyticsRoutes }  from './routes/analytics.js'
import {
  attachmentRoutes, ticketAttachmentRoutes, commentAttachmentRoutes,
} from './routes/attachments.js'

import {
  dispatchProducer, settleRunning, dispatchRecoveryProducer,
  finishWithoutVerifiers, dispatchVerifier, finishOnAllPass, retryAfterFail,
  type Policy,
  type ReconcilerService,
} from '@foundry/reconciler'
import { decodeEncryptionKey } from '@foundry/crypto'
import {
  asText, isMcpEnvelope, parseConn, toolUseId,
  filterTools, parseToolSelection, byConnectionKind,
  foundryServer, githubServer, sandboxServer, browserServer,
  workspaceEmpty, workspaceDestroy,
  providerGet, supportedKinds,
  github as githubProvider,
  type FoundryCtx, type GithubCtx, type SandboxCtx, type BrowserCtx, type ConnCtx,
} from '@foundry/mcp'
import type {
  McpFoundryCtx, McpGithubCtx, McpSandboxCtx, McpConnCtx,
} from '@foundry/engine'

// ── Cross-module ctx drift assertions ────────────────────────────────
// Engine declares its own structural mirrors of every mcp server ctx
// (because the cardinal rule forbids @foundry/engine importing
// @foundry/mcp). These compile-time assertions fail the server build if
// the two sides ever drift — catching the next "missing field" bug at
// build time instead of at the first agent session.
type _AssertAssignable<T, U> = T extends U ? (U extends T ? true : false) : false
const _ctxDriftCheck: [
  _AssertAssignable<McpFoundryCtx, FoundryCtx>,
  _AssertAssignable<McpGithubCtx, GithubCtx>,
  _AssertAssignable<McpSandboxCtx, SandboxCtx>,
  _AssertAssignable<McpSandboxCtx, BrowserCtx>,
  _AssertAssignable<McpConnCtx, ConnCtx>,
] = [true, true, true, true, true]
void _ctxDriftCheck
import {
  executionCreate as sandboxExecutionCreate,
  registerSessionWorkspace, unregisterSessionWorkspace,
  stopSessionContainer,
  stopAllSessionContainers,
  createSandboxState,
  createSandboxService,
  type SandboxState,
} from '@foundry/sandbox'
import { connectionByAccount } from '@foundry/crud'

// Per-service wiring entry points. Each service.ts constructs its own
// XxxClient from the deps passed in here; the composition root no longer
// builds an aggregate Client. Routes still call raw module functions
// directly today, but the per-service clients are live for future
// bind(client, ctx) migrations.
import { createBillingService }    from '@foundry/billing/service'
import { createAnalyticsService }  from '@foundry/analytics/service'
import { createCrudService }       from '@foundry/crud/service'
import { createAuthService }       from '@foundry/auth/service'
import { createMcpService }        from '@foundry/mcp/service'
import { createEngineService }     from '@foundry/engine/service'
import { createReconcilerService } from '@foundry/reconciler/service'

// Build the Express app, wire every route, and return it together with the
// db handle and constructed deps bags. Split out from boot() so tests
// (and future programmatic callers) can drive the app without listening.
// eslint-disable-next-line max-lines-per-function -- composition root; linear wiring of routes + middleware
export function buildApp() {
  // Decode FOUNDRY_ENCRYPTION_KEY once at boot. Every consumer (auth's
  // sessionJwt mint/verify, crud's encrypt/decryptSecret) receives the
  // Buffer through closures bound below — no module-level cached key
  // hides in any logic module.
  const encryptionKey = decodeEncryptionKey(process.env.FOUNDRY_ENCRYPTION_KEY ?? '')

  // Sandbox runtime state (active execs, persistent containers, session
  // workspace paths). Created once here and threaded into every sandbox
  // function — no module-level Maps in @foundry/sandbox.
  const sandboxState = createSandboxState()

  const db  = createDatabase(config.dbPath)
  const app = express()

  app.use(express.json())

  // crud's CrudClient is built first; auth + sandbox + engine all
  // route their persistence through it. crud itself is the only logic
  // module that imports @foundry/db.
  const crud    = createCrudService(db, providerGet, supportedKinds, encryptionKey)
  const sandbox = createSandboxService(db, config, crud, sandboxState)

  // ── Public routes (no auth) ──
  app.get('/health',        (_req, res) => res.json({ ok: true }))
  app.get('/health/detail', (_req, res) => res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' }))

  // Rate-limit the auth surface — prevents brute force on the OAuth state /
  // callback endpoints. Bucket per IP. Public so it lives ABOVE requireAuth.
  app.use('/auth', rateLimit({ windowMs: 5 * 60 * 1000, max: 30, bucket: 'auth' }))
  app.use('/auth', authRoutes(config, crud, encryptionKey))

  // ── Static web app (production) ──
  // Serve the built site SPA from site/dist. In dev (tsx watch)
  // this is a no-op because dist doesn't exist; Vite serves the app on
  // :3006. Must be ABOVE requireAuth so the login page and its assets can
  // load without a session cookie.
  //
  // Path resolution: this file is server/{src,dist}/main.{ts,js}; the
  // site app lives at site/dist one level up.
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const webDist   = join(__dirname, '../../site/dist')
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
  app.use(requireAuth(crud, encryptionKey))

  // Per-account write throttle. Bucket key is account id (req.account.id is
  // set by requireAuth). 600/min comfortably covers sandbox bursts; cookie
  // callers won't notice.
  app.use(rateLimit({
    windowMs: 60 * 1000, max: 600, bucket: 'write',
    keyFn: (req) => req.account?.id ?? req.ip ?? 'anon',
  }))

  // Per-service clients. Each createXxxService binds db + closures and
  // returns its typed Client. Cross-service consumers (reconciler →
  // engine, engine → crud/sandbox/auth, …) take the typed Client of
  // their dependency. Routes call client methods directly.
  const billingService   = createBillingService()
  void billingService
  const analyticsService = createAnalyticsService({ db })
  void analyticsService
  const auth             = createAuthService(
    config, crud, encryptionKey,
    (_c, baseUrl, state) => githubProvider.oauthAuthorizeUrl(config, baseUrl, state),
    (_c, code)           => githubProvider.oauthExchangeCode(config, code),
    (token)              => githubProvider.fetchUser(token),
  )
  const mcpService       = createMcpService({ db, connectionByAccount })
  void mcpService
  const engine           = createEngineService(
    db, config, crud, auth, encryptionKey,
    (cfg, input)                 => sandboxExecutionCreate(cfg, crud, sandboxState, input),
    (sessionId, workspace)       => registerSessionWorkspace(sandboxState, sessionId, workspace),
    (sessionId)                  => unregisterSessionWorkspace(sandboxState, sessionId),
    (sessionId)                  => stopSessionContainer(sandboxState, sessionId),
    foundryServer, githubServer, sandboxServer, browserServer,
    byConnectionKind,
    filterTools, parseToolSelection,
    parseConn, asText, isMcpEnvelope, toolUseId,
    workspaceEmpty, workspaceDestroy,
  )
  const reconciler       = createReconcilerService(db, crud, engine, RECONCILER_POLICIES)

  // On-demand reconcile triggered by `POST /project/:id/run` (and any
  // future caller that needs to nudge the loop).
  const triggerReconcile = () => {
    reconciler.tick().catch((err: unknown) => console.error('reconciler error:', err))
  }

  app.use('/project',    projectRoutes(db, triggerReconcile))
  app.use('/connection', connectionRoutes(db, encryptionKey))
  app.use('/ticket',     ticketRoutes(db, crud, sandboxState))
  app.use('/agent',      agentRoutes(db))
  app.use('/session',    sessionRoutes(db, sandbox))
  app.use('/execution',  executionRoutes(sandbox, sandboxState))
  app.use('/analytics',  analyticsRoutes(db))
  app.use('/attachment', attachmentRoutes(db))

  // Raw-body parser, scoped to attachment upload. JSON parser stays default
  // everywhere else; this one kicks in only when we actually want bytes.
  app.use('/ticket/:id/attachment',  express.raw({ type: '*/*', limit: '15mb' }), ticketAttachmentRoutes(db))
  app.use('/comment/:id/attachment', express.raw({ type: '*/*', limit: '15mb' }), commentAttachmentRoutes(db))

  app.use(errors)

  return { app, db, reconciler, sandboxState }
}

// Composition-root ordering. Earlier policies pre-empt later ones for
// the same ticket. Most have mutually exclusive guards (status +
// verdicts state), so reordering rarely changes behavior. Exception:
// finishOnAllPass and retryAfterFail both apply to "all verifiers done"
// — finish runs first because all-pass is the happy path; retry takes
// whatever falls through.
const RECONCILER_POLICIES: Policy[] = [
  dispatchProducer,            // created → dispatch producer (slot allowing)
  settleRunning,               // running with no live session → waiting
  dispatchRecoveryProducer,    // waiting + no producer ever → dispatch one
  finishWithoutVerifiers,      // waiting + no verifiers configured → settle
  dispatchVerifier,            // waiting → dispatch a missing verifier
  finishOnAllPass,             // waiting + all verifiers passed → finished
  retryAfterFail,              // waiting + any verifier failed → reset + new producer
]

// Boot the service. Listens on config.port, starts the reconciler tick
// loop, and installs a SIGTERM handler that drains running work before
// exiting. Returns the http.Server so callers can await close() in tests.
export function boot() {
  const { app, reconciler, sandboxState } = buildApp()

  let reconcilerInterval: ReturnType<typeof setInterval> | null = null

  const server = app.listen(config.port, () => {
    console.log(`foundry service listening on port ${config.port}`)
    reconcilerInterval = setInterval(() => {
      reconciler.tick().catch((err: unknown) => console.error('reconciler error:', err))
    }, 5000)
  })

  // ── Graceful shutdown on deploy restart ──
  process.on('SIGTERM', () => shutdown(reconciler, sandboxState, reconcilerInterval))

  return server
}

function shutdown(reconciler: ReconcilerService, sandboxState: SandboxState, interval: ReturnType<typeof setInterval> | null) {
  console.log('SIGTERM received, draining…')
  if (interval) clearInterval(interval)
  reconciler.drain().catch((errVal: unknown) => console.error('reconciler drain error:', errVal))
  stopAllSessionContainers(sandboxState)
  try { execSync('podman kill --all', { timeout: 5000, stdio: 'ignore' }) } catch {
    // Ignored — best-effort container cleanup; podman may not be installed
    // in dev environments. The service exits regardless.
  }
  console.log('drain complete, exiting')
  process.exit(0)
}

// Self-invoke when this file is the entrypoint (node dist/main.js or tsx
// src/main.ts). When boot is imported as a function, the caller decides
// when to invoke.
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) boot()
