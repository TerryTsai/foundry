import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestProject } from '../helpers/setup.js'
import { fileRouter } from '../../routes/files.js'

let basePath: string
let slug: string
let cleanup: () => Promise<void>
let app: express.Express

beforeAll(async () => {
  ;({ basePath, slug, cleanup } = await createTestProject())
  app = express()
  app.use(express.json())
  app.use('/file/:slug', fileRouter(basePath))
})

afterAll(async () => {
  await cleanup()
})

describe('GET /file/:slug', () => {
  it('lists files in HEAD', async () => {
    const res = await request(app).get(`/file/${slug}`)
    expect(res.status).toBe(200)
    expect(res.body).toContain('AGENT.md')
    expect(res.body).toContain('src/index.ts')
  })

  it('returns 404 for unknown slug', async () => {
    const res = await request(app).get('/file/does-not-exist')
    expect(res.status).toBe(404)
  })
})

describe('GET /file/:slug/*', () => {
  it('reads a file from HEAD', async () => {
    const res = await request(app).get(`/file/${slug}/AGENT.md`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('# Agent')
  })

  it('reads a nested file', async () => {
    const res = await request(app).get(`/file/${slug}/src/index.ts`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('hello')
  })

  it('returns 404 for missing file', async () => {
    const res = await request(app).get(`/file/${slug}/notexist.md`)
    expect(res.status).toBe(404)
  })
})

describe('POST /file/:slug/*', () => {
  it('writes a new file and commits it', async () => {
    const res = await request(app)
      .post(`/file/${slug}/notes.md`)
      .send({ content: '# Notes\n', message: 'add notes' })
    expect(res.status).toBe(201)

    const read = await request(app).get(`/file/${slug}/notes.md`)
    expect(read.status).toBe(200)
    expect(read.text).toContain('# Notes')
  })

  it('overwrites an existing file', async () => {
    await request(app)
      .post(`/file/${slug}/AGENT.md`)
      .send({ content: '# Updated\n', message: 'update AGENT.md' })

    const read = await request(app).get(`/file/${slug}/AGENT.md`)
    expect(read.text).toContain('# Updated')
  })

  it('returns 400 if content is missing', async () => {
    const res = await request(app)
      .post(`/file/${slug}/missing.md`)
      .send({ message: 'no content' })
    expect(res.status).toBe(400)
  })
})
