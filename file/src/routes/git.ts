import { Router, type Request, type Response } from 'express'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'

export function gitRouter(basePath: string) {
  const repos = new Server(basePath, { autoCreate: false })

  repos.on('push', (push: { accept: () => void }) => push.accept())
  repos.on('fetch', (fetch: { accept: () => void }) => fetch.accept())
  repos.on('info', (info: { accept: () => void }) => info.accept())

  const router = Router()

  // All git wire protocol requests come through here.
  // nginx routes /git/:slug.git/* here; node-git-server expects the path
  // to start at the bare dir name, so we strip the /git prefix.
  router.all('/:slug\\.git*', (req: Request, res: Response) => {
    req.url = req.url.replace(/^\/git/, '')
    repos.handle(req, res)
  })

  return router
}
