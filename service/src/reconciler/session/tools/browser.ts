// Browser server: web access. HTTP requests, page text extraction, and
// interactive browser primitives (screenshot, click, fill, dom).
//
// Everything execs into this session's persistent podman container
// (see reconciler/session/sandbox/podman.ts). The browser primitives
// (goto/screenshot/click/fill/text/dom/back) share state across calls
// — open tabs, cookies, DOM, form input — because chromium runs as a
// long-lived process inside that container. `fetch`/`scrape` are
// stateless one-shots but use the same container for consistency.

import { z } from 'zod'

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

// ── Browser primitives (stateful: share chromium across calls) ─────

// All browser primitives funnel through this helper: they exec
// `foundry-browser <cmd> <args-json>` inside the session's persistent
// container (chromium is launched lazily on the first call by the
// wrapper), then parse the JSON result.
async function browserExec(
  ctx: BrowserCtx, toolName: string, cmd: string, args: Record<string, unknown>,
): Promise<Record<string, unknown> | { error: string }> {
  const json = JSON.stringify(args).replace(/'/g, "'\\''")
  const command = `foundry-browser ${cmd} '${json}'`
  const r = await runCommand(
    ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    command, toolName, args, { toolUseId: ctx.toolUseId, timeoutMs: 60_000 },
  )
  if (r.exitCode !== 0) {
    return { error: r.stderr.trim() || r.stdout.trim() || `browser ${cmd} failed (exit ${r.exitCode})` }
  }
  try { return JSON.parse(r.stdout) as Record<string, unknown> }
  catch { return { error: `browser ${cmd} returned invalid JSON` } }
}

// Takes a result from browserExec and turns a png_base64 field into an
// inline image content block the LLM can actually see.
function withInlineScreenshot(
  res: Record<string, unknown> | { error: string },
): Record<string, unknown> | { content: Array<Record<string, unknown>> } {
  if ('error' in res) return res
  const png = res.png_base64
  if (typeof png !== 'string') return res
  const meta: Record<string, unknown> = { ...res }
  delete meta.png_base64
  return {
    content: [
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'text',  text: JSON.stringify(meta) },
    ],
  }
}

const gotoArgs = z.object({
  url:        z.string().describe('URL to navigate to. Full absolute URL.'),
  timeout_ms: z.number().int().min(1000).max(60_000).optional().describe('Page-load timeout. Default 30000.'),
})
async function handleGoto(ctx: BrowserCtx, args: z.infer<typeof gotoArgs>) {
  return browserExec(ctx, 'browserGoto', 'goto', args)
}

const screenshotArgs = z.object({
  full_page: z.boolean().optional().describe('Capture the full scrolled page instead of just the viewport.'),
})
async function handleScreenshot(ctx: BrowserCtx, args: z.infer<typeof screenshotArgs>) {
  return withInlineScreenshot(await browserExec(ctx, 'browserScreenshot', 'screenshot', args))
}

const clickArgs = z.object({
  selector:        z.string().describe('CSS selector of the element to click.'),
  wait_navigation: z.boolean().optional().describe('Wait for a page navigation to complete after the click. Use when clicking a link or a form submit.'),
  timeout_ms:      z.number().int().min(500).max(30_000).optional(),
})
async function handleClick(ctx: BrowserCtx, args: z.infer<typeof clickArgs>) {
  return browserExec(ctx, 'browserClick', 'click', args)
}

const fillArgs = z.object({
  selector:   z.string().describe('CSS selector of the input/textarea.'),
  value:      z.string().describe('Value to type.'),
  delay_ms:   z.number().int().min(0).max(200).optional(),
  timeout_ms: z.number().int().min(500).max(30_000).optional(),
})
async function handleFill(ctx: BrowserCtx, args: z.infer<typeof fillArgs>) {
  return browserExec(ctx, 'browserFill', 'fill', args)
}

const textArgs = z.object({
  selector:   z.string().optional().describe('Extract just this subtree. Omit for the whole page.'),
  timeout_ms: z.number().int().min(500).max(30_000).optional(),
})
async function handleText(ctx: BrowserCtx, args: z.infer<typeof textArgs>) {
  return browserExec(ctx, 'browserText', 'text', args)
}

const domArgs = z.object({})
async function handleDom(ctx: BrowserCtx, args: z.infer<typeof domArgs>) {
  return browserExec(ctx, 'browserDom', 'dom', args)
}

const backArgs = z.object({})
async function handleBack(ctx: BrowserCtx, args: z.infer<typeof backArgs>) {
  return browserExec(ctx, 'browserBack', 'back', args)
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'browser',
  name:        'Browser',
  category:    'core',
  description: 'Web access: one-shot fetch/scrape plus interactive browser primitives (navigation, screenshot, click, fill) backed by a persistent headless chromium.',
}

export const tools: ToolDef[] = [
  { name: 'fetch',      description: 'Make an HTTP request and return the response. Large responses are written to a file; use the read tool to paginate.',                                                                                    schema: validate.toolFetch, handler: handleFetch },
  { name: 'scrape',     description: 'Extract clean readable text from a web page. Large output is written to a file you can read with offset/limit.',                                                                                        schema: validate.toolScrape, handler: handleScrape },
  { name: 'browserGoto',       description: 'Navigate the session\'s browser to a URL. Cookies, localStorage, and open tabs persist across calls — use this to start a flow or follow a manual redirect.',                                     schema: gotoArgs,       handler: handleGoto },
  { name: 'browserScreenshot', description: 'Take a PNG screenshot of the current page in the session\'s browser. Returns the image inline. Use full_page=true to capture the whole scrolled page, not just the viewport.',                   schema: screenshotArgs, handler: handleScreenshot },
  { name: 'browserClick',      description: 'Click an element by CSS selector. Set wait_navigation=true when clicking something that navigates (a link or a submit button).',                                                                  schema: clickArgs,      handler: handleClick },
  { name: 'browserFill',       description: 'Type into an input or textarea by CSS selector. Clears the existing value first.',                                                                                                                schema: fillArgs,       handler: handleFill },
  { name: 'browserText',       description: 'Extract visible text from the current page. Pass a selector to narrow to a subtree. Cheap way to check state after clicking/filling.',                                                            schema: textArgs,       handler: handleText },
  { name: 'browserDom',        description: 'Return a compact list of interactive elements (links, buttons, inputs) on the current page with their selectors, roles, and text. Use this to discover what to click or fill without eyeballing a screenshot.', schema: domArgs,        handler: handleDom },
  { name: 'browserBack',       description: 'Navigate the browser back one step in history.',                                                                                                                                                   schema: backArgs,       handler: handleBack },
]
