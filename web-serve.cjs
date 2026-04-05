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

// API routes proxied to backend services
const PROXY = {
  '/project': 3001,
  '/ticket': 3002,
  '/repo': 3003,
  '/sandbox': 3004,
  '/agent': 3005,
}

function proxy(req, res, targetPort) {
  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }
  const upstream = http.request(options, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers)
    upRes.pipe(res)
  })
  upstream.on('error', (err) => {
    res.writeHead(502)
    res.end(`upstream error: ${err.message}`)
  })
  req.pipe(upstream)
}

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0]

  // Check if this request should be proxied
  for (const [prefix, port] of Object.entries(PROXY)) {
    if (urlPath === prefix || urlPath.startsWith(prefix + '/')) {
      return proxy(req, res, port)
    }
  }

  // Static file serving
  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)

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
