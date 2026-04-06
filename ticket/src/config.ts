export const config = {
  port: parseInt(process.env.TICKET_PORT ?? '3002', 10),
  dbPath: process.env.DB_PATH ?? './ticket.db',
}
