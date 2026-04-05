import { Router, type Request, type Response } from 'express'
import { join } from 'path'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'

export function gitRouter(repoBase: string) {
  const repos = new Server(repoBase, { autoCreate: false })

  repos.on('push', (push: { accept: () => void }) => push.accept())
  repos.on('fetch', (fetch: { accept: () => void }) => fetch.accept())
  repos.on('info', (info: { accept: () => void }) => info.accept())

  const router = Router()

  // All git wire protocol requests come through here.
  // nginx routes /repo/:slug.git/* here; node-git-server expects the path
  // to start at the repo name, so we strip the /repo prefix.
  router.all('/:slug\\.git*', (req: Request, res: Response) => {
    // Rewrite the URL so node-git-server sees /:slug.git/...
    req.url = req.url.replace(/^\/repo/, '')
    repos.handle(req, res)
  })

  return router
}
