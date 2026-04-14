// AWS CLI pass-through. One generic tool runs any `aws …` command with the
// connection's credentials in env. Covers every AWS service (S3, Lambda,
// DynamoDB, SES, Bedrock, …) without per-service wrapping. Intentionally
// broad for now — scope down to named tools per service when usage patterns
// emerge.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'aws',
  name:        'AWS',
  category:    'infra',
  description: 'Run any AWS CLI command with the connection\'s credentials. One generic tool covers every service.',
  tools: [
    { name: 'awsCli', description: 'Run an AWS CLI command (e.g. `s3 ls`, `ec2 describe-instances`, `ses send-email --raw-message …`).' },
  ],
}

type AwsCtx = ConnCtx

const awsCliArgs = z.object({
  command: z.string().describe('Args to `aws`, without the leading `aws`. Example: `s3 ls s3://my-bucket`.'),
  region:  z.string().optional().describe('Overrides the connection default region.'),
  output:  z.enum(['json', 'text', 'yaml', 'table']).optional().describe('Output format. Default json.'),
})

async function handleAwsCli(ctx: AwsCtx, args: z.infer<typeof awsCliArgs>) {
  const region = args.region?.trim()
              ?? (typeof ctx.connConfig.region === 'string' ? ctx.connConfig.region.trim() : '')
              ?? ''
  const output = args.output ?? 'json'
  // The command comes through verbatim — the agent is responsible for
  // valid quoting. AWS creds ride in env, never in the logged command.
  const cmd = `aws --output ${output}${region ? ` --region ${region}` : ''} ${args.command}`
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    cmd, 'awsCli', args, {
      network: true,
      mount:   'rw',
      env: {
        AWS_ACCESS_KEY_ID:     ctx.secrets.access_key_id     ?? '',
        AWS_SECRET_ACCESS_KEY: ctx.secrets.secret_access_key ?? '',
        ...(region ? { AWS_DEFAULT_REGION: region } : {}),
      },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false, error: r.stderr || r.stdout }
  try { return { ok: true, result: JSON.parse(r.stdout) } } catch { return { ok: true, stdout: r.stdout } }
}

const DESC = {
  awsCli: 'Run an AWS CLI command against this connection\'s account. `command` is the args after `aws` (e.g. `s3 ls s3://bucket`, `lambda invoke --function-name foo /tmp/out.json`). Use --region to override the connection default. JSON output is parsed automatically.',
}

export function buildSdk(ctx: AwsCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): AwsCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('awsCli', DESC.awsCli, awsCliArgs.shape, async (a, x) => asText(await handleAwsCli(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `aws:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: AwsCtx) {
  return {
    [`aws-${ctx.connectionName}-awsCli`]: tool({
      description: DESC.awsCli, inputSchema: awsCliArgs,
      execute: (a: z.infer<typeof awsCliArgs>) => handleAwsCli(ctx, a),
    }),
  }
}
