// Browser server: web access. HTTP requests, page text extraction, and
// interactive browser primitives driven by chromium over CDP.
//
// Everything runs inside the session's persistent podman container
// (reconciler/session/sandbox/podman.ts). The browser primitives drive
// a long-lived headless chromium — launched lazily on the first call,
// kept alive for the session so tabs, cookies, and DOM carry across.
//
// CDP is spoken directly in shell: `curl` to discover the target's
// WebSocket URL, `jq` to build JSON-RPC messages, `websocat` to send
// them, `jq`/`base64` to post-process responses. No client library.

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

// Shell prefix used by every browser primitive:
//   1. Launch chromium if it's not already up (lazy, once per session).
//   2. Poll /json for a page target and capture its WebSocket URL.
//      A single loop handles both "chromium still booting" and "CDP
//      is up but page target hasn't registered yet."
const BOOT = [
  'set -e',
  'if ! curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1; then',
  // --window-size sets the viewport up front. All Page.captureScreenshot
  // calls return an image at this size. Per-call Emulation overrides
  // are racy in headless chromium — pre-baking the size keeps capture
  // deterministic. 1280x800 is the one-desktop default; agents that
  // need a different frame can run `chromium --headless --screenshot`
  // via the `run` tool for a one-off.
  '  chromium --headless=new --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \\',
  '    --no-sandbox --disable-gpu --disable-dev-shm-usage \\',
  '    --window-size=1280,800 --hide-scrollbars \\',
  '    --user-data-dir=/tmp/foundry-chromium >/dev/null 2>&1 &',
  'fi',
  'WS=""',
  'for i in $(seq 1 200); do',
  `  WS=$(curl -sf http://127.0.0.1:9222/json 2>/dev/null | jq -r '[.[] | select(.type == "page")][0].webSocketDebuggerUrl // empty')`,
  '  [ -n "$WS" ] && break',
  '  sleep 0.1',
  'done',
  '[ -n "$WS" ] || { echo "chromium CDP page target never appeared" >&2; exit 1; }',
].join('\n')

// Return a shell snippet that evaluates a JS expression in the active
// page and prints the returnByValue payload (parsed) to stdout.
// The expression is passed via $EXPR so jq --arg can encode it safely.
const EVAL_EXPR = [
  `jq -cn --arg e "$EXPR" '{id:1, method:"Runtime.evaluate", params:{expression:$e, returnByValue:true, awaitPromise:true}}' \\`,
  `  | websocat -t -1 -B 16777216 "$WS" \\`,
  `  | jq -r '.result.result.value // (.result.exceptionDetails.text // "CDP error" | halt_error)'`,
].join('\n')

async function runBrowser(
  ctx: BrowserCtx, toolName: string, args: Record<string, unknown>, body: string,
): Promise<Record<string, unknown> | { error: string }> {
  const command = [BOOT, body].join('\n')
  const r = await runCommand(
    ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, args,
    { toolUseId: ctx.toolUseId, timeoutMs: 60_000 },
  )
  if (r.exitCode !== 0) {
    return { error: r.stderr.trim() || r.stdout.trim() || `${toolName} failed (exit ${r.exitCode})` }
  }
  try { return JSON.parse(r.stdout.trim()) as Record<string, unknown> }
  catch { return { error: `${toolName} returned invalid JSON: ${r.stdout.slice(0, 200)}` } }
}

// ── Handlers ──

const gotoArgs = z.object({
  url:        z.string().describe('URL to navigate to. Full absolute URL.'),
  timeout_ms: z.number().int().min(1000).max(60_000).optional().describe('Page-load timeout. Default 30000.'),
})
async function handleGoto(ctx: BrowserCtx, args: z.infer<typeof gotoArgs>) {
  const body = [
    `URL=${esc(args.url)}`,
    `TIMEOUT_MS=${args.timeout_ms ?? 30_000}`,
    // Fire navigation.
    `jq -cn --arg u "$URL" '{id:1, method:"Page.navigate", params:{url:$u}}' | websocat -t -1 -B 16777216 "$WS" >/dev/null`,
    // Poll document.readyState until 'complete' or timeout.
    `DEADLINE=$(( $(date +%s%3N) + TIMEOUT_MS ))`,
    `while [ "$(date +%s%3N)" -lt "$DEADLINE" ]; do`,
    `  EXPR='document.readyState'`,
    `  STATE=$(${EVAL_EXPR})`,
    `  [ "$STATE" = "complete" ] && break`,
    `  sleep 0.2`,
    `done`,
    // Report final state as JSON. `status` is the HTTP status of the
    // main-document response (from PerformanceNavigationTiming) so
    // agents can tell a 404 from a real page even when the server
    // returns a custom error body with a reasonable <title>.
    `EXPR='JSON.stringify({url: location.href, title: document.title, status: performance.getEntriesByType("navigation")[0]?.responseStatus ?? null})'`,
    `${EVAL_EXPR}`,
  ].join('\n')
  return runBrowser(ctx, 'browserGoto', args, body)
}

