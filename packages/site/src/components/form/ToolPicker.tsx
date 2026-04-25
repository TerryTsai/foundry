import { useState, useMemo } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { Field } from './Field.js'
import type { McpCategory, McpServerInfo, McpToolSelection } from '../../types.js'

interface ToolPickerProps {
  servers:   McpServerInfo[]
  selection: McpToolSelection | null
  onChange:  (next: McpToolSelection | null) => void
}

const CATEGORY_ORDER: McpCategory[] = ['core', 'code', 'infra', 'data', 'product', 'growth']
const CATEGORY_LABEL: Record<McpCategory, string> = {
  core: 'core', code: 'code', infra: 'infrastructure',
  data: 'data', product: 'product', growth: 'growth',
}

// Server rows use `<kind>:<conn-name>` ids for connection-backed servers;
// the display name already has the kind. Split so the connection name can
// be rendered as a softer subtitle rather than joined with a middle-dot.
function splitLabel(server: McpServerInfo): { primary: string; secondary: string | null } {
  const i = server.name.indexOf(' · ')
  if (i < 0) return { primary: server.name, secondary: null }
  return { primary: server.name.slice(0, i), secondary: server.name.slice(i + 3) }
}

export function ToolPicker({ servers, selection, onChange }: ToolPickerProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsedCats, setCollapsedCats] = useState<Set<McpCategory>>(
    () => new Set(CATEGORY_ORDER),
  )

  const sel = selection ?? {}

  // ── mutations ────────────────────────────────────────────────────────
  function setServer(id: string, val: '*' | string[] | null) {
    const next = { ...sel }
    if (val === null || (Array.isArray(val) && val.length === 0)) delete next[id]
    else next[id] = val
    onChange(Object.keys(next).length === 0 ? null : next)
  }

  // "all" pill is the only path to wildcard. Toggles between `*` and off.
  const toggleAll = (id: string) =>
    sel[id] === '*' ? setServer(id, null) : setServer(id, '*')

  // Individual pills manage the explicit list. Never auto-promotes to `*`.
  // If the server is currently wildcard, tapping a tool demotes to the
  // explicit list minus that tool (a natural "remove this one").
  function toggleTool(id: string, tool: string, all: McpServerInfo['tools']) {
    const v = sel[id]
    if (v === undefined)  { setServer(id, [tool]); return }
    if (v === '*')        { setServer(id, all.map(t => t.name).filter(n => n !== tool)); return }
    setServer(id, v.includes(tool) ? v.filter(n => n !== tool) : [...v, tool])
  }
  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
    })
  const toggleCat = (c: McpCategory) =>
    setCollapsedCats(prev => {
      const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n
    })

  // ── derived ──────────────────────────────────────────────────────────
  const { grouped, totals } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (s: McpServerInfo) => !q
      || s.name.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.tools.some(t => t.name.toLowerCase().includes(q))
    const filtered = servers.filter(match)
    const by: Record<string, McpServerInfo[]> = {}
    for (const s of filtered) (by[s.category] ??= []).push(s)
    const grouped = CATEGORY_ORDER.filter(c => by[c]?.length).map(c => ({ cat: c, items: by[c] }))
    const toolsOn = servers.reduce((n, s) => {
      const v = sel[s.id]
      return n + (v === undefined ? 0 : v === '*' ? s.tools.length : v.length)
    }, 0)
    return {
      grouped,
      totals: {
        serversOn: servers.filter(s => sel[s.id] !== undefined).length,
        toolsOn,
      },
    }
  }, [servers, sel, query])

  if (servers.length === 0) return null
  const anyOn = totals.serversOn > 0
  const hasQuery = query.length > 0

  // ── render ───────────────────────────────────────────────────────────
  return (
    <Field label="tools">
      <div className="space-y-3">
        {/* search + status */}
        <div className="relative">
          <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-600" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-zinc-100 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 text-[16px] pl-9 pr-9 py-2 rounded-lg placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:bg-white dark:focus:bg-zinc-900 transition-colors"
          />
          {hasQuery && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label="clear search"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-500 tabular-nums px-1">
          <span>
            {anyOn
              ? `${totals.serversOn} server${totals.serversOn === 1 ? '' : 's'}, ${totals.toolsOn} tool${totals.toolsOn === 1 ? '' : 's'}`
              : 'All tools enabled by default'}
          </span>
          {anyOn && (
            <button type="button" onClick={() => onChange(null)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors">
              Reset
            </button>
          )}
        </div>

        {/* categories */}
        {grouped.length === 0 ? (
          <div className="px-1 py-6 text-sm text-zinc-500 dark:text-zinc-500 text-center">No matches</div>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ cat, items }) => {
              const collapsed = collapsedCats.has(cat) && !hasQuery
              const onCount = items.filter(s => sel[s.id] !== undefined).length
              return (
                <div key={cat}>
                  <button
                    type="button"
                    onClick={() => toggleCat(cat)}
                    disabled={hasQuery}
                    className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors pb-1.5 px-1 w-full"
                  >
                    <span className="font-medium tracking-wide">{CATEGORY_LABEL[cat]}</span>
                    {onCount > 0 && (
                      <span className="text-sky-500 dark:text-sky-400 tabular-nums">{onCount}</span>
                    )}
                    <span className="flex-1" />
                    {!hasQuery && (
                      <ChevronDown size={12} strokeWidth={2}
                        className={`text-zinc-400 dark:text-zinc-700 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                    )}
                  </button>
                  {!collapsed && (
                    <div className="space-y-px">
                      {items.map(s => renderRow(s))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Field>
  )

  // ── row renderer ─────────────────────────────────────────────────────
  function renderRow(server: McpServerInfo) {
    const v = sel[server.id]
    const on = v !== undefined
    const isWild = v === '*'
    const isExpanded = expanded.has(server.id)
    const { primary, secondary } = splitLabel(server)
    const status = v === undefined ? null : v === '*' ? `All ${server.tools.length}` : `${v.length} of ${server.tools.length}`

    return (
      <div
        key={server.id}
        className={`rounded-lg transition-colors ${on ? 'bg-zinc-100 dark:bg-zinc-900/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'}`}
      >
        <button
          type="button"
          onClick={() => toggleExpand(server.id)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
          aria-expanded={isExpanded}
        >
          <span className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className={`text-sm truncate ${on ? 'text-zinc-900 dark:text-zinc-100 font-medium' : 'text-zinc-700 dark:text-zinc-400'}`}>
              {primary}
            </span>
            {secondary && (
              <span className="text-xs text-zinc-500 dark:text-zinc-500 truncate">{secondary}</span>
            )}
          </span>
          {status && (
            <span className="text-xs text-sky-600 dark:text-sky-400 tabular-nums shrink-0">{status}</span>
          )}
          <ChevronDown size={14} strokeWidth={2}
            className={`text-zinc-400 dark:text-zinc-600 transition-transform shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
        </button>
        {isExpanded && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-3">
            <Pill
              label="all"
              active={isWild}
              mono={false}
              onClick={() => toggleAll(server.id)}
            />
            {server.tools.map(t => {
              const toolOn = isWild || (Array.isArray(v) && v.includes(t.name))
              return (
                <Pill
                  key={t.name}
                  label={t.name}
                  active={toolOn}
                  dimmed={isWild}
                  onClick={() => toggleTool(server.id, t.name, server.tools)}
                />
              )
            })}
          </div>
        )}
      </div>
    )
  }
}

function Pill({ label, active, dimmed, mono = true, onClick }: {
  label: string; active: boolean; dimmed?: boolean; mono?: boolean; onClick: () => void
}) {
  const base = 'px-2.5 py-1 rounded-full transition-colors text-xs'
  const font = mono ? 'font-mono' : 'font-medium'
  const tone = active && dimmed
    ? 'bg-sky-500/10 text-sky-600/70 dark:text-sky-300/70'
    : active
      ? 'bg-sky-500 text-white dark:bg-sky-500/90'
      : 'bg-zinc-200/60 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
  return (
    <button type="button" onClick={onClick} className={`${base} ${font} ${tone}`}>{label}</button>
  )
}
