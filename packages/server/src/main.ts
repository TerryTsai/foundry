import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

import { config } from './config.js'
import { createDatabase, type Db } from '@foundry/db'
import { errors } from './http.js'
import { assertKeyConfigured } from '@foundry/crud'

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

import { reconcilerGlobalStart, reconcilerStopAll, shutdownDrain, type ReconcilerDeps } from '@foundry/reconciler'
import { runSession, type EngineDeps } from '@foundry/engine'
import { sessionJwt } from '@foundry/auth'
import {
  asText, isMcpEnvelope, parseConn, toolUseId,
  filterTools, parseToolSelection, byConnectionKind,
  foundryServer, githubServer, sandboxServer, browserServer,
  workspaceEmpty, workspaceDestroy,
  providerGet, supportedKinds,
  github as githubProvider,
} from '@foundry/mcp'
import {
  executionCreate as sandboxExecutionCreate,
  registerSessionWorkspace, unregisterSessionWorkspace,
  stopSessionContainer,
  stopAllSessionContainers,
} from '@foundry/sandbox'
import {
  agentList,
  encryptSecret, decryptSecret, attachmentListByTicketInternal,
  executionOwned, sessionOwned,
} from '@foundry/crud'

import {
  createInProcessClient,
  createAuthAdapter, createBillingAdapter, createCrudAdapter,
  createAnalyticsAdapter, createSandboxAdapter, createMcpAdapter,
  createEngineAdapter, createReconcilerAdapter,
  type Client,
} from '@foundry/client'

// Build the Express app, wire every route, and return it together with the
// db handle and constructed deps bags. Split out from boot() so tests
// (and future programmatic callers) can drive the app without listening.
// eslint-disable-next-line max-lines-per-function -- composition root; mirrors the linear wiring of service/server.ts
export function buildApp() {
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
  // Serve the built site SPA from packages/site/dist. In dev (tsx watch)
  // this is a no-op because dist doesn't exist; Vite serves the app on
  // :3006. Must be ABOVE requireAuth so the login page and its assets can
  // load without a session cookie.
  //
  // Path resolution: this file is packages/server/{src,dist}/main.{ts,js}.
  // The site app lives at packages/site/dist (sibling package).
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

  const reconcilerDeps = buildReconcilerDeps()
  const client         = buildClient(db, reconcilerDeps.engine.engineDeps)
  return { app, db, reconcilerDeps, client }
}

// Composition root: assemble the typed cross-module Client from the
// in-process adapters. Routes don't use this yet — the next sweep wires
// each handler to bind(client, ctx). For now it's available so the
// shape compiles end-to-end.
function buildClient(db: Db, engineDeps: EngineDeps): Client {
  // Bridge AuthConfig (what auth's GithubOAuthDeps wants) → McpConfig (what
  // the github provider helpers expect). The full service Config satisfies
  // both structurally; the closures here just adapt the type aliases.
  const githubDeps = {
    oauthAuthorizeUrl: (_c: unknown, baseUrl: string, state: string) => githubProvider.oauthAuthorizeUrl(config, baseUrl, state),
    oauthExchangeCode: (_c: unknown, code: string)                   => githubProvider.oauthExchangeCode(config, code),
    fetchUser:         (token: string)                               => githubProvider.fetchUser(token),
  }
  return createInProcessClient({
    auth:       createAuthAdapter({ db, config, githubDeps }),
    billing:    createBillingAdapter(),
    crud:       createCrudAdapter({ db, providerGet, supportedKinds }),
    analytics:  createAnalyticsAdapter({ db }),
    sandbox:    createSandboxAdapter({ db, config, executionOwned, sessionOwned }),
    mcp:        createMcpAdapter({ db }),
    engine:     createEngineAdapter({ db, config, engineDeps }),
    reconciler: createReconcilerAdapter(),
  })
}

// Cross-module callback bag for the engine. Built from concrete imports
// here because the composition root is the only module allowed to wire
// logic modules together.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural mirror in @foundry/reconciler
function buildEngineDeps(): EngineDeps {
  return {
    auth: {
      sessionJwtMint: (db, sessionId, ttlMs) => sessionJwt.mint(db, sessionId, ttlMs),
    },
    mcp: {
      foundryServer, githubServer, sandboxServer, browserServer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural mirror
      byConnectionKind: byConnectionKind as Record<string, any>,
      filterTools, parseToolSelection,
      parseConn, asText, isMcpEnvelope, toolUseId,
      workspaceEmpty, workspaceDestroy,
    },
    sandbox: {
      executionCreate: (db, cfg, input) => sandboxExecutionCreate(db, cfg, input),
      registerSessionWorkspace, unregisterSessionWorkspace,
      stopSessionContainer,
    },
    crud: {
      encryptSecret, decryptSecret, attachmentListByTicketInternal,
    },
  }
}

function buildReconcilerDeps(): ReconcilerDeps {
  return {
    config,
    crud: { agentList },
    engine: { runSession, engineDeps: buildEngineDeps() },
  }
}

// Boot the service. Listens on config.port, starts the reconciler, and
// installs a SIGTERM handler that drains running work before exiting.
// Returns the http.Server so callers can await close() in tests.
export function boot() {
  const { app, db, reconcilerDeps } = buildApp()

  const server = app.listen(config.port, () => {
    console.log(`foundry service listening on port ${config.port}`)
    reconcilerGlobalStart(db, reconcilerDeps)
  })

  // ── Graceful shutdown on deploy restart ──
  process.on('SIGTERM', () => shutdown(db))

  return server
}

function shutdown(db: Db) {
  console.log('SIGTERM received, draining…')
  reconcilerStopAll()
  shutdownDrain(db)
  stopAllSessionContainers()
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
