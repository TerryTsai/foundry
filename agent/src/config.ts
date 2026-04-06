export const config = {
  port: parseInt(process.env.AGENT_PORT ?? '3005', 10),
  dbPath: process.env.DB_PATH ?? './agent.db',
  ticketUrl: process.env.TICKET_URL ?? 'http://localhost:3002',
  sandboxUrl: process.env.SANDBOX_URL ?? 'http://localhost:3004',
  repoUrl: process.env.REPO_URL ?? 'http://localhost:3003',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
}
