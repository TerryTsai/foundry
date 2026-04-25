// Linear — issue tracking. GraphQL-only API. Every tool is a one-shot
// POST to https://api.linear.app/graphql with an inline query + variables.
// Auth is the API key in the Authorization header (no `Bearer ` prefix).

import { z } from 'zod'

import { runCommand, type ConnCtx } from '../shared.js'
import type { McpServerInfo, ToolDef } from '../types.js'

type LinearCtx = ConnCtx

// ── Args ─────────────────────────────────────────────────────────────

const teamListArgs = z.object({})

const stateListArgs = z.object({
  teamId: z.string().describe('Team id. Get via teamList.'),
})

const issueListArgs = z.object({
  teamId:     z.string().optional().describe('Restrict to one team.'),
  assigneeId: z.string().optional().describe('Restrict to issues assigned to a user id.'),
  stateType:  z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']).optional()
                .describe('Filter by workflow state bucket.'),
  first:      z.number().int().min(1).max(100).optional().describe('Default 25.'),
  after:      z.string().optional().describe('Cursor for the next page (from the prior response\'s pageInfo.endCursor).'),
})

const issueGetArgs = z.object({
  id: z.string().describe('Issue uuid or identifier (e.g. "ENG-42").'),
})

const issueCreateArgs = z.object({
  teamId:      z.string().describe('Team id. Get via teamList.'),
  title:       z.string(),
  description: z.string().optional().describe('Markdown body.'),
  priority:    z.number().int().min(0).max(4).optional().describe('0 none, 1 urgent, 2 high, 3 medium, 4 low.'),
  stateId:     z.string().optional().describe('Initial workflow state (default = team\'s "Triage" or "Backlog").'),
  assigneeId:  z.string().optional(),
  labelIds:    z.array(z.string()).optional(),
  parentId:    z.string().optional().describe('Parent issue id, if creating a sub-issue.'),
})

const issueUpdateArgs = z.object({
  id:          z.string().describe('Issue uuid.'),
  title:       z.string().optional(),
  description: z.string().optional(),
  priority:    z.number().int().min(0).max(4).optional(),
  stateId:     z.string().optional(),
  assigneeId:  z.string().nullable().optional().describe('Pass null to unassign.'),
  labelIds:    z.array(z.string()).optional(),
})

const pingArgs = z.object({})

// ── GraphQL helper ───────────────────────────────────────────────────

async function gql(ctx: LinearCtx, toolName: string, args: unknown, query: string, variables?: Record<string, unknown>) {
  const body = JSON.stringify(variables ? { query, variables } : { query })
  const cmd = `curl -sf -X POST -H "Authorization: $API_KEY" -H "Content-Type: application/json" --data ${JSON.stringify(body)} "https://api.linear.app/graphql"`
  const r = await runCommand(ctx,
    cmd, toolName, args, {
      env:       { API_KEY: ctx.secrets.api_key ?? '' },
      toolUseId: ctx.toolUseId,
    })
  if (r.exitCode !== 0) return { ok: false as const, error: r.stderr || r.stdout || 'request failed' }
  try {
    const parsed = JSON.parse(r.stdout) as { data?: unknown; errors?: Array<{ message: string }> }
    if (parsed.errors?.length) return { ok: false as const, error: parsed.errors.map(e => e.message).join('; ') }
    return { ok: true as const, result: parsed.data }
  } catch { return { ok: true as const, stdout: r.stdout } }
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleTeamList(ctx: LinearCtx, args: z.infer<typeof teamListArgs>) {
  return gql(ctx, 'teamList', args, `{ teams(first: 100) { nodes { id name key description } } }`)
}

async function handleStateList(ctx: LinearCtx, args: z.infer<typeof stateListArgs>) {
  return gql(ctx, 'stateList', args, `
    query($teamId: String!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 50) {
        nodes { id name type position }
      }
    }`, { teamId: args.teamId })
}

async function handleIssueList(ctx: LinearCtx, args: z.infer<typeof issueListArgs>) {
  const filter: Record<string, unknown> = {}
  if (args.teamId)     filter.team     = { id: { eq: args.teamId } }
  if (args.assigneeId) filter.assignee = { id: { eq: args.assigneeId } }
  if (args.stateType)  filter.state    = { type: { eq: args.stateType } }
  return gql(ctx, 'issueList', args, `
    query($filter: IssueFilter, $first: Int, $after: String) {
      issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
        nodes {
          id identifier title priority
          state { name type }
          team { id key name }
          assignee { id name }
          createdAt updatedAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }`, { filter, first: args.first ?? 25, after: args.after ?? null })
}

async function handleIssueGet(ctx: LinearCtx, args: z.infer<typeof issueGetArgs>) {
  return gql(ctx, 'issueGet', args, `
    query($id: String!) {
      issue(id: $id) {
        id identifier title description priority
        state { id name type }
        team { id key name }
        assignee { id name }
        labels { nodes { id name color } }
        parent { id identifier }
        createdAt updatedAt
      }
    }`, { id: args.id })
}

async function handleIssueCreate(ctx: LinearCtx, args: z.infer<typeof issueCreateArgs>) {
  return gql(ctx, 'issueCreate', args, `
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url }
      }
    }`, { input: args })
}

async function handleIssueUpdate(ctx: LinearCtx, args: z.infer<typeof issueUpdateArgs>) {
  const { id, ...input } = args
  return gql(ctx, 'issueUpdate', args, `
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id identifier title url state { name } assignee { name } }
      }
    }`, { id, input })
}

async function handlePing(ctx: LinearCtx, args: z.infer<typeof pingArgs>) {
  return gql(ctx, 'ping', args, `{ viewer { id name email } }`)
}

// ── Tools ──

export const info: McpServerInfo = {
  id:          'linear',
  name:        'Linear',
  category:    'code',
  description: 'Issue tracking and product planning.',
}

export const tools: ToolDef<ConnCtx>[] = [
  { name: 'teamList',    description: 'List every team in the Linear workspace. Needed to discover team ids before creating issues.',                                                                                 schema: teamListArgs,    handler: handleTeamList },
  { name: 'stateList',   description: 'List workflow states for a team. Use this to discover state ids for issueCreate/issueUpdate transitions.',                                                                     schema: stateListArgs,   handler: handleStateList },
  { name: 'issueList',   description: 'List issues, optionally filtered by team, assignee, or workflow state bucket. Paginate with `after` using `pageInfo.endCursor` from the previous response.',                   schema: issueListArgs,   handler: handleIssueList },
  { name: 'issueGet',    description: 'Fetch full details for one issue. Accepts either the uuid or the human identifier like "ENG-42".',                                                                             schema: issueGetArgs,    handler: handleIssueGet },
  { name: 'issueCreate', description: 'Create a new issue. Team id is required; use teamList if you don\'t have one yet. Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.',                                       schema: issueCreateArgs, handler: handleIssueCreate },
  { name: 'issueUpdate', description: 'Update an existing issue. Pass only the fields you want to change. Use stateId to transition status; discover ids via stateList.',                                             schema: issueUpdateArgs, handler: handleIssueUpdate },
  { name: 'ping',        description: 'Verify the API key with a viewer query.',                                                                                                                                     schema: pingArgs,        handler: handlePing },
]
