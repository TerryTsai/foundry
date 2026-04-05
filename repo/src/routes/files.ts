import { Router } from 'express'
import { join } from 'path'
import { listFiles, readFile, writeFile } from '../git.js'

export function fileRouter(repoBase: string) {
  const router = Router({ mergeParams: true })

  function repoPath(slug: string): string {
    return join(repoBase, `${slug}.git`)
  }

  // GET /repo/:slug/file — list all files
  router.get('/', async (req, res) => {
    const { slug } = req.params as { slug: string }
    try {
      const files = await listFiles(repoPath(slug))
      res.json(files)
    } catch {
      res.status(404).json({ error: 'repo not found or has no commits' })
    }
  })

  // GET /repo/:slug/file/* — read a file
  router.get('/*', async (req, res) => {
    const { slug } = req.params as { slug: string }
    const filePath = req.params[0]
    if (!filePath) {
      res.status(400).json({ error: 'file path required' })
      return
    }
    try {
      const content = await readFile(repoPath(slug), filePath)
      res.type('text/plain').send(content)
    } catch {
      res.status(404).json({ error: 'file not found' })
    }
  })

  // POST /repo/:slug/file/* — write a file + commit
  router.post('/*', async (req, res) => {
    const { slug } = req.params as { slug: string }
    const filePath = req.params[0]
    if (!filePath) {
      res.status(400).json({ error: 'file path required' })
      return
    }

    const { content, message } = req.body as { content?: string; message?: string }
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' })
      return
    }

    const commitMessage = message ?? `update ${filePath}`
    try {
      await writeFile(repoPath(slug), filePath, content, commitMessage)
      res.status(201).json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  return router
}
