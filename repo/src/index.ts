import express from 'express'
import { fileRouter } from './routes/files.js'
import { gitRouter } from './routes/git.js'
import { config } from './config.js'

const app = express()
app.use(express.json())
app.use(express.text({ type: '*/*' }))

// JSON file browser
app.use('/repo/:slug/file', fileRouter(config.repoBase))

// Git wire protocol — must come after file browser to avoid :slug.git matching /file
app.use('/repo', gitRouter(config.repoBase))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(config.port, () => {
  console.log(`repo service listening on port ${config.port}`)
})

export { app }
