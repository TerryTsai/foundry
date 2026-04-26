// Vendor folders import this thin shim to keep their imports stable.
// The real types live in ../schema.ts (top-level module surface).

export type {
  CredentialField, ConnectionProvider,
  ToolDef, McpServerInfo, McpToolSelection, McpCategory,
} from '../schema.js'
