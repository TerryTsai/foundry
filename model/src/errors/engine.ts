export type EngineError =
  | { kind: 'model_unavailable';  reason: string }
  | { kind: 'max_steps_exceeded'; steps: number }
  | { kind: 'not_found';          entity: string; id: string }
  | { kind: 'crashed';            message: string }
  | { kind: 'internal';           message: string }
