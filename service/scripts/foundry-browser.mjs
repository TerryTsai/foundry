#!/usr/bin/env node
// Browser command wrapper installed at /usr/local/bin/foundry-browser in
// the sandbox image. Each invocation takes one command and its args
// (JSON via argv[3]) and prints a JSON result on stdout.
//
// Manages a long-lived headless chromium inside the container. On first
// invocation we spawn chromium with --remote-debugging-port and detach;
// on later invocations we just connect to it over CDP. Session state
// (open tabs, URL, cookies, DOM, JS heap) persists across calls so the
// agent can drive a real interactive flow.
//
// Implementation note: uses createRequire() for puppeteer-core because
// puppeteer-core ships CommonJS without an "exports" field; Node's ESM
// resolver can't pick an entry for it. createRequire gives us CJS-style
// resolution that finds the globally-installed package.

import { createRequire } from 'module'
import { spawn } from 'child_process'
import { existsSync } from 'fs'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

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

async function page(browser) {
  const pages = await browser.pages()
  if (pages.length > 0) return pages[0]
  return browser.newPage()
}

function bytesBase64(buf) {
  return Buffer.from(buf).toString('base64')
}

async function run(cmd, args) {
  await ensureChromium()
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
  try {
    const p = await page(browser)
    switch (cmd) {
      case 'goto': {
        await p.goto(args.url, { waitUntil: 'networkidle2', timeout: args.timeout_ms ?? 30_000 })
        return { url: p.url(), title: await p.title() }
      }
      case 'screenshot': {
        const buf = await p.screenshot({ fullPage: !!args.full_page, type: 'png' })
        return { png_base64: bytesBase64(buf), url: p.url(), title: await p.title() }
      }
      case 'click': {
        await p.waitForSelector(args.selector, { timeout: args.timeout_ms ?? 10_000 })
        await Promise.all([
          p.click(args.selector),
          args.wait_navigation ? p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {}) : Promise.resolve(),
        ])
        return { url: p.url(), title: await p.title() }
      }
      case 'fill': {
        await p.waitForSelector(args.selector, { timeout: args.timeout_ms ?? 10_000 })
        await p.$eval(args.selector, el => { el.value = '' })
        await p.focus(args.selector)
        await p.keyboard.type(args.value, { delay: args.delay_ms ?? 20 })
        return { url: p.url() }
      }
      case 'text': {
        if (args.selector) {
          await p.waitForSelector(args.selector, { timeout: args.timeout_ms ?? 10_000 })
          const txt = await p.$eval(args.selector, el => el.innerText)
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
        await p.goBack({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {})
        return { url: p.url(), title: await p.title() }
      }
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  } finally {
    await browser.disconnect()
  }
}

const cmd  = process.argv[2]
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {}
run(cmd, args)
  .then(res => { process.stdout.write(JSON.stringify(res)); process.exit(0) })
  .catch(err => { process.stderr.write(err?.message ?? String(err)); process.exit(1) })
