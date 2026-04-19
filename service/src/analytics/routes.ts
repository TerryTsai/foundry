import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import * as validate from './schema.js'
import { analytics } from './service.js'

export function analyticsRoutes(db: Db) {
  const r = Router()
  r.get('/', parse(validate.analytics, 'query'),
    run(req => analytics(db, accountId(req), req.data)), send())
  return r
}
