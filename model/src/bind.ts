// bind(client, ctx) — strips Ctx from every method on a service's client
// surface. Used at unit-of-work boundaries (HTTP handler, reconciler tick,
// session start) so downstream code calls `c.ticketCreate(args)` instead
// of threading ctx through every call.
//
// Generic over the client's shape: each service exports its own client
// type (e.g. CrudClient, AuthClient) and bind is one-level — there is
// no aggregate "Client" anymore. Boundaries call bind once per service
// they consume.

import type { Ctx } from './ctx.js'

export type Bound<T> = {
  [K in keyof T]:
    T[K] extends (ctx: Ctx, ...args: infer A) => infer R
      ? (...args: A) => R
      : T[K]
}

export const bind = <T extends object>(client: T, ctx: Ctx): Bound<T> =>
  new Proxy({} as Bound<T>, {
    get: (_t, methodName) => {
      const fn = (client as Record<string | symbol, unknown>)[methodName]
      if (typeof fn !== 'function') return undefined
      return (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(ctx, ...args)
    },
  })
