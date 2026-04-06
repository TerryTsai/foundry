export const config = {
  port: parseInt(process.env.SANDBOX_PORT ?? '3004', 10),
  dbPath: process.env.DB_PATH ?? './sandbox.db',
}
