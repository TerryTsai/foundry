// HTTP adapter — stub.
//
// The composition root in @foundry/server uses createInProcessClient to
// wire every module slice as an in-process function call. The HTTP adapter
// is needed only when a logic module forks out into its own process and
// the calling side has to reach it over the wire (per ARCHITECTURE.md, the
// "fork out on demand" goal).
//
// Real implementation is Phase 5+: per-module HTTP clients that POST a
// JSON-encoded args envelope to /api/v1/<module>/<method>, parse the
// Result, and throw on transport-level non-2xx. Streaming methods upgrade
// to NDJSON or SSE.
//
// Until then, every method on a returned slice throws a clear error so
// that any accidental wiring blows up at first invocation rather than
// silently no-oping.

import type { Client } from '../types.js'

export type HttpAdapterConfig = {
  baseUrl: string
  // Bearer token used for inter-service auth. The server side accepts this
  // as an alternative to a session cookie (see config.internalApiToken).
  token: string
}

const NOT_IMPLEMENTED = 'http adapter not implemented (Phase 5+); use createInProcessClient'

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder; signature locked for Phase 5
export function createHttpAdapter<S extends keyof Client>(_module: S, _cfg: HttpAdapterConfig): Client[S] {
  return new Proxy({} as Client[S], {
    get() {
      return () => { throw new Error(NOT_IMPLEMENTED) }
    },
  })
}
