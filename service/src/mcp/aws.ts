// AWS connection tools — typed per-operation, covering S3, Lambda, API Gateway, IAM, and CloudFront.

import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import { tool } from 'ai'
import { z } from 'zod'

import { asText, runCommand, toolUseId, type ConnCtx } from './shared.js'
import { filterTools, type McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'aws',
  name:        'AWS',
  category:    'infra',
  description: 'AWS tools for deploying sites: S3, Lambda, API Gateway, IAM, CloudFront.',
  tools: [
    // S3
    { name: 's3CreateBucket',       description: 'Create an S3 bucket.' },
    { name: 's3DeleteBucket',       description: 'Delete an empty S3 bucket.' },
    { name: 's3List',               description: 'List S3 buckets or objects within a bucket.' },
    { name: 's3Upload',             description: 'Upload a workspace file to S3.' },
    { name: 's3Download',           description: 'Download an S3 object to the workspace.' },
    { name: 's3Delete',             description: 'Delete an S3 object.' },
    { name: 's3EmptyBucket',        description: 'Delete all objects in an S3 bucket (required before bucket deletion).' },
    { name: 's3SyncUpload',         description: 'Sync a workspace directory to an S3 bucket prefix.' },
    { name: 's3SetWebsite',         description: 'Enable static website hosting on an S3 bucket.' },
    { name: 's3DisableBlockPublic', description: 'Disable Block Public Access on an S3 bucket (required before setting a public policy).' },
    { name: 's3SetPublicRead',      description: 'Set a public-read bucket policy for website hosting.' },
    // Account
    { name: 'stsGetCallerIdentity', description: 'Get the AWS account ID and caller ARN.' },
    // Lambda
    { name: 'lambdaList',           description: 'List Lambda functions.' },
    { name: 'lambdaCreate',         description: 'Create a Lambda function from a zip in S3 or workspace.' },
    { name: 'lambdaUpdate',         description: 'Update a Lambda function\'s code from a zip.' },
    { name: 'lambdaDelete',         description: 'Delete a Lambda function.' },
    { name: 'lambdaInvoke',         description: 'Invoke a Lambda function.' },
    { name: 'lambdaSetEnv',         description: 'Set environment variables on a Lambda function.' },
    // API Gateway
    { name: 'apiGatewayCreate',     description: 'Create an HTTP API Gateway.' },
    { name: 'apiGatewayList',       description: 'List API Gateways.' },
    { name: 'apiGatewayDelete',     description: 'Delete an API Gateway.' },
    { name: 'apiGatewayAddRoute',   description: 'Add a route + Lambda integration to an API Gateway.' },
    { name: 'apiGatewayDeploy',     description: 'Deploy an API Gateway stage.' },
    // Lambda permissions
    { name: 'lambdaAddPermission',  description: 'Grant another service (e.g. API Gateway) permission to invoke a Lambda.' },
    // IAM
    { name: 'iamCreateRole',        description: 'Create an IAM role with a trust policy.' },
    { name: 'iamAttachPolicy',      description: 'Attach a managed policy to a role.' },
    { name: 'iamListRolePolicies',  description: 'List managed policies attached to a role.' },
    { name: 'iamDetachPolicy',      description: 'Detach a managed policy from a role.' },
    { name: 'iamDeleteRole',        description: 'Delete an IAM role (detach policies first).' },
    // CloudFront
    { name: 'cloudfrontCreate',     description: 'Create a CloudFront distribution for an S3 origin.' },
    { name: 'cloudfrontList',       description: 'List CloudFront distributions.' },
    { name: 'cloudfrontDisable',    description: 'Disable a CloudFront distribution (required before deletion).' },
    { name: 'cloudfrontDelete',     description: 'Delete a disabled CloudFront distribution.' },
    { name: 'cloudfrontInvalidate', description: 'Invalidate CloudFront cache paths.' },
  ],
}

type AwsCtx = ConnCtx

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

// ── Schemas ──

const bucketNamePattern = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Bucket name: 3-63 chars, lowercase letters/numbers/hyphens/dots, no consecutive dots')
const functionNamePattern = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Function name: 1-64 chars, alphanumeric/hyphens/underscores')

const s3CreateBucketArgs = z.object({
  bucket: bucketNamePattern.describe('Bucket name (lowercase, 3-63 chars).'),
  region: z.string().optional(),
})
const s3DeleteBucketArgs = z.object({
  bucket: z.string().describe('Bucket name. Must be empty.'),
  region: z.string().optional(),
})
const s3ListArgs = z.object({
  bucket: z.string().optional().describe('Bucket name. Omit to list all buckets.'),
  prefix: z.string().optional().describe('Object prefix filter.'),
  region: z.string().optional(),
})
const s3UploadArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  key:    z.string().describe('Object key.'),
  file:   z.string().describe('Workspace file (relative to /work).'),
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
  key:    z.string().describe('Object key.'),
  region: z.string().optional(),
})
const s3SyncUploadArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  dir:    z.string().describe('Workspace directory to sync (relative to /work).'),
  prefix: z.string().optional().describe('S3 key prefix. Default: bucket root.'),
  delete: z.boolean().optional().describe('Delete remote files not in local dir. Default false.'),
  region: z.string().optional(),
})
const s3SetWebsiteArgs = z.object({
  bucket:   z.string().describe('Bucket name.'),
  index:    z.string().default('index.html').describe('Index document.'),
  error:    z.string().optional().describe('Error document.'),
  region:   z.string().optional(),
})
const s3DisableBlockPublicArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  region: z.string().optional(),
})
const s3SetPublicReadArgs = z.object({
  bucket: z.string().describe('Bucket name.'),
  region: z.string().optional(),
})
const s3EmptyBucketArgs = z.object({
  bucket: z.string().describe('Bucket name to empty.'),
  region: z.string().optional(),
})
const stsGetCallerIdentityArgs = z.object({ region: z.string().optional() })

