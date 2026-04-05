import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeCreateTicketTool } from '../../tools/create_ticket.js'

const deps = {
  ticketUrl: 'http://ticket:3002',
  projectId: 'proj1',
  currentTicketId: 'parent-ticket',
  agentName: 'coder',
}

afterEach(() => vi.unstubAllGlobals())

describe('create_ticket tool', () => {
  it('creates a ticket and returns ticket_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'new-ticket-id' }),
    }))

    const tool = makeCreateTicketTool(deps)
    const result = JSON.parse(await tool.execute({
      title: 'Fix auth',
      body: 'The auth middleware is broken',
      agent: 'coder',
      block: false,
    })) as { ticket_id: string }

    expect(result.ticket_id).toBe('new-ticket-id')
  })

  it('passes block and parent_id to ticket service', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(async (_url: string, opts: { body?: string }) => {
      capturedBody = JSON.parse(opts?.body ?? '{}') as Record<string, unknown>
      return { ok: true, json: async () => ({ id: 'child-id' }) }
    }))

    const tool = makeCreateTicketTool(deps)
    await tool.execute({ title: 'Child', body: 'Blocked', agent: 'coder', block: true })

    expect(capturedBody.block).toBe(true)
    expect(capturedBody.parent_id).toBe('parent-ticket')
    expect(capturedBody.created_by).toBe('coder')
  })

  it('returns error on ticket service failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    }))

    const tool = makeCreateTicketTool(deps)
    const result = JSON.parse(await tool.execute({
      title: 'Fail',
      body: 'This will fail',
      agent: 'coder',
      block: false,
    })) as { error: string }

    expect(result.error).toMatch(/failed to create ticket/)
  })
})
