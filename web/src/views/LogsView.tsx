import { useState, useEffect, useCallback } from 'react'
import { logsApi } from '../api.js'
import type { AgentSession, SandboxRun } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { InfoGroup } from '../components/detail/InfoGroup.js'

type Tab = 'sessions' | 'runs' | 'nginx'

function SessionDetail({ session }: { session: AgentSession }) {
  const ts = (s: string) => new Date(s).toLocaleString()
  const duration = session.ended_at
    ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
    : null

  return (
    <div className="h-full overflow-y-auto space-y-3">
      <StatusBadge status={session.status} />
      <InfoGroup rows={[
        { label: 'id',       value: session.id },
        { label: 'agent',    value: session.agent_name ?? session.agent_def_id },
        { label: 'ticket',   value: session.ticket_id },
        { label: 'started',  value: ts(session.started_at) },
        { label: 'ended',    value: session.ended_at ? ts(session.ended_at) : null },
        { label: 'duration', value: duration !== null ? `${duration}s` : null },
      ]} />
    </div>
  )
}

function RunDetail({ run }: { run: SandboxRun }) {
  const ts = (s: string) => new Date(s).toLocaleString()
  const duration = run.ended_at
    ? Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000)
    : null

  return (
    <div className="h-full overflow-y-auto space-y-3">
      <StatusBadge status={run.status} />
      <InfoGroup rows={[
        { label: 'id',        value: run.id },
        { label: 'image',     value: run.image },
        { label: 'session',   value: run.session_id ?? null },
        { label: 'exit code', value: run.exit_code ?? null },
        { label: 'started',   value: ts(run.started_at) },
        { label: 'ended',     value: run.ended_at ? ts(run.ended_at) : null },
        { label: 'duration',  value: duration !== null ? `${duration}s` : null },
      ]} />
      <div className="space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">command</div>
        <pre className="bg-zinc-100 dark:bg-zinc-900 p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{run.command}</pre>
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

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const counts: Record<Tab, number> = {
    sessions: sessions.length,
    runs: runs.length,
    nginx: nginxLines.length,
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-200 dark:border-zinc-800/60 shrink-0 flex items-center px-4 h-11">
        {(['sessions', 'runs', 'nginx'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative text-sm px-4 h-full flex items-center transition-colors capitalize ${
              tab === t ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 active:text-zinc-700 dark:active:text-zinc-300'
            }`}>
            {tab === t && <span className="absolute bottom-0 left-0 right-0 h-px bg-zinc-700 dark:bg-zinc-300 rounded-full" />}
            {t}{counts[t] > 0 && <span className="ml-1.5 text-zinc-400 dark:text-zinc-600">{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr]">
        {/* List column */}
        <div className="overflow-y-auto h-full lg:border-r lg:border-zinc-200 dark:lg:border-zinc-800/60">
          {loading && <EmptyState message="loading…" />}

          {!loading && tab === 'sessions' && (
            sessions.length === 0
              ? <EmptyState message="no sessions" />
              : sessions.map(s => (
                <ListRow
                  key={s.id}
                  title={s.agent_name ?? s.agent_def_id}
                  subtitle={`${s.ticket_id} · ${ts(s.started_at)}`}
                  status={s.status}
                  active={selectedSession?.id === s.id}
                  onPress={() => setSelectedSession(s)}
                />
              ))
          )}

          {!loading && tab === 'runs' && (
            runs.length === 0
              ? <EmptyState message="no runs" />
              : runs.map(r => (
                <ListRow
                  key={r.id}
                  title={r.command}
                  subtitle={`${r.image} · ${ts(r.started_at)}`}
                  status={r.status}
                  active={selectedRun?.id === r.id}
                  onPress={() => setSelectedRun(r)}
                />
              ))
          )}

          {!loading && tab === 'nginx' && (
            <div className={`p-4 ${nginxLines.length === 0 ? '' : 'lg:col-span-2'}`}>
              {nginxLines.length === 0
                ? <EmptyState message="no log entries" />
                : (
                  <pre className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed whitespace-pre-wrap break-all">
                    {nginxLines.slice().reverse().join('\n')}
                  </pre>
                )
              }
            </div>
          )}
        </div>

        {/* Detail column — desktop only, sessions/runs tabs */}
        {tab !== 'nginx' && (
          <div className="hidden lg:flex flex-col overflow-y-auto">
            {tab === 'sessions' && selectedSession ? (
              <div className="flex-1 px-6 py-5 max-w-3xl">
                <SessionDetail session={selectedSession} />
              </div>
            ) : tab === 'runs' && selectedRun ? (
              <div className="flex-1 px-6 py-5 max-w-3xl">
                <RunDetail run={selectedRun} />
              </div>
            ) : (
              <EmptyState message={`select a ${tab === 'sessions' ? 'session' : 'run'}`} />
            )}
          </div>
        )}
      </div>

      {/* Detail sheets — mobile only */}
      <div className="lg:hidden">
        <Sheet open={selectedSession !== null} onClose={() => setSelectedSession(null)} title="Session">
          {selectedSession && <SessionDetail session={selectedSession} />}
        </Sheet>

        <Sheet open={selectedRun !== null} onClose={() => setSelectedRun(null)} title="Run">
          {selectedRun && <RunDetail run={selectedRun} />}
        </Sheet>
      </div>
    </div>
  )
}
