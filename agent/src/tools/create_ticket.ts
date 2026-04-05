import { z } from 'zod'

export interface CreateTicketDeps {
  ticketUrl: string
  projectId: string
  currentTicketId: string
  agentName: string
}

const params = z.object({
  title: z.string().describe('Ticket title'),
  body: z.string().describe('Ticket body in markdown'),
  agent: z.string().describe('Agent name that should handle this ticket'),
  block: z.boolean().describe('If true, suspend the current ticket until this child ticket is done'),
})

export function makeCreateTicketTool(deps: CreateTicketDeps) {
  return {
    name: 'create_ticket' as const,
    description:
      'Create a child ticket. If block=true, the current ticket is suspended until the child resolves.',
    params,
    async execute(args: z.infer<typeof params>): Promise<string> {
      const res = await fetch(`${deps.ticketUrl}/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: deps.projectId,
          title: args.title,
          body: args.body,
          agent: args.agent,
          parent_id: deps.currentTicketId,
          created_by: deps.agentName,
          block: args.block,
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        return JSON.stringify({ error: `failed to create ticket: ${res.status} ${err}` })
      }

      const ticket = await res.json() as { id: string }
      return JSON.stringify({ ticket_id: ticket.id })
    },
  }
}

export type CreateTicketTool = ReturnType<typeof makeCreateTicketTool>
