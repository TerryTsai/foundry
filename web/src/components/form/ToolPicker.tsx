import { useState, useMemo } from 'react'
import { Field } from './Field.js'
import type { McpCategory, McpServerInfo, McpToolSelection } from '../../types.js'

interface ToolPickerProps {
  servers:   McpServerInfo[]
  selection: McpToolSelection | null
  onChange:  (next: McpToolSelection | null) => void
}

const CATEGORY_ORDER: McpCategory[] = ['core', 'code', 'infra', 'data', 'product', 'growth']
const CATEGORY_LABEL: Record<McpCategory, string> = {
  core:    'Core',
  code:    'Code',
  infra:   'Infrastructure',
  data:    'Data',
  product: 'Product',
  growth:  'Growth',
}

function pillCls(active: boolean, dimmed?: boolean): string {
  if (active && dimmed)
    return 'border-sky-500/40 bg-sky-500/5 text-sky-500/60 dark:text-sky-400/50'
  if (active)
    return 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300'
  return 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
}

export function ToolPicker({ servers, selection, onChange }: ToolPickerProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsedCats, setCollapsedCats] = useState<Set<McpCategory>>(new Set())

  const sel = selection ?? {}

  // ── mutations ────────────────────────────────────────────────────────
  function setServer(id: string, val: '*' | string[] | null) {
    const next = { ...sel }
    if (val === null || (Array.isArray(val) && val.length === 0)) delete next[id]
    else next[id] = val
    onChange(Object.keys(next).length === 0 ? null : next)
  }
  function toggleServer(id: string) {
    sel[id] !== undefined ? setServer(id, null) : setServer(id, '*')
  }
  function toggleWildcard(id: string, tools: McpServerInfo['tools']) {
    const current = sel[id]
    if (current === undefined) { setServer(id, '*'); return }
    if (current === '*') setServer(id, tools.map(t => t.name))
    else setServer(id, '*')
  }
  function toggleTool(serverId: string, toolName: string, allTools: McpServerInfo['tools']) {
    const current = sel[serverId]
    if (current === undefined) { setServer(serverId, [toolName]); return }
    let names: string[]
    if (current === '*') names = allTools.map(t => t.name).filter(n => n !== toolName)
    else names = current.includes(toolName) ? current.filter(n => n !== toolName) : [...current, toolName]
    setServer(serverId, names.length === allTools.length ? '*' : names)
  }
  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleCat(cat: McpCategory) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }
  function clearAll() { onChange(null) }

  // ── derived ──────────────────────────────────────────────────────────
  const summary = (id: string, tools: McpServerInfo['tools']): string => {
    const v = sel[id]
    if (v === undefined) return 'off'
    if (v === '*') return `all (${tools.length})`
    return `${v.length} of ${tools.length}`
  }

  const { filtered, totals } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (s: McpServerInfo): boolean => {
      if (!q) return true
      if (s.name.toLowerCase().includes(q)) return true
      if (s.description.toLowerCase().includes(q)) return true
      return s.tools.some(t => t.name.toLowerCase().includes(q))
    }
    const filtered = servers.filter(match)
    const serversOn = servers.filter(s => sel[s.id] !== undefined).length
    const toolsTotal = servers.reduce((n, s) => n + s.tools.length, 0)
    const toolsOn = servers.reduce((n, s) => {
      const v = sel[s.id]
      if (v === undefined) return n
      if (v === '*') return n + s.tools.length
      return n + v.length
    }, 0)
    return {
      filtered,
      totals: { servers: servers.length, serversOn, tools: toolsTotal, toolsOn },
    }
  }, [servers, sel, query])

  const grouped = useMemo(() => {
    const by: Record<string, McpServerInfo[]> = {}
    for (const s of filtered) (by[s.category] ??= []).push(s)
    return CATEGORY_ORDER.filter(c => by[c]?.length).map(c => ({ cat: c, items: by[c] }))
  }, [filtered])

  if (servers.length === 0) return null
  const anyOn = totals.serversOn > 0

  // ── server row ──────────────────────────────────────────────────────
  const renderRow = (server: McpServerInfo) => {
    const v = sel[server.id]
    const on = v !== undefined
    const isWild = v === '*'
    const isExpanded = expanded.has(server.id)
    return (
      <div key={server.id}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => toggleServer(server.id)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <span className={`font-mono text-xs shrink-0 ${on ? 'text-zinc-200' : 'text-zinc-500'}`}>
              {server.name}
            </span>
            <span className={`text-[9px] shrink-0 leading-none ${on ? 'text-sky-400' : 'text-zinc-700'}`}>●</span>
            <span className="text-[11px] text-zinc-500 shrink-0">{summary(server.id, server.tools)}</span>
          </button>
          <button
            type="button"
            onClick={() => toggleExpand(server.id)}
            className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors px-1 shrink-0"
          >
            {isExpanded ? '▴' : '▾'}
          </button>
        </div>
        {isExpanded && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-1 border-t border-zinc-800/60">
            <button
              type="button"
              onClick={() => toggleWildcard(server.id, server.tools)}
              className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${pillCls(on && isWild)}`}
            >all</button>
            {server.tools.map(t => {
              const toolOn = isWild || (Array.isArray(v) && v.includes(t.name))
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => toggleTool(server.id, t.name, server.tools)}
                  className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${pillCls(toolOn, isWild)}`}
                >{t.name}</button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <Field label="tools">
      <div className="space-y-2">
        {/* summary + search + clear */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search tools…"
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
          />
          <span className="text-[11px] text-zinc-500 font-mono shrink-0">
            {totals.serversOn} of {totals.servers} · {totals.toolsOn} of {totals.tools} tools
          </span>
          {anyOn && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 shrink-0"
            >clear</button>
          )}
        </div>

        {/* grouped rows */}
        <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
          {grouped.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-500">no matches</div>
          ) : grouped.map(({ cat, items }) => {
            const collapsed = collapsedCats.has(cat)
            const onCount = items.filter(s => sel[s.id] !== undefined).length
            return (
              <div key={cat}>
                <button
                  type="button"
                  onClick={() => toggleCat(cat)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <span className="text-[9px]">{collapsed ? '▸' : '▾'}</span>
                  <span>{CATEGORY_LABEL[cat]}</span>
                  <span className="text-zinc-600">· {items.length}</span>
                  {onCount > 0 && <span className="text-sky-500">· {onCount} on</span>}
                </button>
                {!collapsed && (
                  <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/60">
                    {items.map(renderRow)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {!anyOn && (
          <div className="text-[11px] text-zinc-500">all tools enabled when none selected</div>
        )}
      </div>
    </Field>
  )
}
