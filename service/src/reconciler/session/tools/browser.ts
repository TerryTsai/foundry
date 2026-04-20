// Browser server: web access. HTTP requests, page text extraction, and
// interactive browser primitives (screenshot, click, fill, dom).
//
// Every tool execs into this session's persistent podman container
// (reconciler/session/sandbox/podman.ts). The browser primitives share
// state across calls — open tabs, cookies, DOM, form input — because
// chromium keeps running inside the container between tool calls.
// fetch/scrape are stateless curl/lynx one-shots in the same container.
//
// The browser primitives work by writing a small node script to
// /tmp/foundry-browser.js and invoking it. Each invocation connects to
// a long-lived headless chromium over CDP, does one operation,
// disconnects. Chromium is launched lazily on first use by a shell
// prefix that starts it if port 9222 isn't already open.

import { z } from 'zod'
import { ulid } from 'ulid'

import type { Db } from '../../../core/db.js'
import type { Config } from '../../../core/config.js'
import * as validate from './sandbox-schema.js'
import { toInt } from '../../../core/util.js'
import { bounded, esc, runCommand } from '../../../integrations/shared.js'

import type { } from './registry.js'
import type { McpServerInfo, ToolDef } from '../../../integrations/types.js'

export interface BrowserCtx {
  db:        Db
  config:    Config
  sessionId: string
  workspace: string
  toolUseId?: string
}

// ── HTTP one-shots ─────────────────────────────────────────────────

