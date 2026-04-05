import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTempRepo } from '../helpers/repo.js'
import { fileRouter } from '../../routes/files.js'

let repoBase: string
let slug: string
let cleanup: () => Promise<void>
let app: express.Express

beforeAll(async () => {
  ;({ repoBase, slug, cleanup } = await createTempRepo())
  app = express()
  app.use(express.json())
  app.use('/repo/:slug/file', fileRouter(repoBase))
})

afterAll(async () => {
  await cleanup()
})

describe('GET /repo/:slug/file', () => {
  it('lists files in HEAD', async () => {
    const res = await request(app).get(`/repo/${slug}/file`)
    expect(res.status).toBe(200)
    expect(res.body).toContain('AGENT.md')
    expect(res.body).toContain('src/index.ts')
  })

  it('returns 404 for unknown slug', async () => {
    const res = await request(app).get('/repo/does-not-exist/file')
    expect(res.status).toBe(404)
  })
})

describe('GET /repo/:slug/file/*', () => {
  it('reads a file from HEAD', async () => {
    const res = await request(app).get(`/repo/${slug}/file/AGENT.md`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('# Agent')
  })

  it('reads a nested file', async () => {
    const res = await request(app).get(`/repo/${slug}/file/src/index.ts`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('hello')
  })

  it('returns 404 for missing file', async () => {
    const res = await request(app).get(`/repo/${slug}/file/notexist.md`)
    expect(res.status).toBe(404)
  })
})

describe('POST /repo/:slug/file/*', () => {
  it('writes a new file and commits it', async () => {
    const res = await request(app)
      .post(`/repo/${slug}/file/notes.md`)
      .send({ content: '# Notes\n', message: 'add notes' })
    expect(res.status).toBe(201)

    // Verify the file is now readable
    const read = await request(app).get(`/repo/${slug}/file/notes.md`)
    expect(read.status).toBe(200)
    expect(read.text).toContain('# Notes')
  })

  it('overwrites an existing file', async () => {
    await request(app)
      .post(`/repo/${slug}/file/AGENT.md`)
      .send({ content: '# Updated\n', message: 'update AGENT.md' })

    const read = await request(app).get(`/repo/${slug}/file/AGENT.md`)
    expect(read.text).toContain('# Updated')
  })

  it('returns 400 if content is missing', async () => {
    const res = await request(app)
      .post(`/repo/${slug}/file/missing.md`)
      .send({ message: 'no content' })
    expect(res.status).toBe(400)
  })
})
