import {
  Terminal, FileText, FilePen, FileDiff, Trash2, Search, Folder,
  Globe, Newspaper,
  Download, GitBranch, GitCommit, GitMerge, GitPullRequest, Plus, Minus, ListTree,
  Ticket, Bot, Brain, Activity, Gavel,
  CloudUpload, Cloud, History, ShieldCheck, Eraser,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Single source of truth for how tool calls render in the activity timeline.
// - toolLabel: human-readable string ("git clone TerryTsai/foundry"). Used
//   as the ActivityRow label. Lowercase, matches other activity items.
// - toolIcon: Lucide icon component for the row's leading glyph.
//
// Includes legacy aliases (pullRequestCreate, ticket, agents) so historical
// execution rows from before the tool rename still render correctly.

interface ToolMeta {
  label: (input: Record<string, unknown>) => string
  icon:  LucideIcon
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + '…' : s
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
}

const TOOL_META: Record<string, ToolMeta> = {
  // ── sandbox ──
  run:    { label: i => `run ${truncate(asString(i.command) ?? '', 60)}`, icon: Terminal },
  exec:   { label: i => `exec ${truncate(asString(i.command) ?? '', 60)}`, icon: Terminal },
  read:   { label: i => `read ${asString(i.path) ?? ''}${typeof i.offset === 'number' ? ` from ${i.offset}` : ''}`, icon: FileText },
  write:  { label: i => `write ${asString(i.path) ?? ''}`, icon: FilePen },
  patch:  { label: i => `patch ${asString(i.path) ?? ''}`, icon: FileDiff },
  remove: { label: i => `remove ${asString(i.path) ?? ''}`, icon: Trash2 },
  search: { label: i => `search "${truncate(asString(i.pattern) ?? '', 40)}"${asString(i.path) ? ` in ${asString(i.path)}` : ''}`, icon: Search },
  find:   { label: i => `find ${asString(i.pattern) ?? ''}${asString(i.path) ? ` in ${asString(i.path)}` : ''}`, icon: Folder },

  // ── browser ──
  fetch:  { label: i => `fetch ${asString(i.url) ?? ''}`, icon: Globe },
  scrape: { label: i => `scrape ${asString(i.url) ?? ''}`, icon: Newspaper },

  // ── github ──
  gitClone:       { label: i => `git clone${asString(i.owner) && asString(i.repo) ? ` ${asString(i.owner)}/${asString(i.repo)}` : ''}`, icon: Download },
  gitStatus:      { label: _ => 'git status', icon: GitBranch },
  gitDiff:        { label: i => `git diff${i.staged ? ' --staged' : ''}${asArray(i.paths)?.length ? ' ' + asArray(i.paths)!.join(' ') : ''}`, icon: FileDiff },
  gitAdd:         { label: i => `git add${asArray(i.paths)?.length ? ' ' + asArray(i.paths)!.join(' ') : ''}`, icon: Plus },
  gitRemove:      { label: i => `git rm${asArray(i.paths)?.length ? ' ' + asArray(i.paths)!.join(' ') : ''}`, icon: Minus },
  gitCommit:      { label: i => `git commit${asString(i.message) ? ` "${truncate(asString(i.message)!, 50)}"` : ''}`, icon: GitCommit },
  gitPullRequest: { label: _ => 'git pull request', icon: GitPullRequest },
  gitMerge:       { label: _ => 'git merge', icon: GitMerge },
  gitRebase:      { label: _ => 'git rebase', icon: GitBranch },

  // ── foundry ──
  ticketList:    { label: _ => 'ticket list', icon: Ticket },
  ticketGet:     { label: i => `ticket get ${asString(i.id) ?? ''}`, icon: Ticket },
  ticketCreate:  { label: i => `ticket create "${truncate(asString(i.title) ?? '', 40)}"`, icon: Ticket },
  ticketComment: { label: _ => 'ticket comment', icon: Ticket },
  agentsList:    { label: _ => 'agents list', icon: Bot },
  sessionList:   { label: _ => 'session list', icon: ListTree },
  connectionList:{ label: _ => 'connection list', icon: Activity },
  think:         { label: _ => 'think', icon: Brain },
  verdictReport: { label: i => `verdict: ${i.pass ? 'pass' : 'fail'}${asString(i.reason) ? ` — ${truncate(asString(i.reason)!, 60)}` : ''}`, icon: Gavel },

  // ── cloudflare ──
  whoami:           { label: _ => 'cloudflare whoami', icon: ShieldCheck },
  purgeCache:       { label: i => `cloudflare purge${i.purge_everything ? ' (everything)' : asArray(i.files)?.length ? ` ${asArray(i.files)!.length} url(s)` : ''}`, icon: Eraser },
  pagesList:        { label: _ => 'cloudflare pages list', icon: Cloud },
  pagesDeployments: { label: i => `cloudflare pages deployments${asString(i.project_name) ? ` ${asString(i.project_name)}` : ''}`, icon: History },
  pagesDeploy:      { label: i => `cloudflare pages deploy${asString(i.project_name) ? ` ${asString(i.project_name)}` : ''}${asString(i.dir) ? ` ← ${asString(i.dir)}` : ''}`, icon: CloudUpload },
  pagesRemove:      { label: i => `cloudflare pages remove${asString(i.project_name) ? ` ${asString(i.project_name)}` : ''}`, icon: Trash2 },

  // ── legacy aliases (historical rows from before tool renames) ──
  pullRequestCreate: { label: _ => 'git pull request', icon: GitPullRequest },
  agents:            { label: _ => 'agents list', icon: Bot },
  ticket:            { label: i => `ticket ${asString(i.action) ?? ''}`, icon: Ticket },
  providerList:      { label: _ => 'provider list', icon: Activity },
}

export function toolLabel(name: string | null, inputJson: string | null): string {
  if (!name) return 'exec'
  let input: Record<string, unknown> = {}
  if (inputJson) {
    try {
      const parsed = JSON.parse(inputJson)
      if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
    } catch { /* use empty input */ }
  }
  const meta = TOOL_META[name]
  return meta ? meta.label(input) : name
}

export function toolIcon(name: string | null, size = 14): React.ReactNode {
  const Icon = (name && TOOL_META[name]?.icon) || Terminal
  return <Icon size={size} />
}
