import type { z } from 'zod'

// ════════════════════════════════════════════════════════════════════════════
// CONNECTION PROVIDER
// ════════════════════════════════════════════════════════════════════════════
// A provider is a single-file declaration of everything Foundry needs to
// accept credentials for, talk to, and (optionally) generate tools for an
// external integration. LLM providers ship a `modelFactory`; non-model
// integrations ship `tools`. A provider may have both (unusual) or neither
// (e.g. 'anthropic-subscription', whose lifecycle is owned by sdk-runner).
//
// Providers ship in the codebase — see service/src/connections/registry.ts.
// No dynamic loading, no npm packages per provider. "Add a new connection
// kind" = write one file and import it in the registry.

export interface CredentialField {
  key:          string
  label:        string
  type:         'text' | 'password' | 'select' | 'textarea'
  placeholder?: string
  options?:     string[]    // for 'select'
  required?:    boolean     // default true
  help?:        string      // small text rendered under the field
}

// Context passed to tool `run` builders. Secrets and config are parsed
// from the connection row — the handler can reference whatever fields
// its provider declared in `credentials`.
export interface ConnectionToolCtx {
  secrets:        Record<string, string>
  config:         Record<string, unknown>
  connectionId:   string
  connectionName: string
}

// Artifact copy spec — drives the isolated-sandbox model. `artifactsIn`
// entries are copied host→container before the command runs (destination
// under /input). `artifactsOut` entries are copied container→host after
// a successful exit (source under /output, destination relative to the
// agent's /work). When either is present, /work itself is NOT mounted —
// the command can only see what's in the input allowlist.
export interface ArtifactSpec {
  src:  string   // path relative to workspace (artifactsIn) or /output (artifactsOut)
  dest: string   // path relative to /input (artifactsIn) or workspace (artifactsOut)
}

// Sandbox run specification returned by a tool's `run` function. The
// tool server factory feeds this to runCommand. Secrets are passed via
// `env` only — they are never persisted on the execution row.
//
// Two workspace models:
//   (1) Shared workspace (default): /work is bind-mounted from the
//       session workspace per `mount` mode. Used by tier-1 tools that
//       read/write the agent's workspace directly.
//   (2) Isolated workspace (opt-in via artifactsIn/artifactsOut): /work
//       is NOT mounted. The command sees only /input (copied-in allowlist,
//       ro) and optionally /output (rw scratch, copied back to /work on
//       success). Used by credential-holding tools so they can only touch
//       the specific artifacts they declared.
export interface ToolRunSpec {
  command:       string
  env?:          Record<string, string>
  network?:      boolean                   // default false
  mount?:        'rw' | 'ro' | 'none'      // default 'none'; ignored when artifactsIn/Out are set
  artifactsIn?:  ArtifactSpec[]
  artifactsOut?: ArtifactSpec[]
}

export interface ToolRunResult {
  stdout:   string
  stderr:   string
  exitCode: number
}

// A provider-contributed MCP tool. Runs inside a sandbox container via
// runCommand (same as every other tool in the system). This preserves
// the invariants: per-tool execution rows, cgroup isolation, audit
// trail, tool_use_id correlation back to agent-domain activities.
export interface ConnectionToolDef<Args = Record<string, unknown>, Result = unknown> {
  name:        string
  description: string
  parameters:  z.ZodObject<z.ZodRawShape>

  // Build the sandbox command + env. Secrets from the connection are
  // available via ctx.secrets; the handler must explicitly include them
  // in `env` if the command needs them (no automatic injection — keeps
  // the secret trail visible per-tool).
  run(args: Args, ctx: ConnectionToolCtx): ToolRunSpec

  // Optional post-processor. Default: { stdout, exitCode }.
  parse?(r: ToolRunResult): Result
}

export interface ConnectionProvider {
  kind:         string
  name:         string
  credentials:  CredentialField[]

  // Server-side validation beyond field presence. Receives decoded
  // secrets + config. Return null for OK, a string message for rejection.
  validate?:    (secrets: Record<string, unknown>, config: Record<string, unknown>) => string | null
}
