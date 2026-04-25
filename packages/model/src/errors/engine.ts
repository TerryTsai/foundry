export type EngineError =
  | { kind: 'model_unavailable';  reason: string }
  | { kind: 'max_steps_exceeded'; steps: number }
  | { kind: 'crashed';            message: string }
  | { kind: 'internal';           message: string }
