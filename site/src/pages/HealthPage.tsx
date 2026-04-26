import { useEffect, useState } from 'react'

interface HealthDetail {
  ok: boolean
  uptime: number
  version: string
}

export function HealthPage() {
  const [data, setData] = useState<HealthDetail | null>(null)

  useEffect(() => {
    fetch('/health/detail')
      .then(r => r.json())
      .then(setData)
  }, [])

  if (!data) return <div className="p-4 text-zinc-400 dark:text-zinc-500">Loading…</div>

  return (
    <div className="p-4 text-sm text-zinc-800 dark:text-zinc-200 space-y-1">
      <div>version: {data.version}</div>
      <div>uptime: {Math.floor(data.uptime)}s</div>
    </div>
  )
}
