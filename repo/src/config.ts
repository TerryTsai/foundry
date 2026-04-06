export const config = {
  port: parseInt(process.env.REPO_PORT ?? '3003', 10),
  repoBase: process.env.REPO_BASE ?? '/repos',
}