const screenshotArgs = z.object({})
async function handleScreenshot(ctx: BrowserCtx, args: z.infer<typeof screenshotArgs>) {
  // Capture the active page viewport via CDP. No per-call size args:
  // viewport is fixed by chromium's --window-size in BOOT. Per-call
  // Emulation overrides are non-deterministic, and captureBeyondViewport
  // silently breaks the CDP connection on tall captures.
  const path = `.foundry/screenshots/${ulid()}.png`
  const body = [
    `OUT=${esc(path)}`,
    `mkdir -p "$(dirname "$OUT")"`,
    // Wait for the compositor to render before capturing.
    // document.readyState flips to 'complete' *before* the first paint
    // in headless chromium, and a capture against that gap returns an
    // empty response that silently poisons subsequent captures. 2x rAF
    // + a short settle sleep make it reliable across navigations.
    `EXPR='new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'`,
    `${EVAL_EXPR} >/dev/null`,
    `sleep 0.5`,
    `jq -cn '{id:1, method:"Page.captureScreenshot", params:{format:"png"}}' \\`,
    `  | websocat -t -1 -B 16777216 "$WS" \\`,
    `  | jq -r '.result.data // (.error.message // "capture failed" | halt_error)' \\`,
    `  | base64 -d > "$OUT"`,
    // Defensive: fail if the PNG is empty or missing the magic header.
    `[ -s "$OUT" ] && head -c 8 "$OUT" | od -An -tx1 | tr -d ' \\n' | grep -q '^89504e470d0a1a0a' \\`,
    `  || { echo "screenshot produced invalid PNG" >&2; rm -f "$OUT"; exit 1; }`,
    // Return {path, url, title} as JSON.
    `EXPR='JSON.stringify({url: location.href, title: document.title})'`,
    `${EVAL_EXPR} | jq --arg p "$OUT" '. + {path: $p}'`,
  ].join('\n')
  return runBrowser(ctx, 'browserScreenshot', args, body)
}

const clickArgs = z.object({
  selector:        z.string().describe('CSS selector of the element to click.'),
  wait_navigation: z.boolean().optional().describe('Wait for a page navigation to complete after the click. Use when clicking a link or a form submit.'),
  timeout_ms:      z.number().int().min(500).max(30_000).optional(),
})
async function handleClick(ctx: BrowserCtx, args: z.infer<typeof clickArgs>) {
  const clickJs = `
    (() => {
      const el = document.querySelector(${JSON.stringify(args.selector)})
      if (!el) throw new Error('selector not found: ' + ${JSON.stringify(args.selector)})
      el.click()
      return JSON.stringify({url: location.href, title: document.title})
    })()
  `.trim()
  // If wait_navigation is set, poll readyState after the click.
  const body = args.wait_navigation ? [
    `EXPR=${esc(clickJs)}`,
    `${EVAL_EXPR} >/dev/null`,
    `DEADLINE=$(( $(date +%s%3N) + 15000 ))`,
    `while [ "$(date +%s%3N)" -lt "$DEADLINE" ]; do`,
    `  EXPR='document.readyState'`,
    `  [ "$(${EVAL_EXPR})" = "complete" ] && break`,
    `  sleep 0.2`,
    `done`,
    `EXPR='JSON.stringify({url: location.href, title: document.title})'`,
    `${EVAL_EXPR}`,
  ].join('\n') : [
    `EXPR=${esc(clickJs)}`,
    `${EVAL_EXPR}`,
  ].join('\n')
  return runBrowser(ctx, 'browserClick', args, body)
}

