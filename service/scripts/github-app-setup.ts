// One-shot helper to create the Foundry GitHub App via the manifest flow.
//
// Usage (from the service/ directory):
//   npx tsx scripts/github-app-setup.ts --callback http://t470.lan:3006/auth/github/callback
//
// What it does:
//   1. Starts a local HTTP listener on :7878
//   2. Opens a browser tab that auto-POSTs a manifest to GitHub
//   3. You click "Create GitHub App" once on github.com
//   4. GitHub redirects back to :7878/callback with a temporary code
//   5. Script exchanges the code for the App's credentials and PEM
//   6. Writes ./foundry-app.pem and ./foundry-app.env, prints them too
//
// After it finishes, install the App on your account via the URL it prints,
// then merge foundry-app.env into your shell environment / systemd unit.

import { createServer } from 'http'
import { existsSync, writeFileSync } from 'fs'
import { exec } from 'child_process'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const callback = arg('callback')
if (!callback) {
  console.error('usage: tsx scripts/github-app-setup.ts --callback <url> [--name <app name>] [--port <local port>]')
  console.error('  --callback   the OAuth callback URL the GitHub App should be configured with')
  console.error('               (e.g. http://t470.lan:3006/auth/github/callback)')
  console.error('  --name       App name (default: "Foundry"). Must be unique across GitHub.')
  console.error('  --port       Local port for the manifest redirect (default: 7878)')
  process.exit(1)
}
const name    = arg('name') ?? 'Foundry'
const port    = parseInt(arg('port') ?? '7878', 10)
const pemPath = './foundry-app.pem'
const envPath = './foundry-app.env'

if (existsSync(pemPath) || existsSync(envPath)) {
  console.error(`refusing to overwrite existing ${pemPath} or ${envPath}`)
  console.error('move them aside (or delete) and re-run')
  process.exit(1)
}

// GitHub App manifest. Permissions are forward-looking — pick what you'll
// actually need; you can always tighten later from the App settings page.
const manifest = {
  name,
  url: new URL(callback).origin,
  redirect_url: `http://localhost:${port}/callback`,
  callback_urls: [callback],
  hook_attributes: { url: 'http://example.com', active: false },
  public: false,
  request_oauth_on_install: true,
  default_permissions: {
    contents:      'write',
    metadata:      'read',
    pull_requests: 'write',
    issues:        'write',
    emails:        'read',
  },
  default_events: [],
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)

  if (url.pathname === '/') {
    // Auto-submitting form: GitHub manifest endpoint requires POST.
    const escaped = JSON.stringify(manifest).replace(/'/g, '&apos;').replace(/"/g, '&quot;')
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html>
<html><body onload="document.forms[0].submit()">
<form method="POST" action="https://github.com/settings/apps/new">
  <input type="hidden" name="manifest" value="${escaped}">
  <noscript><button type="submit">Continue to GitHub</button></noscript>
</form>
</body></html>`)
    return
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code')
    if (!code) { res.statusCode = 400; res.end('missing code'); return }

    const apiRes = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method:  'POST',
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!apiRes.ok) {
      const body = await apiRes.text()
      res.statusCode = 500
      res.end(`conversion failed: ${apiRes.status}\n${body}`)
      console.error('conversion failed:', apiRes.status, body)
      return
    }
    const data = await apiRes.json() as {
      id:             number
      client_id:      string
      client_secret:  string
      pem:            string
      webhook_secret: string | null
      html_url:       string
    }

    writeFileSync(pemPath, data.pem, { mode: 0o600 })
    const envContent = [
      `# Foundry GitHub App credentials — generated ${new Date().toISOString()}`,
      `GITHUB_CLIENT_ID=${data.client_id}`,
      `GITHUB_CLIENT_SECRET=${data.client_secret}`,
      `GITHUB_APP_ID=${data.id}`,
      `GITHUB_APP_PRIVATE_KEY_PATH=${pemPath}`,
      ...(data.webhook_secret ? [`GITHUB_WEBHOOK_SECRET=${data.webhook_secret}`] : []),
      '',
    ].join('\n')
    writeFileSync(envPath, envContent, { mode: 0o600 })

    const installUrl = `${data.html_url}/installations/new`
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html>
<html><body style="font-family:system-ui;padding:2rem;max-width:40rem;margin:auto">
  <h1>App created</h1>
  <p>Credentials written to <code>${envPath}</code> and <code>${pemPath}</code>.</p>
  <p><a href="${installUrl}">Install ${name} on your account →</a></p>
  <p>You can close this tab.</p>
</body></html>`)

    console.log()
    console.log('GitHub App created:')
    console.log('  app_id:    ', data.id)
    console.log('  client_id: ', data.client_id)
    console.log('  pem:       ', pemPath)
    console.log('  env:       ', envPath)
    console.log()
    console.log('Next: install the app on your account →', installUrl)
    setTimeout(() => server.close(), 200)
    return
  }

  res.statusCode = 404
  res.end('not found')
})

server.listen(port, () => {
  const url = `http://localhost:${port}`
  console.log(`opening ${url} (one click on the GitHub page is required) ...`)
  const opener = process.platform === 'darwin' ? 'open'
              : process.platform === 'win32'  ? 'start'
              : 'xdg-open'
  exec(`${opener} ${url}`, () => {
    // If the opener fails (e.g. headless ssh), the user can just visit the URL manually.
  })
  console.log(`if no browser opens, visit ${url} manually`)
})
