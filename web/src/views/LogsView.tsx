import { useState, useEffect, useCallback } from 'react'
import { logsApi } from '../api.js'
import type { Session, Execution } from '../types.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { Sheet } from '../components/Sheet.js'
import { ListRow } from '../components/list/ListRow.js'
import { EmptyState } from '../components/list/EmptyState.js'
import { InfoGroup } from '../components/detail/InfoGroup.js'

type Tab = 'sessions' | 'executions' | 'nginx'

function SessionDetail({ session }: { session: Session }) {
  const ts = (s: string) => new Date(s).toLocaleString()
  const duration = session.duration_ms !== null ? `${(session.duration_ms / 1000).toFixed(1)}s` : null

  return (
    <div className="h-full overflow-y-auto space-y-3">
      <StatusBadge status={session.status} />
      <InfoGroup rows={[
        { label: 'id',         value: session.id },
        { label: 'agent',      value: session.agent_name ?? session.agent_id },
        { label: 'model',      value: session.model },
        { label: 'ticket',     value: session.ticket_id },
        { label: 'started',    value: ts(session.started_at) },
        { label: 'ended',      value: session.ended_at ? ts(session.ended_at) : null },
        { label: 'duration',   value: duration },
        { label: 'tokens in',  value: session.tokens_in ?? null },
        { label: 'tokens out', value: session.tokens_out ?? null },
        { label: 'cost',       value: session.cost_usd !== null ? `$${session.cost_usd.toFixed(4)}` : null },
      ]} />
      {session.error && (
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">error</div>
          <pre className="bg-red-50 dark:bg-red-950/30 p-3 font-mono text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap leading-relaxed">{session.error}</pre>
        </div>
      )}
    </div>
  )
}

function ExecutionDetail({ execution }: { execution: Execution }) {
  const ts = (s: string) => new Date(s).toLocaleString()
  const duration = execution.duration_ms !== null ? `${(execution.duration_ms / 1000).toFixed(1)}s` : null

  return (
    <div className="h-full overflow-y-auto space-y-3">
      <StatusBadge status={execution.status} />
      <InfoGroup rows={[
        { label: 'id',        value: execution.id },
        { label: 'session',   value: execution.session_id ?? null },
        { label: 'exit code', value: execution.exit_code ?? null },
        { label: 'timeout',   value: `${(execution.timeout_ms / 1000).toFixed(0)}s` },
        { label: 'memory',    value: execution.memory_mb !== null ? `${execution.memory_mb}MB` : null },
        { label: 'started',   value: ts(execution.started_at) },
        { label: 'ended',     value: execution.ended_at ? ts(execution.ended_at) : null },
        { label: 'duration',  value: duration },
      ]} />
      <div className="space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">command</div>
        <pre className="bg-zinc-100 dark:bg-zinc-900 p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{execution.command}</pre>
      </div>
    </div>
  )
}

export function LogsView() {
  const [tab, setTab] = useState<Tab>('sessions')
  const [sessions, setSessions] = useState<Session[]>([])
  const [executions, setExecutions] = useState<Execution[]>([])
  const [nginxLines, setNginxLines] = useState<string[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'sessions') setSessions(await logsApi.sessions())
      else if (tab === 'executions') setExecutions(await logsApi.executions())
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
    executions: executions.length,
    nginx: nginxLines.length,
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-zinc-200 dark:border-zinc-800/60 shrink-0 flex items-center px-4 h-11">
        {(['sessions', 'executions', 'nginx'] as Tab[]).map(t => (
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
          {loading && <EmptyState message="loading..." />}

          {!loading && tab === 'sessions' && (
            sessions.length === 0
              ? <EmptyState message="no sessions" />
              : sessions.map(s => (
                <ListRow
                  key={s.id}
                  title={s.agent_name ?? s.agent_id}
                  subtitle={`${s.ticket_id} · ${ts(s.started_at)}`}
                  status={s.status}
                  active={selectedSession?.id === s.id}
                  onPress={() => setSelectedSession(s)}
                />
              ))
          )}

          {!loading && tab === 'executions' && (
            executions.length === 0
              ? <EmptyState message="no executions" />
              : executions.map(e => (
                <ListRow
                  key={e.id}
                  title={e.command}
                  subtitle={ts(e.started_at)}
                  status={e.status}
                  active={selectedExecution?.id === e.id}
                  onPress={() => setSelectedExecution(e)}
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

        {/* Detail column — desktop only, sessions/executions tabs */}
        {tab !== 'nginx' && (
          <div className="hidden lg:flex flex-col overflow-y-auto">
            {tab === 'sessions' && selectedSession ? (
              <div className="flex-1 px-6 py-5 max-w-3xl">
                <SessionDetail session={selectedSession} />
              </div>
            ) : tab === 'executions' && selectedExecution ? (
              <div className="flex-1 px-6 py-5 max-w-3xl">
                <ExecutionDetail execution={selectedExecution} />
              </div>
            ) : (
              <EmptyState message={`select a ${tab === 'sessions' ? 'session' : 'execution'}`} />
            )}
          </div>
        )}
      </div>

      {/* Detail sheets — mobile only */}
      <div className="lg:hidden">
        <Sheet open={selectedSession !== null} onClose={() => setSelectedSession(null)} title="Session">
          {selectedSession && <SessionDetail session={selectedSession} />}
        </Sheet>

        <Sheet open={selectedExecution !== null} onClose={() => setSelectedExecution(null)} title="Execution">
          {selectedExecution && <ExecutionDetail execution={selectedExecution} />}
        </Sheet>
      </div>
    </div>
  )
}
