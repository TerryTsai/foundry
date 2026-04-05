import express from 'express'
import { createDb } from './db/client.js'
import { ticketRouter } from './routes/tickets.js'

const port = parseInt(process.env.TICKET_PORT ?? '3002', 10)
const dbPath = process.env.DB_PATH ?? './ticket.db'

const { db, sqlite } = createDb(dbPath)

const app = express()
app.use(express.json())

app.use('/ticket', ticketRouter(db, sqlite))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  console.log(`ticket service listening on port ${port}`)
})

export { app }
