import express from 'express'
import { config } from './config.js'
import { createDb } from './db.js'
import * as routes from './routes.js'
import { errors } from './middleware.js'
import { scheduler } from './handlers.js'

const db  = createDb(config.dbPath)
const app = express()

app.use(express.json())

app.use('/ticket',  routes.ticket(db))
app.use('/project', routes.project(db))
app.use('/agent',   routes.agent(db, config))
app.use('/session', routes.session(db))
app.use('/file',    routes.file(config))
app.use('/git',     routes.git(config))
app.use('/sandbox', routes.sandbox(db, config))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use(errors)

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  scheduler.recover(db)().catch(console.error)
  scheduler.startAll(db)()
})

export { app }