const lambdaListArgs = z.object({ region: z.string().optional() })
const lambdaCreateArgs = z.object({
  name:    functionNamePattern.describe('Function name (alphanumeric/hyphens/underscores, max 64 chars).'),
  runtime: z.string().describe('Runtime (e.g. nodejs20.x, python3.12).'),
  handler: z.string().describe('Handler (e.g. index.handler).'),
  role:    z.string().describe('IAM role ARN for execution.'),
  zip:     z.string().describe('Path to zip file (relative to /work) or S3 URI (s3://bucket/key).'),
  region:  z.string().optional(),
})
const lambdaUpdateArgs = z.object({
  name:   z.string().describe('Function name.'),
  zip:    z.string().describe('Path to zip file (relative to /work) or S3 URI.'),
  region: z.string().optional(),
})
const lambdaDeleteArgs = z.object({
  name:   z.string().describe('Function name.'),
  region: z.string().optional(),
})
const lambdaInvokeArgs = z.object({
  name:    z.string().describe('Function name.'),
  payload: z.record(z.string(), z.unknown()).optional().describe('JSON payload object. Stringified automatically.'),
  region:  z.string().optional(),
})
const lambdaAddPermissionArgs = z.object({
  function_name: z.string().describe('Lambda function name or ARN.'),
  statement_id:  z.string().default('apigateway-invoke').describe('Unique statement id.'),
  principal:     z.string().default('apigateway.amazonaws.com').describe('Service principal.'),
  api_id:        z.string().optional().describe('API Gateway id. If provided, source ARN is constructed automatically.'),
  region:        z.string().optional(),
})
const lambdaSetEnvArgs = z.object({
  name:      z.string().describe('Function name.'),
  variables: z.record(z.string(), z.string()).describe('Key-value map of environment variables.'),
  region:    z.string().optional(),
})

const apiGatewayCreateArgs = z.object({
  name:        z.string().describe('API name.'),
  description: z.string().optional().describe('API description.'),
  region:      z.string().optional(),
})
const apiGatewayListArgs = z.object({ region: z.string().optional() })
const apiGatewayDeleteArgs = z.object({
  api_id: z.string().describe('API Gateway id.'),
  region: z.string().optional(),
})
const apiGatewayAddRouteArgs = z.object({
  api_id:     z.string().describe('API Gateway id.'),
  route:      z.string().regex(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|ANY)\s+\//, 'Route must be "METHOD /path" (e.g. "GET /items", "ANY /{proxy+}")').describe('Route key (e.g. "GET /items", "ANY /{proxy+}").'),
  lambda_arn: z.string().describe('Lambda function ARN to integrate.'),
  region:     z.string().optional(),
})
const apiGatewayDeployArgs = z.object({
  api_id:     z.string().describe('API Gateway id.'),
  stage_name: z.string().default('$default').describe('Stage name. Default "$default" (auto-deploy).'),
  region:     z.string().optional(),
})

const iamCreateRoleArgs = z.object({
  name:    z.string().describe('Role name.'),
  service: z.string().describe('AWS service principal that can assume this role (e.g. "lambda.amazonaws.com", "apigateway.amazonaws.com").'),
  region:  z.string().optional(),
})
const iamAttachPolicyArgs = z.object({
  role_name:  z.string().describe('Role name.'),
  policy_arn: z.string().describe('Managed policy ARN to attach.'),
  region:     z.string().optional(),
})
const iamListRolePoliciesArgs = z.object({
  role_name: z.string().describe('Role name.'),
  region:    z.string().optional(),
})
const iamDetachPolicyArgs = z.object({
  role_name:  z.string().describe('Role name.'),
  policy_arn: z.string().describe('Managed policy ARN to detach.'),
  region:     z.string().optional(),
})
const iamDeleteRoleArgs = z.object({
  name:   z.string().describe('Role name.'),
  region: z.string().optional(),
})

const cloudfrontCreateArgs = z.object({
  bucket:      z.string().describe('S3 bucket name. Origin domain is computed automatically.'),
  bucket_region: z.string().optional().describe('Bucket region (default: connection region or us-east-1). Used to construct the S3 endpoint.'),
  comment:     z.string().optional().describe('Distribution comment.'),
  default_root: z.string().default('index.html').describe('Default root object.'),
  region:      z.string().optional(),
})
const cloudfrontListArgs = z.object({ region: z.string().optional() })
const cloudfrontDisableArgs = z.object({
  distribution_id: z.string().describe('Distribution id.'),
  region:          z.string().optional(),
})
const cloudfrontDeleteArgs = z.object({
  distribution_id: z.string().describe('Distribution id. Must be disabled first.'),
  region:          z.string().optional(),
})
const cloudfrontInvalidateArgs = z.object({
  distribution_id: z.string().describe('Distribution id.'),
  paths:           z.array(z.string()).describe('Paths to invalidate (e.g. ["/*"]).'),
  region:          z.string().optional(),
})

// ── Handlers ──

