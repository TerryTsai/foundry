import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Attachment } from '@foundry/db'
import type { Result, CrudError } from '@foundry/model'
import { ok, err, now } from '@foundry/model'
import { ticketOwned, assertProjectOwner } from './project.js'
import * as database from './repo.js'

const ALLOWED_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
])
const MAX_BYTES = 10 * 1024 * 1024

export interface AttachmentMeta {
  id:         string
  ticket_id:  string | null
  comment_id: string | null
  name:       string
  mime:       string
  size:       number
  created_by: string
  created_at: string
}

function toMeta(a: Attachment): AttachmentMeta {
  return {
    id: a.id, ticket_id: a.ticket_id, comment_id: a.comment_id,
    name: a.name, mime: a.mime, size: a.size,
    created_by: a.created_by, created_at: a.created_at,
  }
}

export interface AttachmentCreateInput {
  ticket_id?: string
  comment_id?: string
  name: string
  mime: string
  bytes: Buffer
  created_by: string
}

export function attachmentCreate(
  db: Db, accountId: string, input: AttachmentCreateInput,
): Result<AttachmentMeta, CrudError> {
  const validated = validateAttachmentInput(input)
  if (!validated.ok) return validated
  const auth = authorizeAttachment(db, accountId, input)
  if (!auth.ok) return auth
  return ok(toMeta(insertAttachment(db, input)))
}

function validateAttachmentInput(input: AttachmentCreateInput): Result<void, CrudError> {
  if (!ALLOWED_MIMES.has(input.mime)) return err({ kind: 'conflict', reason: `unsupported mime type: ${input.mime}` })
  if (input.bytes.length === 0) return err({ kind: 'conflict', reason: 'empty attachment' })
  if (input.bytes.length > MAX_BYTES) return err({ kind: 'conflict', reason: `attachment too large (${input.bytes.length} bytes; max ${MAX_BYTES})` })
  if (!input.ticket_id && !input.comment_id) return err({ kind: 'conflict', reason: 'attachment must reference a ticket or comment' })
  if (input.ticket_id && input.comment_id) return err({ kind: 'conflict', reason: 'attachment cannot reference both a ticket and a comment' })
  return ok(undefined)
}

function authorizeAttachment(
  db: Db, accountId: string, input: AttachmentCreateInput,
): Result<void, CrudError> {
  if (input.ticket_id) {
    const owned = ticketOwned(db, input.ticket_id, accountId)
    return owned.ok ? ok(undefined) : owned
  }
  const c = database.commentGet(db, input.comment_id!)
  if (!c) return err({ kind: 'not_found', entity: 'comment', id: input.comment_id! })
  const owned = ticketOwned(db, c.ticket_id, accountId)
  return owned.ok ? ok(undefined) : owned
}

function insertAttachment(db: Db, input: AttachmentCreateInput): Attachment {
  const id = ulid()
  db.insert(schema.attachment).values({
    id,
    ticket_id:  input.ticket_id ?? null,
    comment_id: input.comment_id ?? null,
    name: input.name, mime: input.mime, size: input.bytes.length,
    bytes: input.bytes, created_by: input.created_by, created_at: now(),
  }).run()
  return db.select().from(schema.attachment).where(eq(schema.attachment.id, id)).get() as Attachment
}

const metaCols = {
  id:         schema.attachment.id,
  ticket_id:  schema.attachment.ticket_id,
  comment_id: schema.attachment.comment_id,
  name:       schema.attachment.name,
  mime:       schema.attachment.mime,
  size:       schema.attachment.size,
  created_by: schema.attachment.created_by,
  created_at: schema.attachment.created_at,
}

export function attachmentListByTicket(db: Db, accountId: string, ticketId: string): Result<AttachmentMeta[], CrudError> {
  const owned = ticketOwned(db, ticketId, accountId)
  if (!owned.ok) return owned
  return ok(attachmentRowsForTicket(db, ticketId))
}

function attachmentRowsForTicket(db: Db, ticketId: string): AttachmentMeta[] {
  const direct = db.select(metaCols).from(schema.attachment)
    .where(eq(schema.attachment.ticket_id, ticketId)).all() as AttachmentMeta[]
  const viaComments = db.select(metaCols).from(schema.attachment)
    .innerJoin(schema.comment, eq(schema.comment.id, schema.attachment.comment_id))
    .where(eq(schema.comment.ticket_id, ticketId)).all() as AttachmentMeta[]
  return [...direct, ...viaComments]
}

export function attachmentListByComment(db: Db, accountId: string, commentId: string): Result<AttachmentMeta[], CrudError> {
  const c = database.commentGet(db, commentId)
  if (!c) return err({ kind: 'not_found', entity: 'comment', id: commentId })
  const owned = ticketOwned(db, c.ticket_id, accountId)
  if (!owned.ok) return owned
  const rows = db.select(metaCols).from(schema.attachment)
    .where(eq(schema.attachment.comment_id, commentId)).all() as AttachmentMeta[]
  return ok(rows)
}

export interface AttachmentBytes { mime: string; name: string; bytes: Buffer }

export function attachmentGetBytes(
  db: Db, accountId: string, id: string,
): Result<AttachmentBytes, CrudError> {
  const row = db.select().from(schema.attachment).where(eq(schema.attachment.id, id)).get() as Attachment | undefined
  if (!row) return err({ kind: 'not_found', entity: 'attachment', id })
  const parentTicketId = parentTicketIdFor(db, row)
  if (!parentTicketId) return err({ kind: 'not_found', entity: 'attachment', id })
  return authorizeAttachmentBytes(db, accountId, row, parentTicketId)
}

function parentTicketIdFor(db: Db, row: Attachment): string | null {
  if (row.ticket_id) return row.ticket_id
  if (!row.comment_id) return null
  const c = database.commentGet(db, row.comment_id)
  return c?.ticket_id ?? null
}

function authorizeAttachmentBytes(
  db: Db, accountId: string, row: Attachment, parentTicketId: string,
): Result<AttachmentBytes, CrudError> {
  const t = database.ticketGet(db, parentTicketId)
  if (!t) return err({ kind: 'not_found', entity: 'attachment', id: row.id })
  const owner = assertProjectOwner(db, t.project_id, accountId)
  if (!owner.ok) return err({ kind: 'not_found', entity: 'attachment', id: row.id })
  return ok({ mime: row.mime, name: row.name, bytes: row.bytes as Buffer })
}

// ── Internal (session runner; no ownership check) ────────────────────

export function attachmentListByTicketInternal(db: Db, ticketId: string): AttachmentMeta[] {
  return attachmentRowsForTicket(db, ticketId)
}

export function attachmentGetInternal(db: Db, id: string): { mime: string; name: string; bytes: Buffer } | null {
  const row = db.select().from(schema.attachment)
    .where(eq(schema.attachment.id, id)).get() as Attachment | undefined
  if (!row) return null
  return { mime: row.mime, name: row.name, bytes: row.bytes as Buffer }
}
