import express from 'express'
import { fileRouter } from './routes/files.js'
import { gitRouter } from './routes/git.js'

const port = parseInt(process.env.REPO_PORT ?? '3003', 10)
const repoBase = process.env.REPO_BASE ?? '/repos'

const app = express()
app.use(express.json())
app.use(express.text({ type: '*/*' }))

// JSON file browser
app.use('/repo/:slug/file', fileRouter(repoBase))

// Git wire protocol — must come after file browser to avoid :slug.git matching /file
app.use('/repo', gitRouter(repoBase))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  console.log(`repo service listening on port ${port}`)
})

export { app }
