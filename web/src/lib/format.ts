// Shared formatters for resource usage display

// Format an actor identifier (e.g. 'founder', 'system', an agent name)
// for display — capitalizes the first letter so roles read as proper
// nouns in the UI while the underlying identifier stays lowercase.
export function fmtActor(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function fmtDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export function fmtBytes(n: number): string {
  if (n < 1_024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1_024).toFixed(1)} KB`
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${(n / 1_073_741_824).toFixed(2)} GB`
}
