import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb } from '../helpers/db.js'
import { definitionsRouter } from '../../routes/definitions.js'
import { sessionsRouter } from '../../routes/sessions.js'
import type { Db } from '../../db/client.js'

const deps = { ticketUrl: 'http://ticket', sandboxUrl: 'http://sandbox', repoUrl: 'http://repo' }

const baseDef = {
  project_id: 'proj1',
  name: 'coder',
  prompt: 'You are an engineer.',
  image: 'node:20',
}

const mockTicket = {
  id: 'ticket1',
  project_id: 'proj1',
  title: 'Do something',
  body: 'Fix the bug',
  agent: 'coder',
  status: 'open',
}

function buildApp(runSession = vi.fn().mockResolvedValue(undefined)) {
  const { db } = createTestDb()
  const app = express()
  app.use(express.json())
  app.use('/agent', definitionsRouter(db))
  app.use('/agent/:id/session', sessionsRouter(db, deps, runSession as Parameters<typeof sessionsRouter>[2]))
  return { app, db }
}

async function createDef(app: express.Express) {
  return (await request(app).post('/agent').send(baseDef)).body as { id: string }
}

describe('POST /agent/:id/session', () => {
  it('starts a session when claim succeeds', async () => {
    const runSession = vi.fn().mockResolvedValue(undefined)
    const { app } = buildApp(runSession)
    const def = await createDef(app)

    // Mock fetch: claim → 200, ticket → ticket data
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => mockTicket })
    )

    const res = await request(app).post(`/agent/${def.id}/session`).send({ ticket_id: 'ticket1' })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('running')
    expect(res.body.ticket_id).toBe('ticket1')

    vi.unstubAllGlobals()
  })

  it('returns 409 when claim fails (race)', async () => {
    const { app } = buildApp()
    const def = await createDef(app)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'cannot claim ticket with status claimed' }),
    }))

    const res = await request(app).post(`/agent/${def.id}/session`).send({ ticket_id: 'ticket1' })
    expect(res.status).toBe(409)
    vi.unstubAllGlobals()
  })

  it('returns 404 for unknown agent definition', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/agent/nope/session').send({ ticket_id: 'ticket1' })
    expect(res.status).toBe(404)
  })
})

describe('GET /agent/:id/session/:sid', () => {
  it('returns session status', async () => {
    const { app } = buildApp()
    const def = await createDef(app)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => mockTicket })
    )

    const session = await request(app).post(`/agent/${def.id}/session`).send({ ticket_id: 'ticket1' })
    const sid = session.body.id

    const res = await request(app).get(`/agent/${def.id}/session/${sid}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(sid)

    vi.unstubAllGlobals()
  })
})

describe('DELETE /agent/:id/session/:sid', () => {
  it('kills a running session', async () => {
    const { app } = buildApp()
    const def = await createDef(app)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => mockTicket })
    )

    const session = await request(app).post(`/agent/${def.id}/session`).send({ ticket_id: 'ticket1' })
    const sid = session.body.id

    vi.unstubAllGlobals()

    const res = await request(app).delete(`/agent/${def.id}/session/${sid}`)
    expect(res.status).toBe(200)

    const status = await request(app).get(`/agent/${def.id}/session/${sid}/status`)
    expect(status.body.status).toBe('failed')
  })
})

describe('POST /agent/:id/session/:sid/message', () => {
  it('stores a founder message', async () => {
    const { app } = buildApp()
    const def = await createDef(app)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => mockTicket })
    )

    const session = await request(app).post(`/agent/${def.id}/session`).send({ ticket_id: 'ticket1' })
    const sid = session.body.id
    vi.unstubAllGlobals()

    const msg = await request(app)
      .post(`/agent/${def.id}/session/${sid}/message`)
      .send({ content: 'Please prioritize the auth fix' })
    expect(msg.status).toBe(201)
    expect(msg.body.role).toBe('founder')

    const list = await request(app).get(`/agent/${def.id}/session/${sid}/message`)
    expect(list.body).toHaveLength(1)
  })
})