const fillArgs = z.object({
  selector:   z.string().describe('CSS selector of the input/textarea.'),
  value:      z.string().describe('Value to type.'),
  delay_ms:   z.number().int().min(0).max(200).optional(),
  timeout_ms: z.number().int().min(500).max(30_000).optional(),
})
async function handleFill(ctx: BrowserCtx, args: z.infer<typeof fillArgs>) {
  const js = `
    (() => {
      const el = document.querySelector(${JSON.stringify(args.selector)})
      if (!el) throw new Error('selector not found: ' + ${JSON.stringify(args.selector)})
      const proto = Object.getPrototypeOf(el)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, ${JSON.stringify(args.value)})
      else el.value = ${JSON.stringify(args.value)}
      el.dispatchEvent(new Event('input',  { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return JSON.stringify({url: location.href})
    })()
  `.trim()
  const body = [
    `EXPR=${esc(js)}`,
    `${EVAL_EXPR}`,
  ].join('\n')
  return runBrowser(ctx, 'browserFill', args, body)
}

const textArgs = z.object({
  selector:   z.string().optional().describe('Extract just this subtree. Omit for the whole page.'),
  timeout_ms: z.number().int().min(500).max(30_000).optional(),
})
async function handleText(ctx: BrowserCtx, args: z.infer<typeof textArgs>) {
  const js = args.selector ? `
    (() => {
      const el = document.querySelector(${JSON.stringify(args.selector)})
      if (!el) throw new Error('selector not found: ' + ${JSON.stringify(args.selector)})
      return JSON.stringify({text: el.innerText || '', url: location.href})
    })()
  `.trim() : `
    (() => JSON.stringify({text: document.body?.innerText ?? '', url: location.href}))()
  `.trim()
  const body = [
    `EXPR=${esc(js)}`,
    `${EVAL_EXPR}`,
  ].join('\n')
  return runBrowser(ctx, 'browserText', args, body)
}

const domArgs = z.object({})
async function handleDom(ctx: BrowserCtx, args: z.infer<typeof domArgs>) {
  const js = `
    (() => {
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
      return JSON.stringify({ elements: els.slice(0, 200).map(pick), url: location.href, title: document.title })
    })()
  `.trim()
  const body = [
    `EXPR=${esc(js)}`,
    `${EVAL_EXPR}`,
  ].join('\n')
  return runBrowser(ctx, 'browserDom', args, body)
}

const backArgs = z.object({})
async function handleBack(ctx: BrowserCtx, args: z.infer<typeof backArgs>) {
  const js = `
    (() => {
      history.back()
      return JSON.stringify({url: location.href, title: document.title})
    })()
  `.trim()
  const body = [
    `EXPR=${esc(js)}`,
    `${EVAL_EXPR}`,
  ].join('\n')
  return runBrowser(ctx, 'browserBack', args, body)
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
  { name: 'browserGoto',       description: 'Navigate the session\'s browser to a URL. Returns {url, title, status} where status is the HTTP status of the main document response — check it before assuming the page loaded.',               schema: gotoArgs,            handler: handleGoto },
  { name: 'browserScreenshot', description: 'Capture the active page in the session\'s browser (at the fixed viewport — 1280x800). Saves a PNG under .foundry/screenshots/ and returns the path. Attach the path to a ticketComment to surface it for review.', schema: screenshotArgs, handler: handleScreenshot },
  { name: 'browserClick',      description: 'Click an element by CSS selector. Set wait_navigation=true when clicking something that navigates (a link or a submit button).',                                                                      schema: clickArgs,           handler: handleClick },
  { name: 'browserFill',       description: 'Type into an input or textarea by CSS selector. Clears the existing value first.',                                                                                                                    schema: fillArgs,            handler: handleFill },
  { name: 'browserText',       description: 'Extract visible text from the current page. Pass a selector to narrow to a subtree. Cheap way to check state after clicking/filling.',                                                                schema: textArgs,            handler: handleText },
  { name: 'browserDom',        description: 'Return a compact list of interactive elements (links, buttons, inputs) on the current page with their selectors, roles, and text. Use this to discover what to click or fill without eyeballing a screenshot.', schema: domArgs,      handler: handleDom },
  { name: 'browserBack',       description: 'Navigate the browser back one step in history.',                                                                                                                                                      schema: backArgs,            handler: handleBack },
]
