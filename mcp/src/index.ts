// Public surface for @foundry/mcp.
//
// What this module owns: built-in MCP tool servers (foundry, sandbox,
// browser, github) and per-vendor connection-bound tool servers
// (cloudflare, aws, stripe, …). Provides the registry the agent UI
// reads, the connection-provider definitions the connections module
// validates against, and the runtime that engines mount per session.

export { createMcpService } from './service.js'
export type { McpServiceDeps } from './service.js'
export type { McpClient } from './client.js'

export type {
  McpServerInfo, ToolDef, McpToolSelection, McpCategory,
  ConnectionProvider, CredentialField,
  McpConfig, ExecutionCreate, ExecutionCreateInput, ExecHandleEmitter, DecryptSecret,
  McpListEntry, McpError,
} from './schema.js'

// Built-in tool servers
export * as foundryServer from './tools/foundry.js'
export * as sandboxServer from './tools/sandbox.js'
export * as browserServer from './tools/browser.js'
export * as githubServer  from './integrations/github/tools.js'
export type { FoundryCtx } from './tools/foundry.js'
export type { SandboxCtx } from './tools/sandbox.js'
export type { BrowserCtx } from './tools/browser.js'
export type { GithubCtx, PublishResult, GithubProjectGet } from './integrations/github/tools.js'

// Built-in registry
export {
  builtIns, registry, registryGet, TOOL_NAMES,
  filterTools, parseToolSelection,
} from './tools/registry.js'

// Workspace lifecycle (host-side)
export { workspaceEmpty, workspaceDestroy } from './integrations/github/tools.js'

// Vendor / connection provider registry
export {
  byConnectionKind, providerGet, providerList, supportedKinds, providerMetadata,
} from './integrations/registry.js'
export type { ProviderMetadata } from './integrations/registry.js'

// GitHub OAuth / installation helpers (used by the auth module)
export * as github from './integrations/github/provider.js'
export type { GitHubUser } from './integrations/github/provider.js'

// Shared helpers (engines need parseConn, asText, isMcpEnvelope, toolUseId,
// scrubSecrets — secrets-scrub is also re-exported because the connections
// module historically used it from integrations/shared).
export {
  parseConn, asText, isMcpEnvelope, asImage, toolUseId,
  scrubSecrets, esc, bounded, BOUNDED_THRESHOLD, boundedOutput, runCommand,
} from './integrations/shared.js'
export type { ConnCtx, RunCommandOptions, RunCommandCtx } from './integrations/shared.js'

// Agent → MCP listing for the UI
export { agentMcpList } from './agent-mcp-list.js'
export type { ConnectionByAccountFn } from './agent-mcp-list.js'
