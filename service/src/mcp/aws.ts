// AWS connection tools. Typed per-operation instead of a generic CLI
// pass-through. Each tool constructs a fixed AWS CLI command from typed
// args. Credentials ride in env, never in the logged command.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'aws',
  name:        'AWS',
  category:    'infra',
  description: 'AWS S3 object storage: list, upload, download, delete.',
  tools: [
    { name: 's3List',     description: 'List S3 buckets or objects within a bucket.' },
    { name: 's3Upload',   description: 'Upload a workspace file to S3.' },
    { name: 's3Download', description: 'Download an S3 object to the workspace.' },
    { name: 's3Delete',   description: 'Delete an S3 object.' },
  ],
}

type AwsCtx = ConnCtx

// ── Schemas ──

const s3ListArgs = z.object({
  bucket: z.string().optional().describe('Bucket name. Omit to list all buckets.'),
  prefix: z.string().optional().describe('Object prefix filter.'),
  region: z.string().optional().describe('Override region.'),
})
const s3UploadArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  key:    z.string().describe('Object key (path in bucket).'),
  file:   z.string().describe('Workspace file path to upload (relative to /work).'),
  region: z.string().optional(),
})
const s3DownloadArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  key:    z.string().describe('Object key.'),
  file:   z.string().describe('Workspace path to save to (relative to /work).'),
  region: z.string().optional(),
})
const s3DeleteArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  key:    z.string().describe('Object key to delete.'),
  region: z.string().optional(),
})

// ── Runner ──

async function runAws(ctx: AwsCtx, toolName: string, args: unknown, command: string) {
  const region = (args as { region?: string }).region?.trim()
    ?? (typeof ctx.connConfig.region === 'string' ? ctx.connConfig.region.trim() : '')
  const regionFlag = region ? ` --region ${JSON.stringify(region)}` : ''
  const r = await runCommand(ctx.db, ctx.config, ctx.sessionId, ctx.workspace,
    `aws --output json${regionFlag} ${command}`, toolName, args, {
      network: true, mount: 'rw',
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

// ── Handlers ──

async function handleS3List(ctx: AwsCtx, args: z.infer<typeof s3ListArgs>) {
  if (!args.bucket) return runAws(ctx, 's3List', args, 's3api list-buckets')
  const prefix = args.prefix ? ` --prefix ${JSON.stringify(args.prefix)}` : ''
  return runAws(ctx, 's3List', args, `s3api list-objects-v2 --bucket ${JSON.stringify(args.bucket)}${prefix}`)
}
async function handleS3Upload(ctx: AwsCtx, args: z.infer<typeof s3UploadArgs>) {
  return runAws(ctx, 's3Upload', args, `s3 cp ${JSON.stringify('/work/' + args.file)} s3://${args.bucket}/${args.key}`)
}
async function handleS3Download(ctx: AwsCtx, args: z.infer<typeof s3DownloadArgs>) {
  return runAws(ctx, 's3Download', args, `s3 cp s3://${args.bucket}/${args.key} ${JSON.stringify('/work/' + args.file)}`)
}
async function handleS3Delete(ctx: AwsCtx, args: z.infer<typeof s3DeleteArgs>) {
  return runAws(ctx, 's3Delete', args, `s3 rm s3://${args.bucket}/${args.key}`)
}

const DESC = {
  s3List:     'List S3 buckets on the account, or list objects in a specific bucket (with optional prefix filter).',
  s3Upload:   'Upload a workspace file to S3. `file` is relative to /work.',
  s3Download: 'Download an S3 object to the workspace. `file` is relative to /work.',
  s3Delete:   'Delete an object from an S3 bucket.',
}

export function buildSdk(ctx: AwsCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): AwsCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('s3List',     DESC.s3List,     s3ListArgs.shape,     async (a, x) => asText(await handleS3List(tu(x), a))),
    sdkTool('s3Upload',   DESC.s3Upload,   s3UploadArgs.shape,   async (a, x) => asText(await handleS3Upload(tu(x), a))),
    sdkTool('s3Download', DESC.s3Download, s3DownloadArgs.shape, async (a, x) => asText(await handleS3Download(tu(x), a))),
    sdkTool('s3Delete',   DESC.s3Delete,   s3DeleteArgs.shape,   async (a, x) => asText(await handleS3Delete(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `aws:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

export function buildAi(ctx: AwsCtx) {
  const prefix = `aws-${ctx.connectionName}`
  return {
    [`${prefix}-s3List`]: tool({
      description: DESC.s3List, inputSchema: s3ListArgs,
      execute: (a: z.infer<typeof s3ListArgs>) => handleS3List(ctx, a),
    }),
    [`${prefix}-s3Upload`]: tool({
      description: DESC.s3Upload, inputSchema: s3UploadArgs,
      execute: (a: z.infer<typeof s3UploadArgs>) => handleS3Upload(ctx, a),
    }),
    [`${prefix}-s3Download`]: tool({
      description: DESC.s3Download, inputSchema: s3DownloadArgs,
      execute: (a: z.infer<typeof s3DownloadArgs>) => handleS3Download(ctx, a),
    }),
    [`${prefix}-s3Delete`]: tool({
      description: DESC.s3Delete, inputSchema: s3DeleteArgs,
      execute: (a: z.infer<typeof s3DeleteArgs>) => handleS3Delete(ctx, a),
    }),
  }
}
