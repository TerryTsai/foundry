import express from 'express'
import { config } from './config.js'
import { createDatabase } from './database.js'
import * as router from './router.js'
import { errors } from './middleware.js'
import domain from './domain.js'

const db  = createDatabase(config.dbPath)
const app = express()

app.use(express.json())

app.use('/ticket',    router.ticket(db))
app.use('/project',   router.project(db, config))
app.use('/provider',  router.provider(db))
app.use('/agent',     router.agent(db, config))
app.use('/session',   router.session(db))
app.use('/file',      router.file(config, db))
app.use('/git',       router.git(config))
app.use('/execution', router.execution(db, config))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use(errors)

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  domain.scheduler.recover(db)().catch(console.error)
  domain.scheduler.startAll(db)()
})

export { app }