async function handleS3CreateBucket(ctx: AwsCtx, args: z.infer<typeof s3CreateBucketArgs>) {
  const region = args.region?.trim() ?? (typeof ctx.connConfig.region === 'string' ? ctx.connConfig.region.trim() : 'us-east-1')
  const locConstraint = region === 'us-east-1' ? '' : ` --create-bucket-configuration LocationConstraint=${JSON.stringify(region)}`
  return runAws(ctx, 's3CreateBucket', args, `s3api create-bucket --bucket ${JSON.stringify(args.bucket)}${locConstraint}`)
}
async function handleS3DeleteBucket(ctx: AwsCtx, args: z.infer<typeof s3DeleteBucketArgs>) {
  return runAws(ctx, 's3DeleteBucket', args, `s3api delete-bucket --bucket ${JSON.stringify(args.bucket)}`)
}
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
async function handleS3SyncUpload(ctx: AwsCtx, args: z.infer<typeof s3SyncUploadArgs>) {
  const dest = args.prefix ? `s3://${args.bucket}/${args.prefix}` : `s3://${args.bucket}`
  const del = args.delete ? ' --delete' : ''
  return runAws(ctx, 's3SyncUpload', args, `s3 sync ${JSON.stringify('/work/' + args.dir)} ${dest}${del}`)
}
async function handleS3SetWebsite(ctx: AwsCtx, args: z.infer<typeof s3SetWebsiteArgs>) {
  const errorDoc = args.error ? `,ErrorDocument={Key=${JSON.stringify(args.error)}}` : ''
  return runAws(ctx, 's3SetWebsite', args,
    `s3api put-bucket-website --bucket ${JSON.stringify(args.bucket)} --website-configuration IndexDocument={Suffix=${JSON.stringify(args.index)}}${errorDoc}`)
}
async function handleS3EmptyBucket(ctx: AwsCtx, args: z.infer<typeof s3EmptyBucketArgs>) {
  return runAws(ctx, 's3EmptyBucket', args, `s3 rm s3://${args.bucket} --recursive`)
}
async function handleS3DisableBlockPublic(ctx: AwsCtx, args: z.infer<typeof s3DisableBlockPublicArgs>) {
  return runAws(ctx, 's3DisableBlockPublic', args,
    `s3api put-public-access-block --bucket ${JSON.stringify(args.bucket)} --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false`)
}
async function handleS3SetPublicRead(ctx: AwsCtx, args: z.infer<typeof s3SetPublicReadArgs>) {
  const policy = JSON.stringify(JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${args.bucket}/*` }],
  }))
  return runAws(ctx, 's3SetPublicRead', args, `s3api put-bucket-policy --bucket ${JSON.stringify(args.bucket)} --policy ${policy}`)
}
async function handleStsGetCallerIdentity(ctx: AwsCtx, args: z.infer<typeof stsGetCallerIdentityArgs>) {
  return runAws(ctx, 'stsGetCallerIdentity', args, 'sts get-caller-identity')
}

async function handleLambdaList(ctx: AwsCtx, args: z.infer<typeof lambdaListArgs>) {
  return runAws(ctx, 'lambdaList', args, 'lambda list-functions')
}
async function handleLambdaCreate(ctx: AwsCtx, args: z.infer<typeof lambdaCreateArgs>) {
  const code = args.zip.startsWith('s3://')
    ? (() => { const [b, ...k] = args.zip.slice(5).split('/'); return `S3Bucket=${b},S3Key=${k.join('/')}`; })()
    : `ZipFile=fileb:///work/${args.zip}`
  // IAM role propagation takes ~10s. Retry once on InvalidParameterValueException.
  const cmd = `lambda create-function --function-name ${JSON.stringify(args.name)} --runtime ${args.runtime} --handler ${args.handler} --role ${JSON.stringify(args.role)} --code ${code}`
  const r: any = await runAws(ctx, 'lambdaCreate', args, cmd)
  if (!r.ok && r.error?.includes('InvalidParameterValueException') && r.error?.includes('role')) {
    await new Promise(resolve => setTimeout(resolve, 12000))
    return runAws(ctx, 'lambdaCreate', args, cmd)
  }
  return r
}
async function handleLambdaUpdate(ctx: AwsCtx, args: z.infer<typeof lambdaUpdateArgs>) {
  const code = args.zip.startsWith('s3://')
    ? (() => { const [b, ...k] = args.zip.slice(5).split('/'); return `--s3-bucket ${b} --s3-key ${k.join('/')}`; })()
    : `--zip-file fileb:///work/${args.zip}`
  return runAws(ctx, 'lambdaUpdate', args, `lambda update-function-code --function-name ${JSON.stringify(args.name)} ${code}`)
}
async function handleLambdaDelete(ctx: AwsCtx, args: z.infer<typeof lambdaDeleteArgs>) {
  return runAws(ctx, 'lambdaDelete', args, `lambda delete-function --function-name ${JSON.stringify(args.name)}`)
}
async function handleLambdaInvoke(ctx: AwsCtx, args: z.infer<typeof lambdaInvokeArgs>) {
  const payload = args.payload ? ` --payload ${JSON.stringify(JSON.stringify(args.payload))}` : ''
  return runAws(ctx, 'lambdaInvoke', args, `lambda invoke --function-name ${JSON.stringify(args.name)}${payload} /tmp/lambda-out.json && cat /tmp/lambda-out.json`)
}
async function handleLambdaAddPermission(ctx: AwsCtx, args: z.infer<typeof lambdaAddPermissionArgs>) {
  let srcArn = ''
  if (args.api_id) {
    const region = args.region?.trim()
      ?? (typeof ctx.connConfig.region === 'string' ? ctx.connConfig.region.trim() : null)
      ?? 'us-east-1'
    const identity: any = await runAws(ctx, 'lambdaAddPermission', args, 'sts get-caller-identity')
    const account = identity?.result?.Account
    if (account) srcArn = ` --source-arn arn:aws:execute-api:${region}:${account}:${args.api_id}/*`
  }
  return runAws(ctx, 'lambdaAddPermission', args,
    `lambda add-permission --function-name ${JSON.stringify(args.function_name)} --statement-id ${JSON.stringify(args.statement_id)} --action lambda:InvokeFunction --principal ${args.principal}${srcArn}`)
}
async function handleLambdaSetEnv(ctx: AwsCtx, args: z.infer<typeof lambdaSetEnvArgs>) {
  const vars = JSON.stringify(JSON.stringify({ Variables: args.variables }))
  return runAws(ctx, 'lambdaSetEnv', args, `lambda update-function-configuration --function-name ${JSON.stringify(args.name)} --environment ${vars}`)
}

async function handleApiGatewayCreate(ctx: AwsCtx, args: z.infer<typeof apiGatewayCreateArgs>) {
  const desc = args.description ? ` --description ${JSON.stringify(args.description)}` : ''
  return runAws(ctx, 'apiGatewayCreate', args, `apigatewayv2 create-api --name ${JSON.stringify(args.name)} --protocol-type HTTP${desc}`)
}
async function handleApiGatewayList(ctx: AwsCtx, args: z.infer<typeof apiGatewayListArgs>) {
  return runAws(ctx, 'apiGatewayList', args, 'apigatewayv2 get-apis')
}
async function handleApiGatewayDelete(ctx: AwsCtx, args: z.infer<typeof apiGatewayDeleteArgs>) {
  return runAws(ctx, 'apiGatewayDelete', args, `apigatewayv2 delete-api --api-id ${args.api_id}`)
}
async function handleApiGatewayAddRoute(ctx: AwsCtx, args: z.infer<typeof apiGatewayAddRouteArgs>) {
  const integCmd = `apigatewayv2 create-integration --api-id ${args.api_id} --integration-type AWS_PROXY --integration-uri ${JSON.stringify(args.lambda_arn)} --payload-format-version 2.0`
  const routeCmd = (integId: string) => `apigatewayv2 create-route --api-id ${args.api_id} --route-key ${JSON.stringify(args.route)} --target integrations/${integId}`
  const r: any = await runAws(ctx, 'apiGatewayAddRoute', args, integCmd)
  if (!r.ok) return r
  const integId = r.result?.IntegrationId
  if (!integId) return { ok: false, error: 'integration created but no IntegrationId returned' }
  return runAws(ctx, 'apiGatewayAddRoute', args, routeCmd(integId))
}
async function handleApiGatewayDeploy(ctx: AwsCtx, args: z.infer<typeof apiGatewayDeployArgs>) {
  return runAws(ctx, 'apiGatewayDeploy', args, `apigatewayv2 create-stage --api-id ${args.api_id} --stage-name ${JSON.stringify(args.stage_name)} --auto-deploy`)
}

async function handleIamCreateRole(ctx: AwsCtx, args: z.infer<typeof iamCreateRoleArgs>) {
  const trustPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: args.service }, Action: 'sts:AssumeRole' }],
  })
  return runAws(ctx, 'iamCreateRole', args,
    `iam create-role --role-name ${JSON.stringify(args.name)} --assume-role-policy-document ${JSON.stringify(trustPolicy)}`)
}
async function handleIamAttachPolicy(ctx: AwsCtx, args: z.infer<typeof iamAttachPolicyArgs>) {
  return runAws(ctx, 'iamAttachPolicy', args,
    `iam attach-role-policy --role-name ${JSON.stringify(args.role_name)} --policy-arn ${JSON.stringify(args.policy_arn)}`)
}
async function handleIamListRolePolicies(ctx: AwsCtx, args: z.infer<typeof iamListRolePoliciesArgs>) {
  return runAws(ctx, 'iamListRolePolicies', args,
    `iam list-attached-role-policies --role-name ${JSON.stringify(args.role_name)}`)
}
async function handleIamDetachPolicy(ctx: AwsCtx, args: z.infer<typeof iamDetachPolicyArgs>) {
  return runAws(ctx, 'iamDetachPolicy', args,
    `iam detach-role-policy --role-name ${JSON.stringify(args.role_name)} --policy-arn ${JSON.stringify(args.policy_arn)}`)
}
async function handleIamDeleteRole(ctx: AwsCtx, args: z.infer<typeof iamDeleteRoleArgs>) {
  return runAws(ctx, 'iamDeleteRole', args, `iam delete-role --role-name ${JSON.stringify(args.name)}`)
}

async function handleCloudfrontCreate(ctx: AwsCtx, args: z.infer<typeof cloudfrontCreateArgs>) {
  const bucketRegion = args.bucket_region?.trim()
    ?? (typeof ctx.connConfig.region === 'string' ? ctx.connConfig.region.trim() : null)
    ?? 'us-east-1'
  const origin = `${args.bucket}.s3.${bucketRegion}.amazonaws.com`
  const config = JSON.stringify(JSON.stringify({
    CallerReference: Date.now().toString(),
    Comment: args.comment ?? '',
    DefaultRootObject: args.default_root,
    Origins: { Quantity: 1, Items: [{ Id: 's3', DomainName: origin, S3OriginConfig: { OriginAccessIdentity: '' } }] },
    DefaultCacheBehavior: {
      TargetOriginId: 's3', ViewerProtocolPolicy: 'redirect-to-https',
      ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
      MinTTL: 0,
    },
    Enabled: true,
  }))
  return runAws(ctx, 'cloudfrontCreate', args, `cloudfront create-distribution --distribution-config ${config}`)
}
async function handleCloudfrontList(ctx: AwsCtx, args: z.infer<typeof cloudfrontListArgs>) {
  return runAws(ctx, 'cloudfrontList', args, 'cloudfront list-distributions')
}
async function handleCloudfrontDisable(ctx: AwsCtx, args: z.infer<typeof cloudfrontDisableArgs>) {
  // Get current config, set Enabled=false, update. CloudFront requires the full config + ETag.
  const getCmd = `cloudfront get-distribution-config --id ${args.distribution_id}`
  const r: any = await runAws(ctx, 'cloudfrontDisable', args, getCmd)
  if (!r.ok) return r
  const etag = r.result?.ETag
  const config = r.result?.DistributionConfig
  if (!etag || !config) return { ok: false, error: 'could not read distribution config' }
  config.Enabled = false
  const updConfig = JSON.stringify(JSON.stringify(config))
  return runAws(ctx, 'cloudfrontDisable', args,
    `cloudfront update-distribution --id ${args.distribution_id} --if-match ${etag} --distribution-config ${updConfig}`)
}
async function handleCloudfrontDelete(ctx: AwsCtx, args: z.infer<typeof cloudfrontDeleteArgs>) {
  // Need the ETag of the current (disabled) distribution.
  const r: any = await runAws(ctx, 'cloudfrontDelete', args,
    `cloudfront get-distribution --id ${args.distribution_id}`)
  if (!r.ok) return r
  const etag = r.result?.ETag
  if (!etag) return { ok: false, error: 'could not read distribution ETag' }
  return runAws(ctx, 'cloudfrontDelete', args,
    `cloudfront delete-distribution --id ${args.distribution_id} --if-match ${etag}`)
}
async function handleCloudfrontInvalidate(ctx: AwsCtx, args: z.infer<typeof cloudfrontInvalidateArgs>) {
  const paths = JSON.stringify(JSON.stringify({ Paths: { Quantity: args.paths.length, Items: args.paths }, CallerReference: Date.now().toString() }))
  return runAws(ctx, 'cloudfrontInvalidate', args,
    `cloudfront create-invalidation --distribution-id ${args.distribution_id} --invalidation-batch ${paths}`)
}

// ── Descriptions ──

const DESC: Record<string, string> = {
  s3CreateBucket:       'Create a new S3 bucket.',
  s3DeleteBucket:       'Delete an empty S3 bucket.',
  s3List:               'List S3 buckets, or objects in a bucket with optional prefix filter.',
  s3Upload:             'Upload a workspace file to S3. `file` is relative to /work.',
  s3Download:           'Download an S3 object to the workspace. `file` is relative to /work.',
  s3Delete:             'Delete an object from S3.',
  s3SyncUpload:         'Sync a workspace directory to an S3 bucket. Optionally delete remote files not present locally.',
  s3SetWebsite:         'Enable static website hosting on an S3 bucket.',
  s3EmptyBucket:        'Delete all objects in an S3 bucket recursively. Required before s3DeleteBucket — buckets must be empty.',
  s3DisableBlockPublic: 'Disable Block Public Access on an S3 bucket. Required before s3SetPublicRead — new buckets block public access by default.',
  s3SetPublicRead:      'Apply a public-read bucket policy for static website hosting. Call s3DisableBlockPublic first.',
  stsGetCallerIdentity: 'Get the AWS account ID, user ARN, and user ID for the current credentials.',
  lambdaList:           'List Lambda functions in the account.',
  lambdaCreate:         'Create a Lambda function. Requires an IAM role ARN (create with iamCreateRole first). If the role was just created, the tool auto-retries after propagation delay. Provide a zip from workspace or S3.',
  lambdaUpdate:         'Update a Lambda function\'s code from a zip.',
  lambdaDelete:         'Delete a Lambda function.',
  lambdaInvoke:         'Invoke a Lambda function with optional JSON payload.',
  lambdaSetEnv:         'Set environment variables on a Lambda function.',
  apiGatewayCreate:     'Create an HTTP API Gateway.',
  apiGatewayList:       'List API Gateways in the account.',
  apiGatewayDelete:     'Delete an API Gateway.',
  apiGatewayAddRoute:   'Add a route to an API Gateway with a Lambda integration. Creates the integration and route in one call. The Lambda must have an invoke permission for API Gateway — call lambdaAddPermission first.',
  apiGatewayDeploy:     'Create/update a stage on an API Gateway with auto-deploy enabled.',
  lambdaAddPermission:  'Grant a service permission to invoke a Lambda. Pass api_id and the source ARN is constructed automatically. Required before wiring API Gateway routes.',
  iamCreateRole:        'Create an IAM role. Pass a service principal (e.g. "lambda.amazonaws.com") — trust policy is constructed automatically.',
  iamAttachPolicy:      'Attach a managed IAM policy to a role.',
  iamListRolePolicies:  'List managed policies attached to an IAM role. Use before iamDetachPolicy to discover what to detach.',
  iamDetachPolicy:      'Detach a managed policy from an IAM role. Required before deleting the role.',
  iamDeleteRole:        'Delete an IAM role. Detach all policies first with iamDetachPolicy.',
  cloudfrontCreate:     'Create a CloudFront distribution fronting an S3 origin. HTTPS redirect enabled.',
  cloudfrontList:       'List CloudFront distributions.',
  cloudfrontDisable:    'Disable a CloudFront distribution. Required before deletion — fetches config, sets Enabled=false, updates. Wait a few minutes for propagation before deleting.',
  cloudfrontDelete:     'Delete a disabled CloudFront distribution. Must be disabled first with cloudfrontDisable and fully propagated (Status=Deployed).',
  cloudfrontInvalidate: 'Invalidate CloudFront cache for the given paths.',
}

// ── Anthropic Claude Agent SDK adapter ──

export function buildSdk(ctx: AwsCtx, allowed?: string[] | '*' | null) {
  const tu = (extra: unknown): AwsCtx => ({ ...ctx, toolUseId: toolUseId(extra) })
  const all = [
    sdkTool('s3CreateBucket',       DESC.s3CreateBucket,       s3CreateBucketArgs.shape,       async (a: any, x: unknown) => asText(await handleS3CreateBucket(tu(x), a))),
    sdkTool('s3DeleteBucket',       DESC.s3DeleteBucket,       s3DeleteBucketArgs.shape,       async (a: any, x: unknown) => asText(await handleS3DeleteBucket(tu(x), a))),
    sdkTool('s3List',               DESC.s3List,               s3ListArgs.shape,               async (a: any, x: unknown) => asText(await handleS3List(tu(x), a))),
    sdkTool('s3Upload',             DESC.s3Upload,             s3UploadArgs.shape,             async (a: any, x: unknown) => asText(await handleS3Upload(tu(x), a))),
    sdkTool('s3Download',           DESC.s3Download,           s3DownloadArgs.shape,           async (a: any, x: unknown) => asText(await handleS3Download(tu(x), a))),
    sdkTool('s3Delete',             DESC.s3Delete,             s3DeleteArgs.shape,             async (a: any, x: unknown) => asText(await handleS3Delete(tu(x), a))),
    sdkTool('s3EmptyBucket',        DESC.s3EmptyBucket,        s3EmptyBucketArgs.shape,        async (a: any, x: unknown) => asText(await handleS3EmptyBucket(tu(x), a))),
    sdkTool('s3SyncUpload',         DESC.s3SyncUpload,         s3SyncUploadArgs.shape,         async (a: any, x: unknown) => asText(await handleS3SyncUpload(tu(x), a))),
    sdkTool('s3SetWebsite',         DESC.s3SetWebsite,         s3SetWebsiteArgs.shape,         async (a: any, x: unknown) => asText(await handleS3SetWebsite(tu(x), a))),
    sdkTool('s3DisableBlockPublic', DESC.s3DisableBlockPublic, s3DisableBlockPublicArgs.shape, async (a: any, x: unknown) => asText(await handleS3DisableBlockPublic(tu(x), a))),
    sdkTool('s3SetPublicRead',      DESC.s3SetPublicRead,      s3SetPublicReadArgs.shape,      async (a: any, x: unknown) => asText(await handleS3SetPublicRead(tu(x), a))),
    sdkTool('stsGetCallerIdentity', DESC.stsGetCallerIdentity, stsGetCallerIdentityArgs.shape, async (a: any, x: unknown) => asText(await handleStsGetCallerIdentity(tu(x), a))),
    sdkTool('lambdaList',           DESC.lambdaList,           lambdaListArgs.shape,           async (a: any, x: unknown) => asText(await handleLambdaList(tu(x), a))),
    sdkTool('lambdaCreate',         DESC.lambdaCreate,         lambdaCreateArgs.shape,         async (a: any, x: unknown) => asText(await handleLambdaCreate(tu(x), a))),
    sdkTool('lambdaUpdate',         DESC.lambdaUpdate,         lambdaUpdateArgs.shape,         async (a: any, x: unknown) => asText(await handleLambdaUpdate(tu(x), a))),
    sdkTool('lambdaDelete',         DESC.lambdaDelete,         lambdaDeleteArgs.shape,         async (a: any, x: unknown) => asText(await handleLambdaDelete(tu(x), a))),
    sdkTool('lambdaInvoke',         DESC.lambdaInvoke,         lambdaInvokeArgs.shape,         async (a: any, x: unknown) => asText(await handleLambdaInvoke(tu(x), a))),
    sdkTool('lambdaSetEnv',         DESC.lambdaSetEnv,         lambdaSetEnvArgs.shape,         async (a: any, x: unknown) => asText(await handleLambdaSetEnv(tu(x), a))),
    sdkTool('lambdaAddPermission',  DESC.lambdaAddPermission,  lambdaAddPermissionArgs.shape,  async (a: any, x: unknown) => asText(await handleLambdaAddPermission(tu(x), a))),
    sdkTool('apiGatewayCreate',     DESC.apiGatewayCreate,     apiGatewayCreateArgs.shape,     async (a: any, x: unknown) => asText(await handleApiGatewayCreate(tu(x), a))),
    sdkTool('apiGatewayList',       DESC.apiGatewayList,       apiGatewayListArgs.shape,       async (a: any, x: unknown) => asText(await handleApiGatewayList(tu(x), a))),
    sdkTool('apiGatewayDelete',     DESC.apiGatewayDelete,     apiGatewayDeleteArgs.shape,     async (a: any, x: unknown) => asText(await handleApiGatewayDelete(tu(x), a))),
    sdkTool('apiGatewayAddRoute',   DESC.apiGatewayAddRoute,   apiGatewayAddRouteArgs.shape,   async (a: any, x: unknown) => asText(await handleApiGatewayAddRoute(tu(x), a))),
    sdkTool('apiGatewayDeploy',     DESC.apiGatewayDeploy,     apiGatewayDeployArgs.shape,     async (a: any, x: unknown) => asText(await handleApiGatewayDeploy(tu(x), a))),
    sdkTool('iamCreateRole',        DESC.iamCreateRole,        iamCreateRoleArgs.shape,        async (a: any, x: unknown) => asText(await handleIamCreateRole(tu(x), a))),
    sdkTool('iamAttachPolicy',      DESC.iamAttachPolicy,      iamAttachPolicyArgs.shape,      async (a: any, x: unknown) => asText(await handleIamAttachPolicy(tu(x), a))),
    sdkTool('iamListRolePolicies',  DESC.iamListRolePolicies,  iamListRolePoliciesArgs.shape,  async (a: any, x: unknown) => asText(await handleIamListRolePolicies(tu(x), a))),
    sdkTool('iamDetachPolicy',      DESC.iamDetachPolicy,      iamDetachPolicyArgs.shape,      async (a: any, x: unknown) => asText(await handleIamDetachPolicy(tu(x), a))),
    sdkTool('iamDeleteRole',        DESC.iamDeleteRole,        iamDeleteRoleArgs.shape,        async (a: any, x: unknown) => asText(await handleIamDeleteRole(tu(x), a))),
    sdkTool('cloudfrontCreate',     DESC.cloudfrontCreate,     cloudfrontCreateArgs.shape,     async (a: any, x: unknown) => asText(await handleCloudfrontCreate(tu(x), a))),
    sdkTool('cloudfrontList',       DESC.cloudfrontList,       cloudfrontListArgs.shape,       async (a: any, x: unknown) => asText(await handleCloudfrontList(tu(x), a))),
    sdkTool('cloudfrontDisable',    DESC.cloudfrontDisable,    cloudfrontDisableArgs.shape,    async (a: any, x: unknown) => asText(await handleCloudfrontDisable(tu(x), a))),
    sdkTool('cloudfrontDelete',     DESC.cloudfrontDelete,     cloudfrontDeleteArgs.shape,     async (a: any, x: unknown) => asText(await handleCloudfrontDelete(tu(x), a))),
    sdkTool('cloudfrontInvalidate', DESC.cloudfrontInvalidate, cloudfrontInvalidateArgs.shape, async (a: any, x: unknown) => asText(await handleCloudfrontInvalidate(tu(x), a))),
  ]
  return createSdkMcpServer({ name: `aws:${ctx.connectionName}`, tools: filterTools(all, allowed) })
}

// ── Vercel ai SDK adapter ──

export function buildAi(ctx: AwsCtx) {
  const p = `aws-${ctx.connectionName}`
  return {
    [`${p}-s3CreateBucket`]:       tool({ description: DESC.s3CreateBucket,       inputSchema: s3CreateBucketArgs,       execute: (a: z.infer<typeof s3CreateBucketArgs>)       => handleS3CreateBucket(ctx, a) }),
    [`${p}-s3DeleteBucket`]:       tool({ description: DESC.s3DeleteBucket,       inputSchema: s3DeleteBucketArgs,       execute: (a: z.infer<typeof s3DeleteBucketArgs>)       => handleS3DeleteBucket(ctx, a) }),
    [`${p}-s3List`]:               tool({ description: DESC.s3List,               inputSchema: s3ListArgs,               execute: (a: z.infer<typeof s3ListArgs>)               => handleS3List(ctx, a) }),
    [`${p}-s3Upload`]:             tool({ description: DESC.s3Upload,             inputSchema: s3UploadArgs,             execute: (a: z.infer<typeof s3UploadArgs>)             => handleS3Upload(ctx, a) }),
    [`${p}-s3Download`]:           tool({ description: DESC.s3Download,           inputSchema: s3DownloadArgs,           execute: (a: z.infer<typeof s3DownloadArgs>)           => handleS3Download(ctx, a) }),
    [`${p}-s3Delete`]:             tool({ description: DESC.s3Delete,             inputSchema: s3DeleteArgs,             execute: (a: z.infer<typeof s3DeleteArgs>)             => handleS3Delete(ctx, a) }),
    [`${p}-s3EmptyBucket`]:        tool({ description: DESC.s3EmptyBucket,        inputSchema: s3EmptyBucketArgs,        execute: (a: z.infer<typeof s3EmptyBucketArgs>)        => handleS3EmptyBucket(ctx, a) }),
    [`${p}-s3SyncUpload`]:         tool({ description: DESC.s3SyncUpload,         inputSchema: s3SyncUploadArgs,         execute: (a: z.infer<typeof s3SyncUploadArgs>)         => handleS3SyncUpload(ctx, a) }),
    [`${p}-s3SetWebsite`]:         tool({ description: DESC.s3SetWebsite,         inputSchema: s3SetWebsiteArgs,         execute: (a: z.infer<typeof s3SetWebsiteArgs>)         => handleS3SetWebsite(ctx, a) }),
    [`${p}-s3DisableBlockPublic`]: tool({ description: DESC.s3DisableBlockPublic, inputSchema: s3DisableBlockPublicArgs, execute: (a: z.infer<typeof s3DisableBlockPublicArgs>) => handleS3DisableBlockPublic(ctx, a) }),
    [`${p}-s3SetPublicRead`]:      tool({ description: DESC.s3SetPublicRead,      inputSchema: s3SetPublicReadArgs,      execute: (a: z.infer<typeof s3SetPublicReadArgs>)      => handleS3SetPublicRead(ctx, a) }),
    [`${p}-stsGetCallerIdentity`]: tool({ description: DESC.stsGetCallerIdentity, inputSchema: stsGetCallerIdentityArgs, execute: (a: z.infer<typeof stsGetCallerIdentityArgs>) => handleStsGetCallerIdentity(ctx, a) }),
    [`${p}-lambdaList`]:           tool({ description: DESC.lambdaList,           inputSchema: lambdaListArgs,           execute: (a: z.infer<typeof lambdaListArgs>)           => handleLambdaList(ctx, a) }),
    [`${p}-lambdaCreate`]:         tool({ description: DESC.lambdaCreate,         inputSchema: lambdaCreateArgs,         execute: (a: z.infer<typeof lambdaCreateArgs>)         => handleLambdaCreate(ctx, a) }),
    [`${p}-lambdaUpdate`]:         tool({ description: DESC.lambdaUpdate,         inputSchema: lambdaUpdateArgs,         execute: (a: z.infer<typeof lambdaUpdateArgs>)         => handleLambdaUpdate(ctx, a) }),
    [`${p}-lambdaDelete`]:         tool({ description: DESC.lambdaDelete,         inputSchema: lambdaDeleteArgs,         execute: (a: z.infer<typeof lambdaDeleteArgs>)         => handleLambdaDelete(ctx, a) }),
    [`${p}-lambdaInvoke`]:         tool({ description: DESC.lambdaInvoke,         inputSchema: lambdaInvokeArgs,         execute: (a: z.infer<typeof lambdaInvokeArgs>)         => handleLambdaInvoke(ctx, a) }),
    [`${p}-lambdaSetEnv`]:         tool({ description: DESC.lambdaSetEnv,         inputSchema: lambdaSetEnvArgs,         execute: (a: z.infer<typeof lambdaSetEnvArgs>)         => handleLambdaSetEnv(ctx, a) }),
    [`${p}-lambdaAddPermission`]:  tool({ description: DESC.lambdaAddPermission,  inputSchema: lambdaAddPermissionArgs,  execute: (a: z.infer<typeof lambdaAddPermissionArgs>)  => handleLambdaAddPermission(ctx, a) }),
    [`${p}-apiGatewayCreate`]:     tool({ description: DESC.apiGatewayCreate,     inputSchema: apiGatewayCreateArgs,     execute: (a: z.infer<typeof apiGatewayCreateArgs>)     => handleApiGatewayCreate(ctx, a) }),
    [`${p}-apiGatewayList`]:       tool({ description: DESC.apiGatewayList,       inputSchema: apiGatewayListArgs,       execute: (a: z.infer<typeof apiGatewayListArgs>)       => handleApiGatewayList(ctx, a) }),
    [`${p}-apiGatewayDelete`]:     tool({ description: DESC.apiGatewayDelete,     inputSchema: apiGatewayDeleteArgs,     execute: (a: z.infer<typeof apiGatewayDeleteArgs>)     => handleApiGatewayDelete(ctx, a) }),
    [`${p}-apiGatewayAddRoute`]:   tool({ description: DESC.apiGatewayAddRoute,   inputSchema: apiGatewayAddRouteArgs,   execute: (a: z.infer<typeof apiGatewayAddRouteArgs>)   => handleApiGatewayAddRoute(ctx, a) }),
    [`${p}-apiGatewayDeploy`]:     tool({ description: DESC.apiGatewayDeploy,     inputSchema: apiGatewayDeployArgs,     execute: (a: z.infer<typeof apiGatewayDeployArgs>)     => handleApiGatewayDeploy(ctx, a) }),
    [`${p}-iamCreateRole`]:        tool({ description: DESC.iamCreateRole,        inputSchema: iamCreateRoleArgs,        execute: (a: z.infer<typeof iamCreateRoleArgs>)        => handleIamCreateRole(ctx, a) }),
    [`${p}-iamAttachPolicy`]:      tool({ description: DESC.iamAttachPolicy,      inputSchema: iamAttachPolicyArgs,      execute: (a: z.infer<typeof iamAttachPolicyArgs>)      => handleIamAttachPolicy(ctx, a) }),
    [`${p}-iamListRolePolicies`]:  tool({ description: DESC.iamListRolePolicies,  inputSchema: iamListRolePoliciesArgs,  execute: (a: z.infer<typeof iamListRolePoliciesArgs>)  => handleIamListRolePolicies(ctx, a) }),
    [`${p}-iamDetachPolicy`]:      tool({ description: DESC.iamDetachPolicy,      inputSchema: iamDetachPolicyArgs,      execute: (a: z.infer<typeof iamDetachPolicyArgs>)      => handleIamDetachPolicy(ctx, a) }),
    [`${p}-iamDeleteRole`]:        tool({ description: DESC.iamDeleteRole,        inputSchema: iamDeleteRoleArgs,        execute: (a: z.infer<typeof iamDeleteRoleArgs>)        => handleIamDeleteRole(ctx, a) }),
    [`${p}-cloudfrontCreate`]:     tool({ description: DESC.cloudfrontCreate,     inputSchema: cloudfrontCreateArgs,     execute: (a: z.infer<typeof cloudfrontCreateArgs>)     => handleCloudfrontCreate(ctx, a) }),
    [`${p}-cloudfrontList`]:       tool({ description: DESC.cloudfrontList,       inputSchema: cloudfrontListArgs,       execute: (a: z.infer<typeof cloudfrontListArgs>)       => handleCloudfrontList(ctx, a) }),
    [`${p}-cloudfrontDisable`]:    tool({ description: DESC.cloudfrontDisable,    inputSchema: cloudfrontDisableArgs,    execute: (a: z.infer<typeof cloudfrontDisableArgs>)    => handleCloudfrontDisable(ctx, a) }),
    [`${p}-cloudfrontDelete`]:     tool({ description: DESC.cloudfrontDelete,     inputSchema: cloudfrontDeleteArgs,     execute: (a: z.infer<typeof cloudfrontDeleteArgs>)     => handleCloudfrontDelete(ctx, a) }),
    [`${p}-cloudfrontInvalidate`]: tool({ description: DESC.cloudfrontInvalidate, inputSchema: cloudfrontInvalidateArgs, execute: (a: z.infer<typeof cloudfrontInvalidateArgs>) => handleCloudfrontInvalidate(ctx, a) }),
  }
}
