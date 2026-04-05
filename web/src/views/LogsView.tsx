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
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-100">Session</h2>
        <StatusBadge status={session.status} />
      </div>
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
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-base font-bold text-zinc-100">Sandbox Run</h2>
        <StatusBadge status={run.status} />
      </div>
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
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">command</div>
        <pre className="bg-zinc-900 p-3 font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{run.command}</pre>
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
      <div className="px-5 pt-4 pb-2 shrink-0">
        <h1 className="font-display text-2xl font-bold text-zinc-100 tracking-tight">Logs</h1>
      </div>

      <div className="border-b border-zinc-800 shrink-0 flex items-center">
        {(['sessions', 'runs', 'nginx'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`font-mono text-[10px] uppercase tracking-wider px-4 py-2.5 border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-600 active:text-zinc-300'
            }`}>
            {t}{counts[t] > 0 && <span className="ml-1.5 text-zinc-700">{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto flex-1">
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
                onPress={() => setSelectedRun(r)}
              />
            ))
        )}

        {!loading && tab === 'nginx' && (
          nginxLines.length === 0
            ? <EmptyState message="no log entries" />
            : (
              <div className="p-4">
                <pre className="font-mono text-[10px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-all">
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
