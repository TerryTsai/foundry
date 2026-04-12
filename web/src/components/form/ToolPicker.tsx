import { useState } from 'react'
import { Field } from './Field.js'
import type { McpServerInfo, McpToolSelection } from '../../types.js'

interface ToolPickerProps {
  servers: McpServerInfo[]
  selection: McpToolSelection | null
  onChange: (next: McpToolSelection | null) => void
}

function pillCls(active: boolean, dimmed?: boolean): string {
  if (active && dimmed)
    return 'border-sky-500/40 bg-sky-500/5 text-sky-500/60 dark:text-sky-400/50'
  if (active)
    return 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300'
  return 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
}

export function ToolPicker({ servers, selection, onChange }: ToolPickerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (servers.length === 0) return null

  const sel = selection ?? {}
  const anyOn = Object.keys(sel).length > 0

  function setServer(id: string, val: '*' | string[] | null) {
    const next = { ...sel }
    if (val === null || (Array.isArray(val) && val.length === 0)) delete next[id]
    else next[id] = val
    onChange(Object.keys(next).length === 0 ? null : next)
  }

  function toggleExpand(id: string) {
    setExpanded((prev: Set<string>) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Cycles off → all → off on header click
  function toggleServer(id: string) {
    sel[id] !== undefined ? setServer(id, null) : setServer(id, '*')
  }

  // "all" pill in expanded row: toggle wildcard vs custom (all tools listed)
  function toggleWildcard(id: string, tools: McpServerInfo['tools']) {
    const current = sel[id]
    if (current === undefined) { setServer(id, '*'); return }
    if (current === '*') setServer(id, tools.map(t => t.name))
    else setServer(id, '*')
  }

  function toggleTool(serverId: string, toolName: string, allTools: McpServerInfo['tools']) {
    const current = sel[serverId]
    // Server was off — turn on with just this tool
    if (current === undefined) { setServer(serverId, [toolName]); return }
    let names: string[]
    if (current === '*') {
      // Remove one tool from wildcard
      names = allTools.map(t => t.name).filter(n => n !== toolName)
    } else {
      names = current.includes(toolName)
        ? current.filter(n => n !== toolName)
        : [...current, toolName]
    }
    // Auto-promote to wildcard when all tools are manually selected
    setServer(serverId, names.length === allTools.length ? '*' : names)
  }

  function summary(id: string, tools: McpServerInfo['tools']): string {
    const v = sel[id]
    if (v === undefined) return 'off'
    if (v === '*') return `all (${tools.length})`
    return `${v.length} of ${tools.length}`
  }

  return (
    <Field label="tools">
      <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
        {servers.map(server => {
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
                  {/* "all" pill — toggles wildcard vs explicit list */}
                  <button
                    type="button"
                    onClick={() => toggleWildcard(server.id, server.tools)}
                    className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${pillCls(on && isWild)}`}
                  >
                    all
                  </button>
                  {server.tools.map(tool => {
                    const toolOn = isWild || (Array.isArray(v) && v.includes(tool.name))
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        onClick={() => toggleTool(server.id, tool.name, server.tools)}
                        className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${pillCls(toolOn, isWild)}`}
                      >
                        {tool.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!anyOn && (
        <div className="text-[11px] text-zinc-500 mt-1">all tools enabled when none selected</div>
      )}
    </Field>
  )
}
