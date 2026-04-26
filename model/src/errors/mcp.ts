export type McpError =
  | { kind: 'server_unavailable'; server: string; reason: string }
  | { kind: 'tool_not_found';     server: string; tool: string }
  | { kind: 'tool_failed';        server: string; tool: string; message: string }
  | { kind: 'invalid_args';       reason: string }
  | { kind: 'internal';           message: string }
