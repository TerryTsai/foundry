#!/usr/bin/env node
// Browser command wrapper installed at /usr/local/bin/foundry-browser in
// the sandbox image. Each invocation takes one command and its args
// (JSON via argv[3]) and prints a JSON result on stdout.
//
// Manages a long-lived headless chromium inside the container. On first
// invocation we spawn chromium with --remote-debugging-port and detach;
// on later invocations we connect via CDP. Session state (open tabs,
// URL, cookies, DOM, JS heap) persists across calls so the agent can
// drive a real interactive flow: goto → screenshot → click → fill →
// screenshot.
//
// Uses playwright-core over the already-installed Debian chromium
// (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 at image build time — no 200 MB
// of bundled browsers).

import { chromium } from 'playwright-core'
import { spawn } from 'child_process'
import { existsSync } from 'fs'

const PROFILE    = '/tmp/foundry-chrome'
const DEBUG_PORT = 9222
const CHROME_BIN = existsSync('/usr/bin/chromium')         ? '/usr/bin/chromium'
                 : existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser'
                 : 'chromium'

async function chromiumAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(500) })
    return res.ok
  } catch { return false }
}

async function ensureChromium() {
  if (await chromiumAlive()) return
  const child = spawn(CHROME_BIN, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await chromiumAlive()) return
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('chromium did not come up on debug port')
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
        // Compact selectors-and-text map so the agent can decide what
        // to click/fill next without eating tokens on full HTML.
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
