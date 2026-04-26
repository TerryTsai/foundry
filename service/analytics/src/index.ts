// Public surface for @foundry/analytics. Aggregate queries over
// sessions / tickets / executions; per-entity usage rollups.

export { createAnalyticsService } from './service.js'
export type { AnalyticsClient } from './client.js'
export type { UsageRollup, AnalyticsArgs, AnalyticsResult, AnalyticsError } from './schema.js'
export * as validate from './validate.js'

// Raw exports for routes that still call analytics directly. Will move
// behind bind(client, ctx) once route handlers migrate to the typed
// AnalyticsClient.
export { analytics, tagsList } from './aggregate.js'
export { ticketUsage, agentUsage, sessionUsage } from './usage.js'
