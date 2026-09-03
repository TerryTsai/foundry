import YAML from 'yaml'

import type { Priority, ProjectConfig } from './schema.js'

export function parseProjectConfig(source: string, defaults: { runtime: 'podman' | 'docker'; image: string }): ProjectConfig {
  const value: unknown = YAML.parse(source)
  const data = isRecord(value) ? value : {}
  const harness = data.harness
  const runtime = isRecord(data.runtime) ? data.runtime : {}
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    enabled: data.enabled !== false,
    priority: priority(data.priority),
    harness: typeof harness === 'string'
      ? { type: harness }
      : { type: text(harness, 'type') || 'codex', command: text(harness, 'command') || undefined },
    runtime: {
      type: runtime.type === 'docker' || runtime.type === 'podman' ? runtime.type : defaults.runtime,
      image: typeof runtime.image === 'string' ? runtime.image : defaults.image,
    },
    verify: typeof data.verify === 'string' ? data.verify : undefined,
  }
}

export function renderProjectConfig(config: ProjectConfig): string {
  return YAML.stringify({
    ...(config.name ? { name: config.name } : {}),
    enabled: config.enabled,
    priority: config.priority,
    harness: config.harness.command ? config.harness : config.harness.type,
    runtime: config.runtime,
    ...(config.verify ? { verify: config.verify } : {}),
  })
}

function priority(value: unknown): Priority {
  return value === 'low' || value === 'high' || value === 'urgent' ? value : 'normal'
}

function text(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] as string : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
