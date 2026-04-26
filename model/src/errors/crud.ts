export type CrudError =
  | { kind: 'not_found';         entity: string; id: string }
  | { kind: 'permission_denied'; reason: string }
  | { kind: 'validation_failed'; field: string; reason: string }
  | { kind: 'conflict';          reason: string }
  | { kind: 'internal';          message: string }
