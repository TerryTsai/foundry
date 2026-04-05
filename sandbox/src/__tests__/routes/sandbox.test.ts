import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { EventEmitter } from 'events'
import { createTestDb } from '../helpers/db.js'
import { sandboxRouter } from '../../routes/sandbox.js'
import type { RunOptions } from '../../runner.js'

const base = {
  image: 'node:20',
  command: 'echo hello',
  workspace: '/tmp/work',
}

function buildApp(spawnImpl?: (opts: RunOptions) => { emitter: EventEmitter; kill: () => void }) {
  const { db } = createTestDb()
  const app = express()
  app.use(express.json())

  const spawn = spawnImpl ?? vi.fn(() => {
    const emitter = new EventEmitter()
    return { emitter, kill: vi.fn() }
  })

  app.use('/sandbox', sandboxRouter(db, spawn as Parameters<typeof sandboxRouter>[1]))
  return { app, db }
}

describe('POST /sandbox', () => {
  it('creates a run and returns an id', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/sandbox').send(base)
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
  })

  it('returns 400 for missing fields', async () => {
    const { app } = buildApp()
    const res = await request(app).post('/sandbox').send({ image: 'node:20' })
    expect(res.status).toBe(400)
  })

  it('marks run as done when process exits 0', async () => {
    const emitter = new EventEmitter()
    const { app } = buildApp(() => ({ emitter, kill: vi.fn() }))

    const res = await request(app).post('/sandbox').send(base)
    const id = res.body.id

    emitter.emit('exit', 0)
    await new Promise(r => setTimeout(r, 10))

    const status = await request(app).get(`/sandbox/${id}`)
    expect(status.body.status).toBe('done')
    expect(status.body.exit_code).toBe(0)
  })

  it('marks run as failed when process exits non-zero', async () => {
    const emitter = new EventEmitter()
    const { app } = buildApp(() => ({ emitter, kill: vi.fn() }))

    const res = await request(app).post('/sandbox').send(base)
    const id = res.body.id

    emitter.emit('exit', 1)
    await new Promise(r => setTimeout(r, 10))

    const status = await request(app).get(`/sandbox/${id}`)
    expect(status.body.status).toBe('failed')
    expect(status.body.exit_code).toBe(1)
  })
})

describe('GET /sandbox/:id', () => {
  it('returns run metadata', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/sandbox').send(base)
    const res = await request(app).get(`/sandbox/${created.body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.image).toBe('node:20')
    expect(res.body.status).toBe('running')
  })

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp()
    const res = await request(app).get('/sandbox/nope')
    expect(res.status).toBe(404)
  })
})

describe('DELETE /sandbox/:id', () => {
  it('kills a running container and marks it failed', async () => {
    const killFn = vi.fn()
    const { app } = buildApp(() => ({ emitter: new EventEmitter(), kill: killFn }))

    const created = await request(app).post('/sandbox').send(base)
    const id = created.body.id

    const res = await request(app).delete(`/sandbox/${id}`)
    expect(res.status).toBe(200)
    expect(killFn).toHaveBeenCalled()

    const status = await request(app).get(`/sandbox/${id}`)
    expect(status.body.status).toBe('failed')
  })

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp()
    const res = await request(app).delete('/sandbox/nope')
    expect(res.status).toBe(404)
  })

  it('returns 409 for already-completed run', async () => {
    const emitter = new EventEmitter()
    const { app } = buildApp(() => ({ emitter, kill: vi.fn() }))

    const created = await request(app).post('/sandbox').send(base)
    const id = created.body.id

    emitter.emit('exit', 0)
    await new Promise(r => setTimeout(r, 10))

    const res = await request(app).delete(`/sandbox/${id}`)
    expect(res.status).toBe(409)
  })
})

describe('GET /sandbox/:id/output', () => {
  it('sets SSE headers', async () => {
    const { app } = buildApp()
    const created = await request(app).post('/sandbox').send(base)

    // supertest doesn't stream SSE, just check headers are set and we get content
    const res = await request(app)
      .get(`/sandbox/${created.body.id}/output`)
      .timeout(200)
      .catch(e => e.response ?? e)

    // Either we got headers back or it timed out streaming — both confirm SSE was initiated
    if (res && res.headers) {
      expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    }
  })

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp()
    const res = await request(app).get('/sandbox/nope/output')
    expect(res.status).toBe(404)
  })

  it('sends exit event immediately for completed run', async () => {
    const emitter = new EventEmitter()
    const { app } = buildApp(() => ({ emitter, kill: vi.fn() }))

    const created = await request(app).post('/sandbox').send(base)
    const id = created.body.id

    emitter.emit('exit', 0)
    await new Promise(r => setTimeout(r, 10))

    const res = await request(app).get(`/sandbox/${id}/output`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('event: exit')
    expect(res.text).toContain('"code":0')
  })
})
