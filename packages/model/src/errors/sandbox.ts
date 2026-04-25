export type SandboxError =
  | { kind: 'container_unavailable'; reason: string }
  | { kind: 'exec_failed';           exit_code: number; message: string }
  | { kind: 'timeout';               timeout_ms: number }
  | { kind: 'not_found';             id: string }
  | { kind: 'permission_denied';     reason: string }
  | { kind: 'conflict';              reason: string }
  | { kind: 'validation_failed';     field: string; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'internal';              message: string }
