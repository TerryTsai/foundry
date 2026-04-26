import type { Ctx } from '@foundry/model'

import type { Client, BoundClient } from './types.js'

// Bind a Client to a Ctx, producing a BoundClient where every method has
// ctx already supplied. Implementation uses a two-level Proxy so we don't
// have to enumerate slices or methods — works for any client shape.

export const bind = (client: Client, ctx: Ctx): BoundClient =>
  new Proxy({} as BoundClient, {
    get: (_t, sliceName) => sliceProxy(client, sliceName, ctx),
  })

const sliceProxy = (client: Client, sliceName: string | symbol, ctx: Ctx) => {
  const slice = (client as Record<string | symbol, unknown>)[sliceName]
  if (!slice || typeof slice !== 'object') return undefined
  return new Proxy({}, {
    get: (_t, methodName) => methodProxy(slice as Record<string | symbol, unknown>, methodName, ctx),
  })
}

const methodProxy = (slice: Record<string | symbol, unknown>, methodName: string | symbol, ctx: Ctx) => {
  const fn = slice[methodName]
  if (typeof fn !== 'function') return undefined
  return (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(ctx, ...args)
}
