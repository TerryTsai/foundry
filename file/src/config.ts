export const config = {
  port: parseInt(process.env.FILE_PORT ?? '3003', 10),
  basePath: process.env.FILE_BASE ?? '/home/terry/repos',
}
