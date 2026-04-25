import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Attachment } from '@foundry/db'
import { now } from '@foundry/model'
import { notFound, conflict } from '@foundry/model'
import { ticketOwned, assertProjectOwner } from './project.js'
import * as database from './repo.js'

// Attachment policy. Keep the list tight — only what Claude supports
// natively so the model can actually read the content instead of
// staring at an opaque blob.
const ALLOWED_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per attachment

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

// ── Create ──────────────────────────────────────────────────────────

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function attachmentCreate(
  db: Db, accountId: string,
  input: { ticket_id?: string; comment_id?: string; name: string; mime: string; bytes: Buffer; created_by: string },
): AttachmentMeta {
  if (!ALLOWED_MIMES.has(input.mime)) {
    throw conflict(`unsupported mime type: ${input.mime}`)
  }
  if (input.bytes.length === 0) throw conflict('empty attachment')
  if (input.bytes.length > MAX_BYTES) {
    throw conflict(`attachment too large (${input.bytes.length} bytes; max ${MAX_BYTES})`)
  }
  if (!input.ticket_id && !input.comment_id) {
    throw conflict('attachment must reference a ticket or comment')
  }
  if (input.ticket_id && input.comment_id) {
    throw conflict('attachment cannot reference both a ticket and a comment')
  }

  // Authorize by verifying the target ticket belongs to this account.
  if (input.ticket_id) {
    ticketOwned(db, input.ticket_id, accountId)
  } else if (input.comment_id) {
    const c = database.commentGet(db, input.comment_id)
    if (!c) throw notFound()
    ticketOwned(db, c.ticket_id, accountId)
  }

  const id = ulid()
  db.insert(schema.attachment).values({
    id,
    ticket_id:  input.ticket_id ?? null,
    comment_id: input.comment_id ?? null,
    name:       input.name,
    mime:       input.mime,
    size:       input.bytes.length,
    bytes:      input.bytes,
    created_by: input.created_by,
    created_at: now(),
  }).run()

  const row = db.select().from(schema.attachment)
    .where(eq(schema.attachment.id, id)).get() as Attachment
  return toMeta(row)
}

// ── Read (metadata only) ────────────────────────────────────────────

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

export function attachmentListByTicket(db: Db, accountId: string, ticketId: string): AttachmentMeta[] {
  ticketOwned(db, ticketId, accountId)
  const direct = db.select(metaCols).from(schema.attachment)
    .where(eq(schema.attachment.ticket_id, ticketId))
    .all() as AttachmentMeta[]
  const viaComments = db.select(metaCols).from(schema.attachment)
    .innerJoin(schema.comment, eq(schema.comment.id, schema.attachment.comment_id))
    .where(eq(schema.comment.ticket_id, ticketId))
    .all() as AttachmentMeta[]
  return [...direct, ...viaComments]
}

export function attachmentListByComment(db: Db, accountId: string, commentId: string): AttachmentMeta[] {
  const c = database.commentGet(db, commentId)
  if (!c) throw notFound()
  ticketOwned(db, c.ticket_id, accountId)
  return db.select(metaCols).from(schema.attachment)
    .where(eq(schema.attachment.comment_id, commentId))
    .all() as AttachmentMeta[]
}

// ── Read (bytes) ────────────────────────────────────────────────────

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function attachmentGetBytes(
  db: Db, accountId: string, id: string,
): { mime: string; name: string; bytes: Buffer } {
  const row = db.select().from(schema.attachment)
    .where(eq(schema.attachment.id, id)).get() as Attachment | undefined
  if (!row) throw notFound()
  // Authorize via the parent ticket's project ownership.
  const parentTicketId = row.ticket_id ?? (() => {
    if (!row.comment_id) throw notFound()
    const c = database.commentGet(db, row.comment_id)
    if (!c) throw notFound()
    return c.ticket_id
  })()
  const t = database.ticketGet(db, parentTicketId)
  if (!t) throw notFound()
  assertProjectOwner(db, t.project_id, accountId)
  return { mime: row.mime, name: row.name, bytes: row.bytes as Buffer }
}

// ── Internal (session runner; no ownership check needed) ────────────

export function attachmentListByTicketInternal(db: Db, ticketId: string): AttachmentMeta[] {
  const direct = db.select(metaCols).from(schema.attachment)
    .where(eq(schema.attachment.ticket_id, ticketId))
    .all() as AttachmentMeta[]
  const viaComments = db.select(metaCols).from(schema.attachment)
    .innerJoin(schema.comment, eq(schema.comment.id, schema.attachment.comment_id))
    .where(eq(schema.comment.ticket_id, ticketId))
    .all() as AttachmentMeta[]
  return [...direct, ...viaComments]
}

export function attachmentGetInternal(db: Db, id: string): { mime: string; name: string; bytes: Buffer } | null {
  const row = db.select().from(schema.attachment)
    .where(eq(schema.attachment.id, id)).get() as Attachment | undefined
  if (!row) return null
  return { mime: row.mime, name: row.name, bytes: row.bytes as Buffer }
}
