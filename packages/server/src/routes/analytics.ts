import { Router } from 'express'
import type { Db } from '@foundry/db'
import { analytics, tagsList, validate } from '@foundry/analytics'
import { parse, runResult, send } from '../http.js'
import { accountId } from '../account-id.js'

export function analyticsRoutes(db: Db) {
  const r = Router()
  r.get('/', parse(validate.analytics, 'query'),
    runResult(req => analytics(db, accountId(req), req.data)), send())
  r.get('/tags', runResult(req => tagsList(db, accountId(req))), send())
  return r
}
