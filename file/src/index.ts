import express from 'express'
import { fileRouter } from './routes/files.js'
import { gitRouter } from './routes/git.js'
import { config } from './config.js'

const app = express()
app.use(express.json())
app.use(express.text({ type: '*/*' }))

// JSON file browser
app.use('/file/:slug', fileRouter(config.basePath))

// Git wire protocol
app.use('/git', gitRouter(config.basePath))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(config.port, () => {
  console.log(`file service listening on port ${config.port}`)
})

export { app }
