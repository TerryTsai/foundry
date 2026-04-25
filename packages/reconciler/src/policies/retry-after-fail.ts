import * as database from '@foundry/db'
import { type Policy, transition, dispatchSession, parseVerifierIds } from './shared.js'

// Ticket is in waiting, all verifiers in the current round have run,
// and at least one came back fail (or no verdict at all → treated as
// fail). Reset the round and dispatch a new producer so the next
// iteration can address the feedback. Comment ingestion of the verdicts
// happens in the producer's system prompt at the next dispatch.
export const retryAfterFail: Policy = (ctx) => {
  const { db, deps, ticket, agents, slots } = ctx
  if (ticket.status !== 'waiting') return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'

  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'

  const sessions = database.sessionsByTicketRaw(db, ticket.id)
  const producers = sessions.filter(s => s.agent_id === ticket.agent_id)
  const latestProducer = producers[producers.length - 1]
  if (!latestProducer) return 'pass'

  const verifierSessions = sessions.filter(s =>
    s.agent_id !== ticket.agent_id && s.started_at >= latestProducer.started_at,
  )
  if (verifierSessions.length < verifierIds.length) return 'pass'
  if (verifierSessions.some(s => s.status === 'running')) return 'pass'

  const verdicts = verifierSessions
    .map(s => database.verdictBySession(db, s.id))
    .filter((v): v is NonNullable<typeof v> => v != null)

  // All-pass (or empty pass set) is finishOnAllPass's job — nothing for us here.
  if (verdicts.length > 0 && verdicts.every(v => v.pass)) return 'pass'

  // Mark the round failed and try a new producer if a slot is free.
  transition(db, ticket.id, 'waiting', 'waiting', 'reconciler', { reason: 'verdict_fail' })
  if (slots.remaining > 0
   && transition(db, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' })) {
    slots.remaining--
    dispatchSession(db, deps, { ...ticket, status: 'running' }, agent, 'producer')
  }
  return 'acted'
}
