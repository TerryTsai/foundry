// ── Callback API for out-of-process MCP servers (Phase 5+) ──
//
// Today every MCP tool server is an in-process `createSdkMcpServer` (see
// @foundry/mcp/tools/*). They get the Db handle and config by closure when
// the engine boots, so they don't need an HTTP backchannel.
//
// When an MCP server forks out into its own process (Phase 5+), it loses
// the closure and has to call back over HTTP. The shape:
//
//   POST /api/v1/tool/sandbox/exec
//     body: { sessionId, command, args }
//     auth: Bearer ${config.internalApiToken}
//     resp: { executionId } | { error }
//
//   GET  /api/v1/tool/connection/:name
//     auth: Bearer ${config.internalApiToken}
//     resp: { kind, credentials } | { error }
//
//   POST /api/v1/tool/attachment
//     body: raw bytes; query: ticket_id|comment_id, name; header: Content-Type
//     auth: Bearer ${config.internalApiToken}
//     resp: AttachmentMeta | { error }
//
//   POST /api/v1/tool/activity
//     body: { sessionId, kind, payload }
//     auth: Bearer ${config.internalApiToken}
//     resp: { id } | { error }
//
// Note: existing curl-based foundry tool calls (sandbox-hosted scripts that
// hit /ticket, /agent, /session, /attachment) keep using those routes.
// The /api/v1/tool/* namespace is reserved for the *callback* surface,
// distinct from the user-facing API. Implemented when forked-out MCP
// servers actually need it.

import { Router } from 'express'

export function callbackRoutes() {
  const r = Router()
  // Intentionally empty until forked-out MCP servers need it.
  return r
}
