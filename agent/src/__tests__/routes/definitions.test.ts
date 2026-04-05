import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb } from '../helpers/db.js'
import { definitionsRouter } from '../../routes/definitions.js'

function buildApp() {
  const { db } = createTestDb()
  const app = express()
  app.use(express.json())
  app.use('/agent', definitionsRouter(db))
  return app
}

const base = {
  project_id: 'proj1',
  name: 'coder',
  prompt: 'You are a senior engineer.',
  image: 'node:20',
}

describe('POST /agent', () => {
  it('creates an agent definition', async () => {
    const app = buildApp()
    const res = await request(app).post('/agent').send(base)
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('coder')
    expect(res.body.env).toBe('[]')
  })

  it('stores env as JSON array', async () => {
    const app = buildApp()
    const res = await request(app).post('/agent').send({ ...base, env: ['API_KEY', 'DB_URL'] })
    expect(res.status).toBe(201)
    expect(res.body.env).toBe('["API_KEY","DB_URL"]')
  })

  it('returns 400 if image is missing', async () => {
    const app = buildApp()
    const { image: _i, ...noImage } = base
    const res = await request(app).post('/agent').send(noImage)
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate project_id+name', async () => {
    const app = buildApp()
    await request(app).post('/agent').send(base)
    const res = await request(app).post('/agent').send(base)
    expect(res.status).toBe(409)
  })
})

describe('GET /agent', () => {
  it('lists all definitions', async () => {
    const app = buildApp()
    await request(app).post('/agent').send(base)
    await request(app).post('/agent').send({ ...base, name: 'tester' })
    const res = await request(app).get('/agent')
    expect(res.body).toHaveLength(2)
  })

  it('filters by projectId', async () => {
    const app = buildApp()
    await request(app).post('/agent').send(base)
    await request(app).post('/agent').send({ ...base, project_id: 'proj2' })
    const res = await request(app).get('/agent?projectId=proj1')
    expect(res.body).toHaveLength(1)
  })
})

describe('GET /agent/:id', () => {
  it('returns a definition', async () => {
    const app = buildApp()
    const created = await request(app).post('/agent').send(base)
    const res = await request(app).get(`/agent/${created.body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('coder')
  })

  it('returns 404 for unknown id', async () => {
    const app = buildApp()
    const res = await request(app).get('/agent/nope')
    expect(res.status).toBe(404)
  })
})

describe('PUT /agent/:id', () => {
  it('updates prompt and image', async () => {
    const app = buildApp()
    const created = await request(app).post('/agent').send(base)
    const res = await request(app).put(`/agent/${created.body.id}`).send({ image: 'node:22' })
    expect(res.status).toBe(200)
    expect(res.body.image).toBe('node:22')
  })

  it('returns 404 for unknown id', async () => {
    const app = buildApp()
    const res = await request(app).put('/agent/nope').send({ image: 'node:22' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /agent/:id', () => {
  it('deletes a definition', async () => {
    const app = buildApp()
    const created = await request(app).post('/agent').send(base)
    const del = await request(app).delete(`/agent/${created.body.id}`)
    expect(del.status).toBe(200)
    const get = await request(app).get(`/agent/${created.body.id}`)
    expect(get.status).toBe(404)
  })

  it('returns 404 for unknown id', async () => {
    const app = buildApp()
    const res = await request(app).delete('/agent/nope')
    expect(res.status).toBe(404)
  })
})
