import { tool } from 'ai'
import { z } from 'zod'
import type { Db } from './database.js'
import type { Config } from './config.js'
import * as v from './validate.js'
import domain from './domain.js'

export const makeTools = (db: Db, config: Config, sessionId: string, projectId: string, ticketId: string, agentName: string) => ({
  run_command: tool({
    description: 'Run a shell command in a sandboxed Podman container. Returns stdout, stderr, and exit code.',
    inputSchema: v.tool.runCommand,
    outputSchema: z.object({
      stdout: z.string(), stderr: z.string(), exitCode: z.number(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      const command = args.cwd ? `cd ${args.cwd} && ${args.command}` : args.command
      try {
        const { emitter } = domain.execution.create(db, config)({
          command, session_id: sessionId, network: args.network ?? false,
        })
        const stdout: string[] = []
        const stderr: string[] = []
        return await new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
          emitter.on('stdout', (line: string) => stdout.push(line))
          emitter.on('stderr', (line: string) => stderr.push(line))
          emitter.once('exit', (code: number) => {
            resolve({ stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: code })
          })
        })
      } catch (err) {
        return { stdout: '', stderr: '', exitCode: -1, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),

  create_ticket: tool({
    description: 'Create a child ticket. If block=true, the current ticket is suspended until the child resolves.',
    inputSchema: v.tool.createTicket,
    outputSchema: z.object({
      ticket_id: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (args) => {
      const agents = domain.agent.list(db)({ projectId })
      const agentDef = agents.find(a => a.name === args.agent)
      try {
        const row = domain.ticket.create(db)({
          project_id: projectId, title: args.title, body: args.body,
          priority: 0, agent_id: agentDef?.id, parent_id: ticketId,
          created_by: agentName, block: args.block,
        })
        return { ticket_id: row.id }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  }),
})
