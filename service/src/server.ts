import express from 'express'
import { config } from './config.js'
import { createDatabase } from './database.js'
import * as router from './router.js'
import { errors } from './middleware.js'
import * as domain from './domain.js'

const db  = createDatabase(config.dbPath)
const app = express()

app.use(express.json())

// ── Project ──
app.use('/project',   router.project(db, config))
app.use('/provider',  router.provider(db))

// ── Ticketing ──
app.use('/ticket',    router.ticket(db))

// ── Agent ──
app.use('/agent',     router.agent(db, config))
app.use('/session',   router.session(db))
app.use('/execution', router.execution(db, config))

// ── Files ──
app.use('/file',      router.file(config, db))
app.use('/git',       router.git(config))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use(errors)

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  domain.schedulerRecover(db).catch(console.error)
  domain.schedulerStartAll(db)
})

export { app }
