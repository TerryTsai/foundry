import { useState, useEffect, useCallback } from 'react'
import { logsApi } from '../api.js'
import type { AgentSession, SandboxRun } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'

type Tab = 'sessions' | 'runs' | 'nginx'

const labelCls = 'font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600'

function SessionDetail({ session }: { session: AgentSession }) {
  const ts = (s: string) => new Date(s).toLocaleString()
  const duration = session.ended_at
    ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100">Session</h2>
        <StatusBadge status={session.status} />
      </div>
      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-600 space-y-1 border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div>id <span className="text-zinc-600 dark:text-zinc-400">{session.id}</span></div>
        <div>agent <span className="text-zinc-600 dark:text-zinc-400">{session.agent_name ?? session.agent_def_id}</span></div>
        <div>ticket <span className="text-zinc-600 dark:text-zinc-400">{session.ticket_id}</span></div>
        <div>started <span className="text-zinc-600 dark:text-zinc-400">{ts(session.started_at)}</span></div>
        {session.ended_at && <div>ended <span className="text-zinc-600 dark:text-zinc-400">{ts(session.ended_at)}</span></div>}
        {duration !== null && <div>duration <span className="text-zinc-600 dark:text-zinc-400">{duration}s</span></div>}
      </div>
    </div>
  )
}

function RunDetail({ run }: { run: SandboxRun }) {
  const ts = (s: string) => new Date(s).toLocaleString()
  const duration = run.ended_at
    ? Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000)
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100">Sandbox Run</h2>
        <StatusBadge status={run.status} />
      </div>
      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-600 space-y-1 border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div>id <span className="text-zinc-600 dark:text-zinc-400">{run.id}</span></div>
        <div>image <span className="text-zinc-600 dark:text-zinc-400">{run.image}</span></div>
        {run.session_id && <div>session <span className="text-zinc-600 dark:text-zinc-400">{run.session_id}</span></div>}
        <div>exit code <span className="text-zinc-600 dark:text-zinc-400">{run.exit_code ?? '—'}</span></div>
        <div>started <span className="text-zinc-600 dark:text-zinc-400">{ts(run.started_at)}</span></div>
        {run.ended_at && <div>ended <span className="text-zinc-600 dark:text-zinc-400">{ts(run.ended_at)}</span></div>}
        {duration !== null && <div>duration <span className="text-zinc-600 dark:text-zinc-400">{duration}s</span></div>}
      </div>
      <div className="space-y-1">
        <div className={labelCls}>command</div>
        <pre className="bg-zinc-50 dark:bg-zinc-900 p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{run.command}</pre>
      </div>
    </div>
  )
}

export function LogsView() {
  const [tab, setTab] = useState<Tab>('sessions')
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [runs, setRuns] = useState<SandboxRun[]>([])
  const [nginxLines, setNginxLines] = useState<string[]>([])
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null)
  const [selectedRun, setSelectedRun] = useState<SandboxRun | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'sessions') setSessions(await logsApi.sessions())
      else if (tab === 'runs') setRuns(await logsApi.sandboxRuns())
      else if (tab === 'nginx') setNginxLines(await logsApi.nginx())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [tab])

  useEffect(() => { load().catch(console.error) }, [load])

  const ts = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const counts: Record<Tab, number> = {
    sessions: sessions.length,
    runs: runs.length,
    nginx: nginxLines.length,
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center">
        <div className="flex flex-1">
          {(['sessions', 'runs', 'nginx'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`font-mono text-[10px] uppercase tracking-wider px-4 py-2.5 border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-400 dark:text-zinc-600 active:text-zinc-700 dark:active:text-zinc-300'
              }`}>
              {t}{counts[t] > 0 && <span className="ml-1.5 text-zinc-300 dark:text-zinc-700">{counts[t]}</span>}
            </button>
          ))}
        </div>
        <button onClick={load}
          className="font-mono text-xs text-zinc-300 dark:text-zinc-600 active:text-zinc-900 dark:active:text-zinc-100 px-4 py-2.5">
          ↻
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {loading && <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">loading…</div>}

        {!loading && tab === 'sessions' && (
          sessions.length === 0
            ? <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">no sessions</div>
            : sessions.map(s => (
              <button key={s.id} onClick={() => setSelectedSession(s)}
                className="w-full text-left border-b border-zinc-100 dark:border-zinc-800/50 active:bg-zinc-50 dark:active:bg-zinc-900/70 px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-800 dark:text-zinc-200 text-sm leading-snug truncate">{s.agent_name ?? s.agent_def_id}</div>
                  <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5 truncate">{s.ticket_id} · {ts(s.started_at)}</div>
                </div>
                <div className="shrink-0"><StatusBadge status={s.status} /></div>
              </button>
            ))
        )}

        {!loading && tab === 'runs' && (
          runs.length === 0
            ? <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">no runs</div>
            : runs.map(r => (
              <button key={r.id} onClick={() => setSelectedRun(r)}
                className="w-full text-left border-b border-zinc-100 dark:border-zinc-800/50 active:bg-zinc-50 dark:active:bg-zinc-900/70 px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-800 dark:text-zinc-200 text-sm leading-snug font-mono truncate">{r.command}</div>
                  <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5">{r.image} · {ts(r.started_at)}</div>
                </div>
                <div className="shrink-0"><StatusBadge status={r.status} /></div>
              </button>
            ))
        )}

        {!loading && tab === 'nginx' && (
          nginxLines.length === 0
            ? <div className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-600">no log entries</div>
            : (
              <div className="p-4">
                <pre className="font-mono text-[10px] text-zinc-500 dark:text-zinc-500 leading-relaxed whitespace-pre-wrap break-all">
                  {nginxLines.slice().reverse().join('\n')}
                </pre>
              </div>
            )
        )}
      </div>

      <Sheet open={selectedSession !== null} onClose={() => setSelectedSession(null)}>
        {selectedSession && <SessionDetail session={selectedSession} />}
      </Sheet>

      <Sheet open={selectedRun !== null} onClose={() => setSelectedRun(null)}>
        {selectedRun && <RunDetail run={selectedRun} />}
      </Sheet>
    </div>
  )
}
