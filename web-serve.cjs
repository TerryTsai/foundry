const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3006
const DIST = path.join(__dirname, 'web/dist')

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

http.createServer((req, res) => {
  let filePath = path.join(DIST, req.url === '/' ? 'index.html' : req.url)

  // Strip query string
  filePath = filePath.split('?')[0]

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(DIST, 'index.html')
  }

  const ext = path.extname(filePath)
  const contentType = MIME[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}).listen(PORT, () => {
  console.log(`web serving dist on port ${PORT}`)
})
