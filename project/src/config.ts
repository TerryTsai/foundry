export const config = {
  port: parseInt(process.env.PROJECT_PORT ?? '3001', 10),
  dbPath: process.env.DB_PATH ?? './project.db',
  ticketUrl: process.env.TICKET_URL ?? 'http://localhost:3002',
  agentUrl: process.env.AGENT_URL ?? 'http://localhost:3005',
}
