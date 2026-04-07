import type { Database } from './database.js'
import type { Config } from './config.js'
import * as v from './validate.js'
import domain from './domain.js'
import type { z } from 'zod'

export interface Tool {
  name:        string
  description: string
  params:      z.ZodTypeAny
  execute:     (args: unknown) => Promise<string>
}

export const makeRunCommandTool = (db: Database, config: Config, sessionId: string): Tool => ({
  name: 'run_command',
  description: 'Run a shell command in a sandboxed Podman container. Returns stdout, stderr, and exit code.',
  params: v.tool.runCommand,
  execute: async (rawArgs: unknown): Promise<string> => {
    const args = v.tool.runCommand.parse(rawArgs)
    const command = args.cwd ? `cd ${args.cwd} && ${args.command}` : args.command

    try {
      const { emitter } = domain.sandbox.create(db, config)({
        command,
        workspace: `/tmp/foundry-work-${sessionId}`,
        session_id: sessionId,
        network: args.network ?? false,
      })

      const stdout: string[] = []
      const stderr: string[] = []

      return await new Promise<string>(resolve => {
        emitter.on('stdout', (line: string) => stdout.push(line))
        emitter.on('stderr', (line: string) => stderr.push(line))
        emitter.once('exit', (code: number) => {
          resolve(JSON.stringify({ stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: code }))
        })
      })
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
    }
  },
})

export const makeCreateTicketTool = (db: Database, projectId: string, currentTicketId: string, agentName: string): Tool => ({
  name: 'create_ticket',
  description: 'Create a child ticket. If block=true, the current ticket is suspended until the child resolves.',
  params: v.tool.createTicket,
  execute: async (rawArgs: unknown): Promise<string> => {
    const args = v.tool.createTicket.parse(rawArgs)

    try {
      const row = domain.ticket.create(db)({
        project_id: projectId, title: args.title, body: args.body,
        agent: args.agent, parent_id: currentTicketId,
        created_by: agentName, block: args.block,
      })
      return JSON.stringify({ ticket_id: row.id })
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
    }
  },
})
