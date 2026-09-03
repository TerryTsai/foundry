import { sign } from 'node:crypto'

import type { Config } from './config.js'
import type { GithubContent, GithubRepository } from './schema.js'

export async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'foundry-control-plane',
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function listRepositories(token: string): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubRequest<GithubRepository[]>(token, `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`)
    repositories.push(...batch.filter(repo => !repo.archived && !repo.disabled))
    if (batch.length < 100) break
  }
  return repositories
}

export async function getContent(token: string, repo: string, path: string): Promise<GithubContent | GithubContent[] | null> {
  try {
    return await githubRequest<GithubContent | GithubContent[]>(token, `/repos/${repo}/contents/${encodePath(path)}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('GitHub 404:')) return null
    throw error
  }
}

export async function getTextFile(token: string, repo: string, path: string): Promise<{ sha: string; text: string } | null> {
  const content = await getContent(token, repo, path)
  if (!content || Array.isArray(content) || content.type !== 'file') return null
  if (content.encoding !== 'base64' || !content.content) throw new Error(`Unsupported GitHub content encoding for ${path}`)
  return { sha: content.sha, text: Buffer.from(content.content.replace(/\n/g, ''), 'base64').toString('utf8') }
}

export async function putTextFile(
  token: string, repo: string, path: string, text: string, message: string, branch: string, sha?: string,
): Promise<void> {
  await githubRequest(token, `/repos/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(text).toString('base64'), branch, ...(sha ? { sha } : {}) }),
  })
}

export async function listCommitsForPath(token: string, repo: string, path: string): Promise<unknown[]> {
  return githubRequest<unknown[]>(token, `/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=30`)
}

export async function exchangeGithubCode(clientId: string, clientSecret: string, code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })
  const body = await response.json() as { access_token?: string; error_description?: string }
  if (!body.access_token) throw new Error(body.error_description || 'GitHub did not return an access token')
  return body.access_token
}

export async function repositoryWorkerToken(config: Config, fallbackToken: string, projectId: string): Promise<string> {
  if (!config.githubAppId || !config.githubAppPrivateKey) return fallbackToken
  const [owner, repo] = projectId.split('/') as [string, string]
  const jwt = githubAppJwt(config.githubAppId, config.githubAppPrivateKey)
  const installation = await githubRequest<{ id: number }>(jwt, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`)
  const token = await githubRequest<{ token: string }>(jwt, `/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositories: [repo], permissions: { contents: 'write', metadata: 'read' } }),
  })
  return token.token
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function githubAppJwt(appId: number, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  // Keep a generous clock-skew allowance while staying inside GitHub's 10-minute JWT window.
  const payload = Buffer.from(JSON.stringify({ iat: now - 300, exp: now + 300, iss: appId })).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}
