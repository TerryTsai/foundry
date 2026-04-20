#!/usr/bin/env node
// Browser command wrapper installed at /usr/local/bin/foundry-browser in
// the sandbox image. Each invocation takes one command and its args
// (JSON via argv[3]) and prints a JSON result on stdout.
//
// The persistent session container's entrypoint is `sleep infinity`
// (see startSessionContainer in reconciler/session/sandbox/podman.ts)
// so chromium isn't pre-launched. This wrapper starts chromium lazily
// on the first call, writes the pid to /tmp/foundry-chromium.pid, and
// reuses that same process on every subsequent call. The CDP session
// keeps cookies, open tabs, and DOM state alive across tool calls —
// the whole point of having a persistent container.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'

// playwright-core is installed globally in the sandbox image
// (/usr/local/lib/node_modules). Node's ESM resolver ignores NODE_PATH
// so bare `import 'playwright-core'` fails from /usr/local/bin. The CJS
// resolver honors NODE_PATH, and playwright-core ships CJS, so route
// the import through createRequire.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const DEBUG_PORT = 9222
const PID_FILE   = '/tmp/foundry-chromium.pid'

function isPortOpen(port) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => { sock.end(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.setTimeout(300, () => { sock.destroy(); resolve(false) })
  })
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function ensureChromium() {
  // Existing pidfile + live process + port open → reuse.
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, 'utf-8').trim())
    if (pid && pidAlive(pid) && await isPortOpen(DEBUG_PORT)) return
  }
  // Launch a detached headless chromium. Use --user-data-dir under /tmp
  // (tmpfs is writable; container root fs is read-only) so chromium can
  // write its profile. --no-sandbox because the podman container already
  // drops caps and runs as non-root — chromium's built-in sandbox wants
  // capabilities we intentionally don't grant.
  const child = spawn('chromium', [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/foundry-chromium-profile',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  writeFileSync(PID_FILE, String(child.pid))
  // Wait up to 15 s for the CDP port to open.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await isPortOpen(DEBUG_PORT)) return
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('chromium failed to open CDP port within 15s')
}

async function getPage(browser) {
  const ctx = browser.contexts()[0] ?? await browser.newContext()
  const pages = ctx.pages()
  if (pages.length > 0) return pages[0]
  return ctx.newPage()
}

function bytesBase64(buf) {
  return Buffer.from(buf).toString('base64')
}

async function run(cmd, args) {
  await ensureChromium()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`)
  try {
    const p = await getPage(browser)
    switch (cmd) {
      case 'goto': {
        await p.goto(args.url, { waitUntil: 'networkidle', timeout: args.timeout_ms ?? 30_000 })
        return { url: p.url(), title: await p.title() }
      }
      case 'screenshot': {
        const buf = await p.screenshot({ fullPage: !!args.full_page, type: 'png' })
        return { png_base64: bytesBase64(buf), url: p.url(), title: await p.title() }
      }
      case 'click': {
        if (args.wait_navigation) {
          await Promise.all([
            p.waitForNavigation({ waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {}),
            p.click(args.selector, { timeout: args.timeout_ms ?? 10_000 }),
          ])
        } else {
          await p.click(args.selector, { timeout: args.timeout_ms ?? 10_000 })
        }
        return { url: p.url(), title: await p.title() }
      }
      case 'fill': {
        await p.fill(args.selector, args.value, { timeout: args.timeout_ms ?? 10_000 })
        return { url: p.url() }
      }
      case 'text': {
        if (args.selector) {
          const txt = await p.innerText(args.selector, { timeout: args.timeout_ms ?? 10_000 })
          return { text: txt, url: p.url() }
        }
        const txt = await p.evaluate(() => document.body?.innerText ?? '')
        return { text: txt, url: p.url() }
      }
      case 'dom': {
        const data = await p.evaluate(() => {
          const pick = (el) => ({
            tag:   el.tagName.toLowerCase(),
            id:    el.id || undefined,
            name:  el.getAttribute('name') || undefined,
            type:  el.getAttribute('type') || undefined,
            text:  (el.innerText || '').trim().slice(0, 120) || undefined,
            role:  el.getAttribute('role') || undefined,
            aria:  el.getAttribute('aria-label') || undefined,
          })
          const els = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link]'))
          return els.slice(0, 200).map(pick)
        })
        return { elements: data, url: p.url(), title: await p.title() }
      }
      case 'back': {
        await p.goBack({ waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {})
        return { url: p.url(), title: await p.title() }
      }
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  } finally {
    await browser.close()
  }
}

const cmd  = process.argv[2]
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {}
run(cmd, args)
  .then(res => { process.stdout.write(JSON.stringify(res)); process.exit(0) })
  .catch(err => { process.stderr.write(err?.message ?? String(err)); process.exit(1) })
