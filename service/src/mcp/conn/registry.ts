import type { ConnectionToolDef } from '../../connections/types.js'
import { tools as cloudflare } from './cloudflare.js'

// Flat kind → tools map. Add a new connection-contributed MCP tool set
// by importing its tool array and appending an entry here.

export const toolsByKind: Record<string, ConnectionToolDef[]> = {
  cloudflare,
}
