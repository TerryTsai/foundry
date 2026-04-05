import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { projects } from '../db/schema.js'
import { dispatch, recoverStalledTickets } from '../scheduler.js'

const deps = { ticketUrl: 'http://ticket', agentUrl: 'http://agent' }

afterEach(() => vi.unstubAllGlobals())

function seedProject(db: ReturnType<typeof createTestDb>['db'], overrides: Partial<typeof projects.$inferInsert> = {}) {
  const id = 'proj1'
  db.insert(projects).values({
    id,
    name: 'Test Project',
    slug: 'test-project',
    status: 'active',
    workspace: '/repos/test.git',
    schedule_interval: 600,
    concurrency_limit: 2,
    created_at: new Date().toISOString(),
    ...overrides,
  }).run()
  return id
}

describe('dispatch', () => {
  it('starts sessions for open tickets up to concurrency limit', async () => {
    const { db } = createTestDb()
    const projectId = seedProject(db)

    const fetchMock = vi.fn()
      // open tickets: 3
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 't1', agent: 'coder', status: 'open', claimed_at: null },
        { id: 't2', agent: 'coder', status: 'open', claimed_at: null },
        { id: 't3', agent: 'tester', status: 'open', claimed_at: null },
      ]})
      // claimed tickets: 0
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      // agent defs
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 'a1', name: 'coder' },
        { id: 'a2', name: 'tester' },
      ]})
      // session starts (fire-and-forget, 2 sessions for concurrency_limit=2)
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    vi.stubGlobal('fetch', fetchMock)

    await dispatch(db, projectId, deps)
    await new Promise(r => setTimeout(r, 10))

    // Should start exactly 2 sessions (concurrency_limit=2, claimed=0)
    const sessionCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/session')
    )
    expect(sessionCalls).toHaveLength(2)
  })

  it('skips dispatch when at concurrency limit', async () => {
    const { db } = createTestDb()
    const projectId = seedProject(db, { concurrency_limit: 1 })

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 't1', agent: 'coder', status: 'open' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 't2', agent: 'coder', status: 'claimed' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'a1', name: 'coder' }] })
    )

    await dispatch(db, projectId, deps)

    const fetchFn = vi.mocked(fetch)
    const sessionCalls = fetchFn.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/session')
    )
    expect(sessionCalls).toHaveLength(0)
  })

  it('skips tickets with no matching agent definition', async () => {
    const { db } = createTestDb()
    const projectId = seedProject(db)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 't1', agent: 'unknown-agent', status: 'open', claimed_at: null },
      ]})
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'a1', name: 'coder' }] })
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    vi.stubGlobal('fetch', fetchMock)
    await dispatch(db, projectId, deps)
    await new Promise(r => setTimeout(r, 10))

    const sessionCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/session')
    )
    expect(sessionCalls).toHaveLength(0)
  })

  it('does nothing for paused projects', async () => {
    const { db } = createTestDb()
    const projectId = seedProject(db, { status: 'paused' })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await dispatch(db, projectId, deps)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('recoverStalledTickets', () => {
  it('reopens tickets claimed beyond schedule_interval * 3', async () => {
    const { db } = createTestDb()
    seedProject(db, { schedule_interval: 10 })  // threshold: 30 seconds

    const oldClaim = new Date(Date.now() - 60_000).toISOString()  // 60s ago, older than 30s threshold

    const fetchMock = vi.fn()
      // claimed tickets
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 'stale-ticket', agent: 'coder', status: 'claimed', claimed_at: oldClaim },
      ]})
      // reopen call
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    vi.stubGlobal('fetch', fetchMock)

    await recoverStalledTickets(db, deps)
    await new Promise(r => setTimeout(r, 10))

    const reopenCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/reopen')
    )
    expect(reopenCalls).toHaveLength(1)
  })

  it('does not reopen recently claimed tickets', async () => {
    const { db } = createTestDb()
    seedProject(db, { schedule_interval: 600 })

    const recentClaim = new Date(Date.now() - 100).toISOString()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 'fresh-ticket', agent: 'coder', status: 'claimed', claimed_at: recentClaim },
      ]})
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    vi.stubGlobal('fetch', fetchMock)

    await recoverStalledTickets(db, deps)
    await new Promise(r => setTimeout(r, 10))

    const reopenCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/reopen')
    )
    expect(reopenCalls).toHaveLength(0)
  })
})
