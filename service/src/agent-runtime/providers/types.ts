// A connection provider is a single-file declaration of everything Foundry
// needs to accept and validate credentials for an external integration.
// LLM providers (anthropic, openai) expose model factories through
// runtime/model.ts; tool-bearing integrations (cloudflare) expose their
// tools through mcp/<kind>.ts — connection files stay credential-only.
//
// Add a new connection kind: write one file here and import it in
// connections/registry.ts. If it's tool-bearing, also add one file in
// mcp/<kind>.ts and register it in mcp/registry.ts::byConnectionKind.

export interface CredentialField {
  key:          string
  label:        string
  type:         'text' | 'password' | 'select' | 'textarea'
  placeholder?: string
  options?:     string[]    // for 'select'
  required?:    boolean     // default true
  help?:        string      // small text rendered under the field
}

export interface ConnectionProvider {
  kind:         string
  name:         string
  credentials:  CredentialField[]

  // Server-side validation beyond field presence. Receives decoded
  // secrets + config. Return null for OK, a string message for rejection.
  validate?:    (secrets: Record<string, unknown>, config: Record<string, unknown>) => string | null
}
