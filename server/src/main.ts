import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

import { config } from './config.js'
import { createDatabase, type Db } from '@foundry/db'
import { errors } from './http.js'

import { authRoutes }       from './routes/auth.js'
import { requireAuth, rateLimit, type AuthCrudOps } from '@foundry/auth'

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
  reconcilerTick, shutdownDrain,
  dispatchProducer, settleRunning, dispatchRecoveryProducer,
  finishWithoutVerifiers, dispatchVerifier, finishOnAllPass, retryAfterFail,
  type ReconcilerCrudOps, type ReconcilerDeps,
  type EngineDeps as ReconcilerEngineDeps,
  type RunSessionFn as ReconcilerRunSessionFn,
  type Policy,
} from '@foundry/reconciler'
import { decodeEncryptionKey } from './encryption-key.js'
import { runSession, type EngineCrudOps, type EngineDeps } from '@foundry/engine'
import { sessionJwt } from '@foundry/auth'
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
  type SandboxCrudOps, type SandboxState,
} from '@foundry/sandbox'
import {
  agentList,
  encryptSecret, decryptSecret,
  attachmentListByTicketInternal,
  executionOwned, sessionOwned,
  ticketGetById, ticketUpdateById, ticketTransition, ticketAllByProject,
  projectGetById, projectsActive,
  sessionGetById, sessionUpdateById, sessionInsert,
  sessionRunning, sessionRunningForTicket, sessionsByTicketRaw,
  activityWrite, activityUpdate, activityByTurnOrder,
  agentGetById,
  connectionGetById, connectionByAccount, connectionUpdateById,
  accountGetById,
  verdictBySession, verdictByTicket,
  authSessionGet, authSessionInsert, authSessionRemove,
  accountUpsertByGithubId, claimUnownedProjects,
  commentByTicket,
  eventCreate, eventLatest,
  // execution metering
  executionList as crudExecutionList,
  executionBySession as crudExecutionBySession,
  executionMeterCreate, executionMeterUpdate, executionMarkCancelled,
  sessionsForTicketRaw,
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
// eslint-disable-next-line max-lines-per-function -- composition root; linear wiring of routes + middleware
export function buildApp() {
  // Decode FOUNDRY_ENCRYPTION_KEY once at boot. Every consumer (auth's
  // sessionJwt mint/verify, crud's encrypt/decryptSecret) receives the
  // Buffer through closures bound below — no module-level cached key
  // hides in any logic module.
  const encryptionKey = decodeEncryptionKey(process.env.FOUNDRY_ENCRYPTION_KEY ?? '')

  // Bind the key once to produce the closure-shaped (plain) => string
  // and (stored) => string callbacks every consumer (engine deps, route
  // handlers) actually wants. Crud's raw exports are key-aware.
  const encryptSecretFn = (plain:  string) => encryptSecret(plain,  encryptionKey)
  const decryptSecretFn = (stored: string) => decryptSecret(stored, encryptionKey)

  // Sandbox runtime state (active execs, persistent containers, session
  // workspace paths). Created once here and threaded into every sandbox
  // function — no module-level Maps in @foundry/sandbox.
  const sandboxState = createSandboxState()

  const db  = createDatabase(config.dbPath)
  const app = express()

  app.use(express.json())

  // Build the cross-module callback bundles. crud is the only logic
  // module that imports @foundry/db; everyone else gets its persistence
  // through these closures.
  const authCrud      = buildAuthCrudOps()
  const sandboxCrud   = buildSandboxCrudOps()
  const reconcilerCrud = buildReconcilerCrudOps()
  const engineCrud    = buildEngineCrudOps(encryptSecretFn, decryptSecretFn)
  const engineDeps    = buildEngineDeps(engineCrud, authCrud, sandboxCrud, encryptionKey, sandboxState)

  // ── Public routes (no auth) ──
  app.get('/health',        (_req, res) => res.json({ ok: true }))
  app.get('/health/detail', (_req, res) => res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' }))

  // Rate-limit the auth surface — prevents brute force on the OAuth state /
  // callback endpoints. Bucket per IP. Public so it lives ABOVE requireAuth.
  app.use('/auth', rateLimit({ windowMs: 5 * 60 * 1000, max: 30, bucket: 'auth' }))
  app.use('/auth', authRoutes(db, config, authCrud, encryptionKey))

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
  app.use(requireAuth(db, config, authCrud, encryptionKey))

  // Per-account write throttle. Bucket key is account id (req.account.id is
  // set by requireAuth). 600/min comfortably covers sandbox bursts; cookie
  // callers won't notice.
  app.use(rateLimit({
    windowMs: 60 * 1000, max: 600, bucket: 'write',
    keyFn: (req) => req.account?.id ?? req.ip ?? 'anon',
  }))

  // On-demand reconcile triggered by `POST /project/:id/run` (and any
  // future caller that needs to nudge the loop). Pre-bound here so the
  // route handlers don't need to reach for reconcilerDeps themselves.
  const triggerReconcile = () => {
    reconcilerTick(db, reconcilerDeps, RECONCILER_POLICIES).catch((err: unknown) =>
      console.error('reconciler error:', err))
  }

  app.use('/project',    projectRoutes(db, triggerReconcile))
  app.use('/connection', connectionRoutes(db, encryptSecretFn, decryptSecretFn))
  app.use('/ticket',     ticketRoutes(db, sandboxCrud, sandboxState))
  app.use('/agent',      agentRoutes(db))
  app.use('/session',    sessionRoutes(db, sandboxCrud))
  app.use('/execution',  executionRoutes(db, config, sandboxCrud, sandboxState))
  app.use('/analytics',  analyticsRoutes(db))
  app.use('/attachment', attachmentRoutes(db))

  // Raw-body parser, scoped to attachment upload. JSON parser stays default
  // everywhere else; this one kicks in only when we actually want bytes.
  app.use('/ticket/:id/attachment',  express.raw({ type: '*/*', limit: '15mb' }), ticketAttachmentRoutes(db))
  app.use('/comment/:id/attachment', express.raw({ type: '*/*', limit: '15mb' }), commentAttachmentRoutes(db))

  app.use(errors)

  const reconcilerDeps = buildReconcilerDeps(reconcilerCrud, engineDeps)
  const client         = buildClient(db, engineDeps, authCrud, sandboxCrud, encryptionKey, sandboxState, encryptSecretFn, decryptSecretFn)
  return { app, db, reconcilerDeps, client, sandboxState }
}

// Composition root: assemble the typed cross-module Client from the
// in-process adapters. Routes don't use this yet — the next sweep wires
// each handler to bind(client, ctx). For now it's available so the
// shape compiles end-to-end.
function buildClient(
  db: Db, engineDeps: EngineDeps,
  authCrud: AuthCrudOps, sandboxCrud: SandboxCrudOps, encryptionKey: Buffer, sandboxState: SandboxState,
  encryptSecret: (s: string) => string, decryptSecret: (s: string) => string,
): Client {
  return createInProcessClient({
    auth:       createAuthAdapter({ db, config, githubDeps: buildGithubDeps(), authCrud, encryptionKey }),
    billing:    createBillingAdapter(),
    crud:       createCrudAdapter({ db, providerGet, supportedKinds, encryptSecret, decryptSecret }),
    analytics:  createAnalyticsAdapter({ db }),
    sandbox:    createSandboxAdapter({ db, config, executionOwned, sessionOwned, sandboxCrud, sandboxState }),
    mcp:        createMcpAdapter({ db }),
    engine:     createEngineAdapter({ db, config, engineDeps }),
    reconciler: createReconcilerAdapter(),
  })
}

// Bridge AuthConfig (what auth's GithubOAuthDeps wants) → McpConfig (what
// the github provider helpers expect). The full service Config satisfies
// both structurally; the closures here just adapt the type aliases.
function buildGithubDeps() {
  return {
    oauthAuthorizeUrl: (_c: unknown, baseUrl: string, state: string) => githubProvider.oauthAuthorizeUrl(config, baseUrl, state),
    oauthExchangeCode: (_c: unknown, code: string)                   => githubProvider.oauthExchangeCode(config, code),
    fetchUser:         (token: string)                               => githubProvider.fetchUser(token),
  }
}

// ── crud-callback bundle constructors ────────────────────────────────

function buildAuthCrudOps(): AuthCrudOps {
  return {
    accountGet:               accountGetById,
    accountUpsertByGithubId:  accountUpsertByGithubId,
    authSessionGet:           authSessionGet,
    authSessionInsert:        authSessionInsert,
    authSessionRemove:        authSessionRemove,
    claimUnownedProjects:     claimUnownedProjects,
    sessionGet:               sessionGetById,
    ticketGet:                ticketGetById,
    projectGet:               projectGetById,
  }
}

function buildSandboxCrudOps(): SandboxCrudOps {
  return {
    sessionGetById:         sessionGetById,
    executionList:          crudExecutionList,
    executionBySession:     crudExecutionBySession,
    sessionsForTicketRaw:   sessionsForTicketRaw,
    executionMeterCreate:   executionMeterCreate,
    executionMeterUpdate:   executionMeterUpdate,
    executionMarkCancelled: executionMarkCancelled,
  }
}

// eslint-disable-next-line max-lines-per-function -- composition root callback bag; one line per cross-module function
function buildReconcilerCrudOps(): ReconcilerCrudOps {
  return {
    agentList:               (db, opts) => {
      const r = agentList(db, opts)
      return r.ok ? r.value : []
    },
    projectsActive:          projectsActive,
    ticketAllByProject:      ticketAllByProject,
    ticketGetById:           ticketGetById,
    ticketTransition:        ticketTransition,
    ticketUpdateById:        ticketUpdateById,
    sessionInsert:           sessionInsert,
    sessionUpdateById:       sessionUpdateById,
    sessionRunning:          sessionRunning,
    sessionRunningForTicket: sessionRunningForTicket,
    sessionsByTicketRaw:     sessionsByTicketRaw,
    verdictBySession:        verdictBySession,
    eventCreate:             eventCreate,
    eventLatest:             eventLatest,
  }
}

function buildEngineCrudOps(
  encryptSecret: (s: string) => string, decryptSecret: (s: string) => string,
): EngineCrudOps {
  return {
    encryptSecret, decryptSecret, attachmentListByTicketInternal,
    ticketGetById, sessionGetById, agentGetById, projectGetById, accountGetById,
    connectionGetById, connectionByAccount, commentByTicket,
    verdictBySession, verdictByTicket,
    ticketUpdateById, sessionUpdateById, connectionUpdateById,
    activityCreate: activityWrite, activityUpdate, activityByTurnOrder,
    eventCreate,
  }
}

// Cross-module callback bag for the engine. Built from concrete imports
// here because the composition root is the only module allowed to wire
// logic modules together.
// eslint-disable-next-line max-lines-per-function -- composition root callback bag; one line per cross-module function
function buildEngineDeps(
  engineCrud: EngineCrudOps, authCrud: AuthCrudOps, sandboxCrud: SandboxCrudOps, encryptionKey: Buffer, sandboxState: SandboxState,
): EngineDeps {
  return {
    auth: {
      sessionJwtMint: (db, sessionId, ttlMs) => sessionJwt.mint(db, authCrud, sessionId, ttlMs, encryptionKey),
    },
    mcp: {
      foundryServer, githubServer, sandboxServer, browserServer,
      byConnectionKind,
      filterTools, parseToolSelection,
      parseConn, asText, isMcpEnvelope, toolUseId,
      workspaceEmpty, workspaceDestroy,
    },
    sandbox: {
      executionCreate: (db, cfg, input) => sandboxExecutionCreate(db, cfg, sandboxCrud, sandboxState, input),
      registerSessionWorkspace: (sessionId, workspace) => registerSessionWorkspace(sandboxState, sessionId, workspace),
      unregisterSessionWorkspace: (sessionId) => unregisterSessionWorkspace(sandboxState, sessionId),
      stopSessionContainer: (sessionId) => stopSessionContainer(sandboxState, sessionId),
    },
    crud: engineCrud,
  }
}

function buildReconcilerDeps(
  reconcilerCrud: ReconcilerCrudOps, engineDeps: EngineDeps,
): ReconcilerDeps {
  // Reconciler's EngineDeps is an opaque brand and its RunSessionFn talks
  // to that brand. Composition root is the only place the casts live —
  // reconciler hands the same engineDeps bag back to engine.runSession
  // unchanged, so the round-trip is sound.
  return {
    config,
    crud: reconcilerCrud,
    engine: {
      runSession: runSession as unknown as ReconcilerRunSessionFn,
      engineDeps: engineDeps as unknown as ReconcilerEngineDeps,
    },
  }
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
  const { app, db, reconcilerDeps, sandboxState } = buildApp()

  let reconcilerInterval: ReturnType<typeof setInterval> | null = null

  const server = app.listen(config.port, () => {
    console.log(`foundry service listening on port ${config.port}`)
    reconcilerInterval = setInterval(() => {
      reconcilerTick(db, reconcilerDeps, RECONCILER_POLICIES).catch((err: unknown) =>
        console.error('reconciler error:', err))
    }, 5000)
  })

  // ── Graceful shutdown on deploy restart ──
  process.on('SIGTERM', () => shutdown(db, reconcilerDeps, sandboxState, reconcilerInterval))

  return server
}

function shutdown(db: Db, reconcilerDeps: ReconcilerDeps, sandboxState: SandboxState, interval: ReturnType<typeof setInterval> | null) {
  console.log('SIGTERM received, draining…')
  if (interval) clearInterval(interval)
  shutdownDrain(db, reconcilerDeps)
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
