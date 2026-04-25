import { describe, it, expect } from 'vitest'
import { makeCtx, ok, err } from '@foundry/model'
import type { Ctx, Result, CrudError, Ticket } from '@foundry/model'

import { bind } from '../src/bind.js'

// A minimal client shape for testing the bind machinery. The real Client
// type is built from slices in src/types.ts.
type TestClient = {
  crud: {
    ticketGet:    (ctx: Ctx, id: string) => Promise<Result<Ticket, CrudError>>
    activityStream: (ctx: Ctx, sessionId: string) => AsyncIterable<Result<{ x: number }, CrudError>>
  }
}

describe('bind', () => {
  it('strips ctx from method signatures and forwards args', async () => {
    let seenCtx: Ctx | null = null
    let seenId:  string    = ''
    const client: TestClient = {
      crud: {
        ticketGet: async (ctx, id) => {
          seenCtx = ctx
          seenId  = id
          return ok({ id } as Ticket)
        },
        activityStream: async function* (_ctx, _sid) {
          yield ok({ x: 1 })
          yield err({ kind: 'internal', message: 'boom' })
        },
      },
    }

    const ctx = makeCtx({ accountId: 'a_test' })
    const bound = bind(client as unknown as Parameters<typeof bind>[0], ctx) as unknown as {
      crud: {
        ticketGet:      (id: string) => Promise<Result<Ticket, CrudError>>
        activityStream: (sid: string) => AsyncIterable<Result<{ x: number }, CrudError>>
      }
    }

    const r = await bound.crud.ticketGet('t_1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.id).toBe('t_1')
    expect(seenCtx?.accountId).toBe('a_test')
    expect(seenId).toBe('t_1')

    const items: Result<{ x: number }, CrudError>[] = []
    for await (const item of bound.crud.activityStream('s_1')) items.push(item)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ ok: true, value: { x: 1 } })
    expect(items[1].ok).toBe(false)
  })

  it('returns undefined for unknown slice', () => {
    const ctx = makeCtx()
    const bound = bind({} as Parameters<typeof bind>[0], ctx)
    expect((bound as Record<string, unknown>).nonexistent).toBeUndefined()
  })
})
