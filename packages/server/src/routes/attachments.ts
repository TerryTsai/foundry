import { Router } from 'express'
import type { Request, Response } from 'express'
import type { Db } from '@foundry/db'
import type { Result, CrudError } from '@foundry/model'
import { runResult, send } from '../http.js'
import { accountId } from '../account-id.js'
import {
  attachmentGetBytes, attachmentCreate, attachmentListByTicket, attachmentListByComment,
  type AttachmentMeta,
} from '@foundry/crud'

export function attachmentRoutes(db: Db) {
  const r = Router()
  r.get('/:id', (req: Request, res: Response) => streamAttachmentBytes(db, req, res))
  return r
}

function streamAttachmentBytes(db: Db, req: Request, res: Response): void {
  const r = attachmentGetBytes(db, accountId(req), req.params.id)
  if (!r.ok) { res.status(404).json({ error: r.error.kind }); return }
  res.setHeader('Content-Type', r.value.mime)
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.value.name)}"`)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(r.value.bytes)
}

export function ticketAttachmentRoutes(db: Db) {
  const r = Router({ mergeParams: true })
  r.get('/', runResult(req => attachmentListByTicket(db, accountId(req), req.params.id)), send())
  r.post('/', (req: Request, res: Response) => uploadAttachment(db, req, res, 'ticket'))
  return r
}

export function commentAttachmentRoutes(db: Db) {
  const r = Router({ mergeParams: true })
  r.get('/', runResult(req => attachmentListByComment(db, accountId(req), req.params.id)), send())
  r.post('/', (req: Request, res: Response) => uploadAttachment(db, req, res, 'comment'))
  return r
}

function uploadAttachment(db: Db, req: Request, res: Response, parent: 'ticket' | 'comment'): void {
  if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'expected raw body' }); return }
  const meta = doAttachmentCreate(db, req, parent)
  if (!meta.ok) { res.status(meta.status).json({ error: meta.error }); return }
  res.status(201).json(meta.value)
}

function doAttachmentCreate(db: Db, req: Request, parent: 'ticket' | 'comment'): { ok: true; value: AttachmentMeta } | { ok: false; status: number; error: string } {
  const r: Result<AttachmentMeta, CrudError> = attachmentCreate(db, accountId(req), {
    [`${parent}_id`]: req.params.id,
    name: String(req.query.name ?? 'attachment'),
    mime: String(req.headers['content-type'] ?? '').split(';')[0].trim(),
    bytes: req.body as Buffer,
    created_by: String(req.query.created_by ?? 'founder'),
  } as Parameters<typeof attachmentCreate>[2])
  if (r.ok) return { ok: true, value: r.value }
  const status = r.error.kind === 'not_found' ? 404 : 400
  const message = 'reason' in r.error ? r.error.reason : r.error.kind
  return { ok: false, status, error: message }
}
