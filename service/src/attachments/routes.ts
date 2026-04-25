import { Router } from 'express'
import type { Request, Response } from 'express'
import type { Db } from '../core/db.js'
import { run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import {
  attachmentGetBytes, attachmentCreate, attachmentListByTicket, attachmentListByComment,
} from '@foundry/crud'

export function attachmentRoutes(db: Db) {
  const r = Router()

  // Stream raw bytes. Used by the web UI for inline previews and by
  // the sandbox tool (see foundry.ts attachmentGet) when an agent
  // explicitly loads an attachment.
  r.get('/:id', (req: Request, res: Response) => {
    try {
      const { mime, name, bytes } = attachmentGetBytes(db, accountId(req), req.params.id)
      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.end(bytes)
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500
      res.status(status).json({ error: (err as Error).message })
    }
  })

  return r
}

// Attachments for a ticket are mounted under /ticket/:id/attachment to
// keep URLs hierarchical. Upload is raw bytes with a filename query
// param and a Content-Type header naming the mime.
export function ticketAttachmentRoutes(db: Db) {
  const r = Router({ mergeParams: true })

  r.get('/', run(req => attachmentListByTicket(db, accountId(req), req.params.id)), send())

  r.post('/', (req: Request, res: Response) => {
    try {
      const name = String(req.query.name ?? 'attachment')
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim()
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'expected raw body' }); return
      }
      const createdBy = String(req.query.created_by ?? 'founder')
      const meta = attachmentCreate(db, accountId(req), {
        ticket_id: req.params.id,
        name,
        mime,
        bytes: req.body as Buffer,
        created_by: createdBy,
      })
      res.status(201).json(meta)
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500
      res.status(status).json({ error: (err as Error).message })
    }
  })

  return r
}

export function commentAttachmentRoutes(db: Db) {
  const r = Router({ mergeParams: true })

  r.get('/', run(req => attachmentListByComment(db, accountId(req), req.params.id)), send())

  r.post('/', (req: Request, res: Response) => {
    try {
      const name = String(req.query.name ?? 'attachment')
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim()
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'expected raw body' }); return
      }
      const createdBy = String(req.query.created_by ?? 'founder')
      const meta = attachmentCreate(db, accountId(req), {
        comment_id: req.params.id,
        name,
        mime,
        bytes: req.body as Buffer,
        created_by: createdBy,
      })
      res.status(201).json(meta)
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500
      res.status(status).json({ error: (err as Error).message })
    }
  })

  return r
}
