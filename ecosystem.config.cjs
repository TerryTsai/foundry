const path = require('path')
const root = __dirname
const tsxImport = `--import ${path.join(root, 'node_modules/tsx/dist/esm/index.cjs')}`
const env = {
  FOUNDRY_ENCRYPTION_KEY: 'b53729804ec2f95d25129b12ab99fdfd2bdf84cd2a97fb5d318ee739816f2cfe',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  TICKET_URL: 'http://localhost:3002',
  SANDBOX_URL: 'http://localhost:3004',
  REPO_URL: 'http://localhost:3003',
  AGENT_URL: 'http://localhost:3005',
  REPO_BASE: '/home/terry/repos',
}

module.exports = {
  apps: [
    {
      name: 'ticket',
      script: path.join(root, 'ticket/src/index.ts'),
      interpreter: 'node',
      interpreter_args: tsxImport,
      cwd: path.join(root, 'ticket'),
      env: { ...env, TICKET_PORT: '3002', DB_PATH: path.join(root, 'run/ticket.db') },
    },
    {
      name: 'project',
      script: path.join(root, 'project/src/index.ts'),
      interpreter: 'node',
      interpreter_args: tsxImport,
      cwd: path.join(root, 'project'),
      env: { ...env, PROJECT_PORT: '3001', DB_PATH: path.join(root, 'run/project.db') },
    },
    {
      name: 'repo',
      script: path.join(root, 'repo/src/index.ts'),
      interpreter: 'node',
      interpreter_args: tsxImport,
      cwd: path.join(root, 'repo'),
      env: { ...env, REPO_PORT: '3003' },
    },
    {
      name: 'sandbox',
      script: path.join(root, 'sandbox/src/index.ts'),
      interpreter: 'node',
      interpreter_args: tsxImport,
      cwd: path.join(root, 'sandbox'),
      env: { ...env, SANDBOX_PORT: '3004', DB_PATH: path.join(root, 'run/sandbox.db') },
    },
    {
      name: 'agent',
      script: path.join(root, 'agent/src/index.ts'),
      interpreter: 'node',
      interpreter_args: tsxImport,
      cwd: path.join(root, 'agent'),
      env: { ...env, AGENT_PORT: '3005', DB_PATH: path.join(root, 'run/agent.db') },
    },
    {
      name: 'web',
      script: path.join(root, 'web-serve.cjs'),
      cwd: root,
      env: {},
    },
  ],
}
