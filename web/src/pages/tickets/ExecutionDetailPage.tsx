import { useLoaderData } from 'react-router-dom'
import type { Execution } from '../../types.js'
import { InfoGroup } from '../../components/detail/InfoGroup.js'
import { SectionLabel } from '../../components/detail/SectionLabel.js'
import { useBreadcrumbLabel } from '../../Breadcrumb.js'

const codeCls = 'font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all leading-relaxed select-text bg-zinc-50 dark:bg-zinc-900/50 rounded p-3 mx-4 max-h-96 overflow-auto'

const fmtBytes = (b: number): string =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB`
  : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB`
  : b >= 1024 ? `${(b / 1024).toFixed(1)} KB`
  : `${b} B`

export function ExecutionDetailPage() {
  const execution = useLoaderData() as Execution

  const firstLine = execution.command.split('\n')[0].slice(0, 80)
  useBreadcrumbLabel(firstLine)

  const ts = (s: string) => new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const duration = execution.duration_ms !== null ? `${(execution.duration_ms / 1000).toFixed(1)}s` : null

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-mono truncate">{firstLine}</h2>

      <InfoGroup rows={[
        { label: 'status',    value: execution.status },
        { label: 'exit code', value: execution.exit_code !== null ? String(execution.exit_code) : null },
        { label: 'signal',    value: execution.exit_signal },
        { label: 'duration',  value: duration },
        { label: 'cpu',       value: execution.cpu_ms !== null ? `${(execution.cpu_ms / 1000).toFixed(2)}s` : null },
        { label: 'memory',    value: execution.peak_memory_mb !== null ? `${execution.peak_memory_mb.toFixed(1)} MB` : execution.memory_mb !== null ? `${execution.memory_mb} MB limit` : null },
        { label: 'timeout',   value: `${(execution.timeout_ms / 1000).toFixed(0)}s` },
        { label: 'net in',    value: execution.net_rx_bytes !== null ? fmtBytes(execution.net_rx_bytes) : null },
        { label: 'net out',   value: execution.net_tx_bytes !== null ? fmtBytes(execution.net_tx_bytes) : null },
        { label: 'started',   value: ts(execution.started_at) },
      ]} />

      {execution.command.includes('\n') && (
        <div className="space-y-1">
          <SectionLabel label="command" />
          <pre className={codeCls}>{execution.command}</pre>
        </div>
      )}

      {execution.stdout && (
        <div className="space-y-1">
          <SectionLabel label="stdout" />
          <pre className={codeCls}>{execution.stdout}</pre>
        </div>
      )}

      {execution.stderr && (
        <div className="space-y-1">
          <SectionLabel label="stderr" />
          <pre className={`${codeCls} !text-red-600 dark:!text-red-400 !bg-red-50 dark:!bg-red-950/30`}>{execution.stderr}</pre>
        </div>
      )}
    </div>
  )
}
