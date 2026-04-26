// Empty reconciler adapter — the reconciler is a boot-time singleton, not
// a per-request callable. See slices/reconciler.ts for the rationale.

import type { ReconcilerSlice } from '../slices/reconciler.js'

export const createReconcilerAdapter = (_deps: Record<string, never> = {}): ReconcilerSlice => ({})
