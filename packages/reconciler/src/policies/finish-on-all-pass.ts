import * as database from '@foundry/db'
import { type Policy, transition, parseVerifierIds } from './shared.js'

// Ticket is in waiting, every configured verifier has run for the
// current round, and every verdict came back pass. Settle as finished
// and record which verifiers vouched for it.
export const finishOnAllPass: Policy = (ctx) => {
  const { db, ticket, agents } = ctx
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

  // Skip if any verifier still running, or any not dispatched yet.
  if (verifierSessions.length < verifierIds.length) return 'pass'
  if (verifierSessions.some(s => s.status === 'running')) return 'pass'

  const verdicts = verifierSessions
    .map(s => database.verdictBySession(db, s.id))
    .filter((v): v is NonNullable<typeof v> => v != null)

  // No verdicts at all means everyone was cancelled / crashed before
  // recording one — treat as not-pass and let retry-after-fail decide.
  if (verdicts.length === 0)        return 'pass'
  if (!verdicts.every(v => v.pass)) return 'pass'

  const verifierNames = verdicts.map(v =>
    agents.find(a => a.id === v.agent_id)?.name ?? v.agent_id)
  return transition(db, ticket.id, 'waiting', 'finished', 'reconciler', { verified_by: verifierNames })
    ? 'acted' : 'pass'
}
