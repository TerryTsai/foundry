import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Config } from './config.js'
import { repositoryWorkerToken } from './github.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('repository worker token', () => {
  it('falls back when GitHub App credentials are absent', async () => {
    const token = await repositoryWorkerToken({ githubAppId: undefined, githubAppPrivateKey: '' } as Config, 'fine-grained-token', 'owner/repo')
    expect(token).toBe('fine-grained-token')
  })

  it('mints an installation token narrowed to one repository', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'scoped-token' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const token = await repositoryWorkerToken({ githubAppId: 7, githubAppPrivateKey: pem } as Config, 'broad-token', 'owner/repo')
    expect(token).toBe('scoped-token')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/repos/owner/repo/installation')
    const options = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(options.body))).toEqual({ repositories: ['repo'], permissions: { contents: 'write', metadata: 'read' } })
  })
})