async function handleFetch(ctx: BrowserCtx, args: z.infer<typeof validate.toolFetch>) {
  const curlArgs = ['-s', '-w', '\\n%{http_code}', '-X', args.method ?? 'GET']
  if (args.headers) {
    for (const [k, val] of Object.entries(args.headers)) curlArgs.push('-H', `${k}: ${val}`)
  }
  if (args.body) curlArgs.push('-d', args.body)
  curlArgs.push(args.url)
  const command = `curl ${curlArgs.map(a => esc(a)).join(' ')}`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'fetch', args, { toolUseId: ctx.toolUseId })
    const lines = r.stdout.trimEnd().split('\n')
    const statusCode = toInt(lines.pop() ?? '0')
    return { ...bounded(ctx.workspace, lines.join('\n')), status: statusCode }
  } catch (err) {
    return { content: '', status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleScrape(ctx: BrowserCtx, args: z.infer<typeof validate.toolScrape>) {
  const url = esc(args.url)
  const command = `lynx -dump -nolist -width=120 ${url} 2>/dev/null || curl -sL ${url} | sed 's/<[^>]*>//g' | sed '/^$/d'`
  try {
    const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace, command, 'scrape', args, { toolUseId: ctx.toolUseId })
    return bounded(ctx.workspace, r.stdout.trim())
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Browser primitives ─────────────────────────────────────────────

// Shell prefix: if chromium's CDP port isn't open yet, launch chromium
// in the background and wait for it. No-op on subsequent calls in the
// same session container.
const BOOT = [
  'if ! (echo > /dev/tcp/127.0.0.1/9222) 2>/dev/null; then',
  '  chromium --headless=new --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \\',
  '    --no-sandbox --disable-gpu --disable-dev-shm-usage \\',
  '    --user-data-dir=/tmp/foundry-chromium >/dev/null 2>&1 &',
  '  for i in $(seq 1 150); do',
  '    (echo > /dev/tcp/127.0.0.1/9222) 2>/dev/null && break',
  '    sleep 0.1',
  '  done',
  'fi',
].join('\n')

// Build a shell command that writes a Node CDP script to /tmp and runs
// it. `body` is a JS expression/statement list with `browser`, `ctx`,
// and `page` in scope; its return value (if any) is JSON-serialized to
// stdout. Developer-authored — args are JSON.stringify'd into literals,
// so no injection concern.
function browserScript(body: string): string {
  const script = [
    "const { chromium } = require('playwright-core')",
    "async function main() {",
    "  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')",
    "  try {",
    "    const ctx = browser.contexts()[0] ?? await browser.newContext()",
    "    const page = ctx.pages()[0] ?? await ctx.newPage()",
    "    const result = await (async () => {",
    `      ${body}`,
    "    })()",
    "    if (result !== undefined) process.stdout.write(JSON.stringify(result))",
    "  } finally { await browser.close() }",
    "}",
    "main().catch(e => { process.stderr.write(e?.message ?? String(e)); process.exit(1) })",
  ].join('\n')
  return [
    BOOT,
    "cat > /tmp/foundry-browser.js <<'__FOUNDRY_EOF__'",
    script,
    '__FOUNDRY_EOF__',
    'node /tmp/foundry-browser.js',
  ].join('\n')
}

async function runBrowser(
  ctx: BrowserCtx, toolName: string, args: Record<string, unknown>, body: string,
): Promise<Record<string, unknown> | { error: string }> {
  const r = await runCommand(
    ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    browserScript(body), toolName, args,
    { toolUseId: ctx.toolUseId, timeoutMs: 60_000 },
  )
  if (r.exitCode !== 0) {
    return { error: r.stderr.trim() || r.stdout.trim() || `${toolName} failed (exit ${r.exitCode})` }
  }
  try { return JSON.parse(r.stdout) as Record<string, unknown> }
  catch { return { error: `${toolName} returned invalid JSON` } }
}

// ── Handlers ──

const gotoArgs = z.object({
  url:        z.string().describe('URL to navigate to. Full absolute URL.'),
  timeout_ms: z.number().int().min(1000).max(60_000).optional().describe('Page-load timeout. Default 30000.'),
})
async function handleGoto(ctx: BrowserCtx, args: z.infer<typeof gotoArgs>) {
  return runBrowser(ctx, 'browserGoto', args, `
    await page.goto(${JSON.stringify(args.url)}, {
      waitUntil: 'networkidle',
      timeout: ${args.timeout_ms ?? 30_000},
    })
    return { url: page.url(), title: await page.title() }
  `)
}

const screenshotArgs = z.object({
  full_page: z.boolean().optional().describe('Capture the full scrolled page instead of just the viewport.'),
})
async function handleScreenshot(ctx: BrowserCtx, args: z.infer<typeof screenshotArgs>) {
  // Write to a workspace file and return the path. Agents attach the
  // file to ticket comments via ticketComment's `attachments` arg —
  // same file-based pattern as every other artifact the agent produces.
  const path = `.foundry/screenshots/${ulid()}.png`
  return runBrowser(ctx, 'browserScreenshot', args, `
    const fs = require('fs')
    const pathlib = require('path')
    const outPath = '/home/foundry/' + ${JSON.stringify(path)}
    fs.mkdirSync(pathlib.dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, fullPage: ${args.full_page ? 'true' : 'false'}, type: 'png' })
    return { path: ${JSON.stringify(path)}, url: page.url(), title: await page.title() }
  `)
}

const clickArgs = z.object({
  selector:        z.string().describe('CSS selector of the element to click.'),
  wait_navigation: z.boolean().optional().describe('Wait for a page navigation to complete after the click. Use when clicking a link or a form submit.'),
  timeout_ms:      z.number().int().min(500).max(30_000).optional(),
})
async function handleClick(ctx: BrowserCtx, args: z.infer<typeof clickArgs>) {
  return runBrowser(ctx, 'browserClick', args, args.wait_navigation ? `
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.click(${JSON.stringify(args.selector)}, { timeout: ${args.timeout_ms ?? 10_000} }),
    ])
    return { url: page.url(), title: await page.title() }
  ` : `
    await page.click(${JSON.stringify(args.selector)}, { timeout: ${args.timeout_ms ?? 10_000} })
    return { url: page.url(), title: await page.title() }
  `)
}

const fillArgs = z.object({
  selector:   z.string().describe('CSS selector of the input/textarea.'),
  value:      z.string().describe('Value to type.'),
  delay_ms:   z.number().int().min(0).max(200).optional(),
  timeout_ms: z.number().int().min(500).max(30_000).optional(),
})
async function handleFill(ctx: BrowserCtx, args: z.infer<typeof fillArgs>) {
  return runBrowser(ctx, 'browserFill', args, `
    await page.fill(${JSON.stringify(args.selector)}, ${JSON.stringify(args.value)}, {
      timeout: ${args.timeout_ms ?? 10_000},
    })
    return { url: page.url() }
  `)
}

const textArgs = z.object({
  selector:   z.string().optional().describe('Extract just this subtree. Omit for the whole page.'),
  timeout_ms: z.number().int().min(500).max(30_000).optional(),
})
async function handleText(ctx: BrowserCtx, args: z.infer<typeof textArgs>) {
  return runBrowser(ctx, 'browserText', args, args.selector ? `
    const text = await page.innerText(${JSON.stringify(args.selector)}, { timeout: ${args.timeout_ms ?? 10_000} })
    return { text, url: page.url() }
  ` : `
    const text = await page.evaluate(() => document.body?.innerText ?? '')
    return { text, url: page.url() }
  `)
}

const domArgs = z.object({})
async function handleDom(ctx: BrowserCtx, args: z.infer<typeof domArgs>) {
  return runBrowser(ctx, 'browserDom', args, `
    const elements = await page.evaluate(() => {
      const pick = (el) => ({
        tag:  el.tagName.toLowerCase(),
        id:   el.id || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
        text: (el.innerText || '').trim().slice(0, 120) || undefined,
        role: el.getAttribute('role') || undefined,
        aria: el.getAttribute('aria-label') || undefined,
      })
      const els = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link]'))
      return els.slice(0, 200).map(pick)
    })
    return { elements, url: page.url(), title: await page.title() }
  `)
}

const backArgs = z.object({})
async function handleBack(ctx: BrowserCtx, args: z.infer<typeof backArgs>) {
  return runBrowser(ctx, 'browserBack', args, `
    await page.goBack({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
    return { url: page.url(), title: await page.title() }
  `)
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'browser',
  name:        'Browser',
  category:    'core',
  description: 'Web access: one-shot fetch/scrape plus interactive browser primitives (navigation, screenshot, click, fill) backed by a persistent headless chromium.',
}

export const tools: ToolDef[] = [
  { name: 'fetch',             description: 'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.',                                                                                schema: validate.toolFetch,  handler: handleFetch },
  { name: 'scrape',            description: 'Extract clean readable text from a web page. Large output is written to a file you can read with offset/limit.',                                                                                      schema: validate.toolScrape, handler: handleScrape },
  { name: 'browserGoto',       description: 'Navigate the session\'s browser to a URL. Cookies, localStorage, and open tabs persist across calls — use this to start a flow or follow a manual redirect.',                                         schema: gotoArgs,            handler: handleGoto },
  { name: 'browserScreenshot', description: 'Take a PNG screenshot of the current page. Writes it to a workspace file under .foundry/screenshots/ and returns the path. Attach the path to a ticketComment to surface it for review. Use full_page=true for the whole scrolled page.', schema: screenshotArgs, handler: handleScreenshot },
  { name: 'browserClick',      description: 'Click an element by CSS selector. Set wait_navigation=true when clicking something that navigates (a link or a submit button).',                                                                      schema: clickArgs,           handler: handleClick },
  { name: 'browserFill',       description: 'Type into an input or textarea by CSS selector. Clears the existing value first.',                                                                                                                    schema: fillArgs,            handler: handleFill },
  { name: 'browserText',       description: 'Extract visible text from the current page. Pass a selector to narrow to a subtree. Cheap way to check state after clicking/filling.',                                                                schema: textArgs,            handler: handleText },
  { name: 'browserDom',        description: 'Return a compact list of interactive elements (links, buttons, inputs) on the current page with their selectors, roles, and text. Use this to discover what to click or fill without eyeballing a screenshot.', schema: domArgs,      handler: handleDom },
  { name: 'browserBack',       description: 'Navigate the browser back one step in history.',                                                                                                                                                      schema: backArgs,            handler: handleBack },
]
