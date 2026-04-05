import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb } from '../helpers/db.js'
import { ticketRouter } from '../../routes/tickets.js'

function buildApp() {
  const { db, sqlite } = createTestDb()
  const app = express()
  app.use(express.json())
  app.use('/ticket', ticketRouter(db, sqlite))
  return app
}

const base = { project_id: 'proj1', title: 'Test', body: 'Do it', agent: 'coder', created_by: 'founder' }

describe('POST /ticket', () => {
  it('creates a ticket', async () => {
    const app = buildApp()
    const res = await request(app).post('/ticket').send(base)
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.status).toBe('open')
  })

  it('returns 400 for missing required fields', async () => {
    const app = buildApp()
    const res = await request(app).post('/ticket').send({ title: 'No project' })
    expect(res.status).toBe(400)
  })
})

describe('GET /ticket', () => {
  it('lists all tickets', async () => {
    const app = buildApp()
    await request(app).post('/ticket').send(base)
    await request(app).post('/ticket').send({ ...base, title: 'Second' })
    const res = await request(app).get('/ticket')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  it('filters by projectId', async () => {
    const app = buildApp()
    await request(app).post('/ticket').send(base)
    await request(app).post('/ticket').send({ ...base, project_id: 'proj2' })
    const res = await request(app).get('/ticket?projectId=proj1')
    expect(res.body).toHaveLength(1)
  })

  it('filters by status', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    await request(app).post('/ticket/:id/claim'.replace(':id', created.body.id))
    const res = await request(app).get('/ticket?status=claimed')
    expect(res.body).toHaveLength(1)
  })
})

describe('GET /ticket/:id', () => {
  it('returns a ticket', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    const res = await request(app).get(`/ticket/${created.body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Test')
  })

  it('returns 404 for unknown id', async () => {
    const app = buildApp()
    const res = await request(app).get('/ticket/nope')
    expect(res.status).toBe(404)
  })
})

describe('PUT /ticket/:id', () => {
  it('updates body and notes', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    const res = await request(app).put(`/ticket/${created.body.id}`).send({ body: 'updated', notes: 'some notes' })
    expect(res.status).toBe(200)
    expect(res.body.body).toBe('updated')
    expect(res.body.notes).toBe('some notes')
  })
})

describe('POST /ticket/:id/claim', () => {
  it('claims an open ticket', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    const res = await request(app).post(`/ticket/${created.body.id}/claim`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('claimed')
    expect(res.body.claimed_at).toBeDefined()
  })

  it('returns 409 if already claimed', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    await request(app).post(`/ticket/${created.body.id}/claim`)
    const res = await request(app).post(`/ticket/${created.body.id}/claim`)
    expect(res.status).toBe(409)
  })

  it('returns 409 for non-open statuses', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    await request(app).post(`/ticket/${created.body.id}/claim`)
    await request(app).post(`/ticket/${created.body.id}/fail`)
    const res = await request(app).post(`/ticket/${created.body.id}/claim`)
    expect(res.status).toBe(409)
  })
})

describe('POST /ticket/:id/done', () => {
  it('marks a claimed ticket done', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    await request(app).post(`/ticket/${created.body.id}/claim`)
    const res = await request(app).post(`/ticket/${created.body.id}/done`).send({ notes: 'finished' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('done')
    expect(res.body.notes).toBe('finished')
  })

  it('returns 409 if not claimed', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    const res = await request(app).post(`/ticket/${created.body.id}/done`)
    expect(res.status).toBe(409)
  })

  it('unblocks parent when child is done', async () => {
    const app = buildApp()

    // Create parent and claim it
    const parent = await request(app).post('/ticket').send(base)
    await request(app).post(`/ticket/${parent.body.id}/claim`)

    // Create child with block:true — parent becomes blocked
    const child = await request(app).post('/ticket').send({
      ...base,
      title: 'Child',
      parent_id: parent.body.id,
      block: true,
    })
    expect(child.status).toBe(201)

    const blockedParent = await request(app).get(`/ticket/${parent.body.id}`)
    expect(blockedParent.body.status).toBe('blocked')

    // Claim and complete the child
    await request(app).post(`/ticket/${child.body.id}/claim`)
    await request(app).post(`/ticket/${child.body.id}/done`)

    // Parent should now be open again
    const unblockedParent = await request(app).get(`/ticket/${parent.body.id}`)
    expect(unblockedParent.body.status).toBe('open')
  })
})

describe('POST /ticket/:id/fail', () => {
  it('marks a claimed ticket failed', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    await request(app).post(`/ticket/${created.body.id}/claim`)
    const res = await request(app).post(`/ticket/${created.body.id}/fail`).send({ notes: 'blew up' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('failed')
  })

  it('returns 409 if not claimed', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    const res = await request(app).post(`/ticket/${created.body.id}/fail`)
    expect(res.status).toBe(409)
  })
})

describe('POST /ticket/:id/reopen', () => {
  it('reopens a failed ticket', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    await request(app).post(`/ticket/${created.body.id}/claim`)
    await request(app).post(`/ticket/${created.body.id}/fail`)
    const res = await request(app).post(`/ticket/${created.body.id}/reopen`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('open')
    expect(res.body.claimed_at).toBeNull()
  })

  it('returns 409 if not failed', async () => {
    const app = buildApp()
    const created = await request(app).post('/ticket').send(base)
    const res = await request(app).post(`/ticket/${created.body.id}/reopen`)
    expect(res.status).toBe(409)
  })
})

describe('GET /ticket/:id/chain', () => {
  it('returns single ticket chain', async () => {
    const app = buildApp()
    const t = await request(app).post('/ticket').send(base)
    const res = await request(app).get(`/ticket/${t.body.id}/chain`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(t.body.id)
  })

  it('returns root-first chain for nested tickets', async () => {
    const app = buildApp()
    const root = await request(app).post('/ticket').send({ ...base, title: 'Root' })
    await request(app).post(`/ticket/${root.body.id}/claim`)
    const child = await request(app).post('/ticket').send({ ...base, title: 'Child', parent_id: root.body.id })
    await request(app).post(`/ticket/${child.body.id}/claim`)
    const grandchild = await request(app).post('/ticket').send({ ...base, title: 'Grandchild', parent_id: child.body.id })

    const res = await request(app).get(`/ticket/${grandchild.body.id}/chain`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body[0].title).toBe('Root')
    expect(res.body[1].title).toBe('Child')
    expect(res.body[2].title).toBe('Grandchild')
  })

  it('returns 404 for unknown id', async () => {
    const app = buildApp()
    const res = await request(app).get('/ticket/nope/chain')
    expect(res.status).toBe(404)
  })
})
