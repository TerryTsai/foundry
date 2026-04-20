import {
  Terminal, FileText, FilePen, FileDiff, Trash2, Search, Folder, FileCode,
  Globe, Newspaper,
  Download, GitBranch, GitCommit, GitMerge, GitPullRequest, Plus, Minus, ListTree,
  Ticket, Bot, Brain, Activity, Gavel, Tag, X as XIcon, Paperclip,
  CloudUpload, Cloud, History, ShieldCheck, Eraser,
  Navigation, Camera, MousePointer, Keyboard, Type as TypeIcon, Component, ArrowLeft,
  Database, Box,
  Users, User, Mail, MessageSquare, BarChart3, Bug, CreditCard, Calendar, Table,
  Shield, Zap, Network, CheckCircle, LineChart,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Single source of truth for how tool calls render in the activity timeline.
// - toolLabel: human-readable string ("git clone TerryTsai/foundry"). Used
//   as the ActivityRow label. Lowercase, matches other activity items.
// - toolIcon: Lucide icon component for the row's leading glyph.
//
// Includes legacy aliases (pullRequestCreate, ticket, agents) so historical
// execution rows from before the tool rename still render correctly.

interface ToolMeta {
  label: (input: Record<string, unknown>) => string
  icon:  LucideIcon
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + '…' : s
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
}

const TOOL_META: Record<string, ToolMeta> = {
  // ── sandbox ──
  run:       { label: i => `run ${truncate(asString(i.command) ?? '', 60)}`, icon: Terminal },
  exec:      { label: i => `exec ${truncate(asString(i.command) ?? '', 60)}`, icon: Terminal },
  runScript: { label: i => `run script (${asString(i.interpreter) ?? 'sh'})`, icon: FileCode },
  read:      { label: i => `read ${asString(i.path) ?? ''}${typeof i.offset === 'number' ? ` from ${i.offset}` : ''}`, icon: FileText },
  write:     { label: i => `write ${asString(i.path) ?? ''}`, icon: FilePen },
  patch:     { label: i => `patch ${asString(i.path) ?? ''}`, icon: FileDiff },
  remove:    { label: i => `remove ${asString(i.path) ?? ''}`, icon: Trash2 },
  search:    { label: i => `search "${truncate(asString(i.pattern) ?? '', 40)}"${asString(i.path) ? ` in ${asString(i.path)}` : ''}`, icon: Search },
  find:      { label: i => `find ${asString(i.pattern) ?? ''}${asString(i.path) ? ` in ${asString(i.path)}` : ''}`, icon: Folder },

  // ── browser ──
  fetch:             { label: i => `fetch ${asString(i.url) ?? ''}`, icon: Globe },
  scrape:            { label: i => `scrape ${asString(i.url) ?? ''}`, icon: Newspaper },
  browserGoto:       { label: i => `browser goto ${asString(i.url) ?? ''}`, icon: Navigation },
  browserScreenshot: { label: i => `browser screenshot${i.full_page ? ' (full page)' : ''}`, icon: Camera },
  browserClick:      { label: i => `browser click ${asString(i.selector) ?? ''}`, icon: MousePointer },
  browserFill:       { label: i => `browser fill ${asString(i.selector) ?? ''}`, icon: Keyboard },
  browserText:       { label: i => `browser text${asString(i.selector) ? ` ${asString(i.selector)}` : ''}`, icon: TypeIcon },
  browserDom:        { label: _ => 'browser dom', icon: Component },
  browserBack:       { label: _ => 'browser back', icon: ArrowLeft },

  // ── github ──
  gitClone:       { label: i => `git clone${asString(i.owner) && asString(i.repo) ? ` ${asString(i.owner)}/${asString(i.repo)}` : ''}`, icon: Download },
  gitStatus:      { label: _ => 'git status', icon: GitBranch },
  gitDiff:        { label: i => `git diff${i.staged ? ' --staged' : ''}${asArray(i.paths)?.length ? ' ' + asArray(i.paths)!.join(' ') : ''}`, icon: FileDiff },
  gitAdd:         { label: i => `git add${asArray(i.paths)?.length ? ' ' + asArray(i.paths)!.join(' ') : ''}`, icon: Plus },
  gitRemove:      { label: i => `git rm${asArray(i.paths)?.length ? ' ' + asArray(i.paths)!.join(' ') : ''}`, icon: Minus },
  gitCommit:      { label: i => `git commit${asString(i.message) ? ` "${truncate(asString(i.message)!, 50)}"` : ''}`, icon: GitCommit },
  gitPullRequest: { label: _ => 'git pull request', icon: GitPullRequest },
  gitMerge:       { label: _ => 'git merge', icon: GitMerge },
  gitRebase:      { label: _ => 'git rebase', icon: GitBranch },

  // ── foundry ──
  ticketList:      { label: _ => 'ticket list', icon: Ticket },
  ticketGet:       { label: i => `ticket get ${asString(i.id) ?? ''}`, icon: Ticket },
  ticketCreate:    { label: i => `ticket create "${truncate(asString(i.title) ?? '', 40)}"`, icon: Ticket },
  ticketComment:   { label: _ => 'ticket comment', icon: Ticket },
  ticketCancel:    { label: i => `ticket cancel ${asString(i.ticket_id) ?? ''}`, icon: XIcon },
  ticketTagAdd:    { label: i => `tag +${asString(i.tag) ?? ''}`, icon: Tag },
  ticketTagRemove: { label: i => `tag -${asString(i.tag) ?? ''}`, icon: Tag },
  agentsList:      { label: _ => 'agents list', icon: Bot },
  sessionList:     { label: _ => 'session list', icon: ListTree },
  connectionList:  { label: _ => 'connection list', icon: Activity },
  think:           { label: _ => 'think', icon: Brain },
  verdictReport:   { label: i => `verdict ${i.pass ? 'pass' : 'fail'}`, icon: Gavel },
  attachmentGet:   { label: i => `attachment ${asString(i.id) ?? ''}`, icon: Paperclip },

  // ── cloudflare ──
  whoami:           { label: _ => 'cloudflare whoami', icon: ShieldCheck },
  zonesList:        { label: _ => 'cloudflare zones', icon: Cloud },
  purgeCache:       { label: i => `cloudflare purge${i.purge_everything ? ' (everything)' : asArray(i.files)?.length ? ` ${asArray(i.files)!.length} url(s)` : ''}`, icon: Eraser },
  pagesList:        { label: _ => 'cloudflare pages list', icon: Cloud },
  pagesDeployments: { label: i => `cloudflare pages deployments${asString(i.project_name) ? ` ${asString(i.project_name)}` : ''}`, icon: History },
  pagesDeploy:      { label: i => `cloudflare pages deploy${asString(i.project_name) ? ` ${asString(i.project_name)}` : ''}${asString(i.dir) ? ` ← ${asString(i.dir)}` : ''}`, icon: CloudUpload },
  pagesRemove:      { label: i => `cloudflare pages remove${asString(i.project_name) ? ` ${asString(i.project_name)}` : ''}`, icon: Trash2 },
  r2CreateBucket:   { label: i => `r2 create bucket ${asString(i.bucket) ?? ''}`, icon: Box },
  r2DeleteBucket:   { label: i => `r2 delete bucket ${asString(i.bucket) ?? ''}`, icon: Trash2 },
  r2ListBuckets:    { label: _ => 'r2 list buckets', icon: Box },
  r2ListObjects:    { label: i => `r2 list ${asString(i.bucket) ?? ''}${asString(i.prefix) ? `/${asString(i.prefix)}` : ''}`, icon: Box },
  r2Upload:         { label: i => `r2 upload ${asString(i.bucket) ?? ''}/${asString(i.key) ?? ''}`, icon: CloudUpload },
  r2Download:       { label: i => `r2 download ${asString(i.bucket) ?? ''}/${asString(i.key) ?? ''}`, icon: Download },
  r2Delete:         { label: i => `r2 delete ${asString(i.bucket) ?? ''}/${asString(i.key) ?? ''}`, icon: Trash2 },
  d1Create:         { label: i => `d1 create ${asString(i.name) ?? ''}`, icon: Database },
  d1Delete:         { label: i => `d1 delete ${asString(i.name) ?? ''}`, icon: Trash2 },
  d1List:           { label: _ => 'd1 list', icon: Database },
  d1Query:          { label: i => `d1 query ${asString(i.database) ?? ''}`, icon: Database },
  kvCreate:         { label: i => `kv create ${asString(i.title) ?? ''}`, icon: Database },
  kvDeleteNamespace:{ label: i => `kv delete namespace ${asString(i.namespace_id) ?? ''}`, icon: Trash2 },
  kvList:           { label: _ => 'kv list', icon: Database },
  kvGet:            { label: i => `kv get ${asString(i.key) ?? ''}`, icon: Database },
  kvPut:            { label: i => `kv put ${asString(i.key) ?? ''}`, icon: Database },
  kvDelete:         { label: i => `kv delete ${asString(i.key) ?? ''}`, icon: Trash2 },

  // ── linear ──
  teamList:    { label: _ => 'linear teams', icon: Users },
  stateList:   { label: _ => 'linear states', icon: ListTree },
  issueList:   { label: _ => 'linear issues', icon: ListTree },
  issueGet:    { label: i => `linear issue ${asString(i.id) ?? ''}`, icon: Activity },
  issueCreate: { label: i => `linear new issue "${truncate(asString(i.title) ?? '', 40)}"`, icon: Plus },
  issueUpdate: { label: i => `linear update ${asString(i.id) ?? ''}`, icon: FilePen },
  ping:        { label: _ => 'ping', icon: CheckCircle },

  // ── calcom ──
  bookingList:   { label: _ => 'calcom bookings', icon: Calendar },
  bookingGet:    { label: i => `calcom booking ${i.id ?? ''}`, icon: Calendar },
  bookingCancel: { label: i => `calcom cancel ${i.id ?? ''}`, icon: XIcon },
  eventTypeList: { label: _ => 'calcom event types', icon: Calendar },

  // ── posthog ──
  queryHogQL:      { label: _ => 'posthog query', icon: BarChart3 },
  featureFlagList: { label: _ => 'posthog flags', icon: BarChart3 },
  featureFlagGet:  { label: i => `posthog flag ${asString(i.key) ?? ''}`, icon: BarChart3 },

  // ── clerk ──
  userList:   { label: _ => 'clerk users', icon: Users },
  userGet:    { label: i => `clerk user ${asString(i.id) ?? ''}`, icon: User },
  userUpdate: { label: i => `clerk update ${asString(i.id) ?? ''}`, icon: FilePen },
  userBan:    { label: i => `clerk ban ${asString(i.id) ?? ''}`, icon: XIcon },
  userUnban:  { label: i => `clerk unban ${asString(i.id) ?? ''}`, icon: CheckCircle },

  // ── resend ──
  sendEmail: { label: i => `email → ${asString(i.to) ?? ''}`, icon: Mail },
  getEmail:  { label: i => `email get ${asString(i.id) ?? ''}`, icon: Mail },

  // ── sentry ──
  listIssues:   { label: _ => 'sentry issues', icon: Bug },
  getIssue:     { label: i => `sentry issue ${asString(i.issue_id) ?? ''}`, icon: Bug },
  resolveIssue: { label: i => `sentry resolve ${asString(i.issue_id) ?? ''}`, icon: CheckCircle },

  // ── stripe ──
  checkoutCreate:   { label: _ => 'stripe checkout', icon: CreditCard },
  customerList:     { label: _ => 'stripe customers', icon: Users },
  customerGet:      { label: i => `stripe customer ${asString(i.id) ?? ''}`, icon: User },
  subscriptionList: { label: _ => 'stripe subscriptions', icon: CreditCard },

  // ── crisp ──
  conversationList:  { label: _ => 'crisp conversations', icon: MessageSquare },
  conversationGet:   { label: i => `crisp conversation ${asString(i.session_id) ?? ''}`, icon: MessageSquare },
  conversationSend:  { label: i => `crisp send → ${asString(i.session_id) ?? ''}`, icon: MessageSquare },
  conversationClose: { label: i => `crisp close ${asString(i.session_id) ?? ''}`, icon: XIcon },

  // ── supabase ──
  tableSelect: { label: i => `supabase select ${asString(i.table) ?? ''}`, icon: Table },
  tableInsert: { label: i => `supabase insert ${asString(i.table) ?? ''}`, icon: Plus },
  tableUpdate: { label: i => `supabase update ${asString(i.table) ?? ''}`, icon: FilePen },
  tableDelete: { label: i => `supabase delete ${asString(i.table) ?? ''}`, icon: Trash2 },

  // ── aws s3 ──
  s3CreateBucket:       { label: i => `s3 create bucket ${asString(i.bucket) ?? ''}`, icon: Box },
  s3DeleteBucket:       { label: i => `s3 delete bucket ${asString(i.bucket) ?? ''}`, icon: Trash2 },
  s3List:               { label: i => `s3 list${asString(i.bucket) ? ` ${asString(i.bucket)}` : ''}`, icon: Box },
  s3Upload:             { label: i => `s3 upload ${asString(i.bucket) ?? ''}/${asString(i.key) ?? ''}`, icon: CloudUpload },
  s3Download:           { label: i => `s3 download ${asString(i.bucket) ?? ''}/${asString(i.key) ?? ''}`, icon: Download },
  s3Delete:             { label: i => `s3 delete ${asString(i.bucket) ?? ''}/${asString(i.key) ?? ''}`, icon: Trash2 },
  s3SyncUpload:         { label: i => `s3 sync → ${asString(i.bucket) ?? ''}`, icon: CloudUpload },
  s3SetWebsite:         { label: i => `s3 set website ${asString(i.bucket) ?? ''}`, icon: Globe },
  s3EmptyBucket:        { label: i => `s3 empty ${asString(i.bucket) ?? ''}`, icon: Eraser },
  s3DisableBlockPublic: { label: i => `s3 unblock public ${asString(i.bucket) ?? ''}`, icon: Shield },
  s3SetPublicRead:      { label: i => `s3 public-read ${asString(i.bucket) ?? ''}`, icon: Shield },

  // ── aws lambda ──
  lambdaList:          { label: _ => 'lambda list', icon: Zap },
  lambdaCreate:        { label: i => `lambda create ${asString(i.name) ?? ''}`, icon: Plus },
  lambdaUpdate:        { label: i => `lambda update ${asString(i.name) ?? ''}`, icon: FilePen },
  lambdaDelete:        { label: i => `lambda delete ${asString(i.name) ?? ''}`, icon: Trash2 },
  lambdaInvoke:        { label: i => `lambda invoke ${asString(i.name) ?? ''}`, icon: Zap },
  lambdaAddPermission: { label: i => `lambda permission ${asString(i.name) ?? ''}`, icon: Shield },
  lambdaSetEnv:        { label: i => `lambda env ${asString(i.name) ?? ''}`, icon: FilePen },

  // ── aws api gateway ──
  apiGatewayCreate:   { label: i => `api gateway create ${asString(i.name) ?? ''}`, icon: Network },
  apiGatewayList:     { label: _ => 'api gateway list', icon: Network },
  apiGatewayDelete:   { label: i => `api gateway delete ${asString(i.api_id) ?? ''}`, icon: Trash2 },
  apiGatewayAddRoute: { label: i => `api gateway route ${asString(i.route_key) ?? ''}`, icon: Network },
  apiGatewayDeploy:   { label: i => `api gateway deploy ${asString(i.stage_name) ?? ''}`, icon: CloudUpload },

  // ── aws iam ──
  iamCreateRole:       { label: i => `iam role + ${asString(i.name) ?? ''}`, icon: Shield },
  iamAttachPolicy:     { label: i => `iam attach ${asString(i.policy_arn) ?? ''}`, icon: Shield },
  iamListRolePolicies: { label: i => `iam policies ${asString(i.role_name) ?? ''}`, icon: Shield },
  iamDetachPolicy:     { label: i => `iam detach ${asString(i.policy_arn) ?? ''}`, icon: Shield },
  iamDeleteRole:       { label: i => `iam role - ${asString(i.name) ?? ''}`, icon: Trash2 },

  // ── aws cloudfront ──
  cloudfrontCreate:     { label: _ => 'cloudfront create', icon: Cloud },
  cloudfrontList:       { label: _ => 'cloudfront list', icon: Cloud },
  cloudfrontDisable:    { label: i => `cloudfront disable ${asString(i.id) ?? ''}`, icon: XIcon },
  cloudfrontDelete:     { label: i => `cloudfront delete ${asString(i.id) ?? ''}`, icon: Trash2 },
  cloudfrontInvalidate: { label: i => `cloudfront invalidate ${asString(i.id) ?? ''}`, icon: Eraser },

  // ── aws sts ──
  stsGetCallerIdentity: { label: _ => 'sts whoami', icon: ShieldCheck },

  // ── uptimerobot ──
  monitorList:   { label: _ => 'monitors', icon: LineChart },
  monitorCreate: { label: i => `monitor + ${asString(i.friendly_name) ?? asString(i.url) ?? ''}`, icon: Plus },
  monitorDelete: { label: i => `monitor - ${i.id ?? ''}`, icon: Trash2 },
  monitorPause:  { label: i => `monitor pause ${i.id ?? ''}`, icon: XIcon },
  monitorResume: { label: i => `monitor resume ${i.id ?? ''}`, icon: CheckCircle },

  // ── legacy aliases (historical rows from before tool renames) ──
  pullRequestCreate: { label: _ => 'git pull request', icon: GitPullRequest },
  agents:            { label: _ => 'agents list', icon: Bot },
  ticket:            { label: i => `ticket ${asString(i.action) ?? ''}`, icon: Ticket },
  providerList:      { label: _ => 'provider list', icon: Activity },
}

export function toolLabel(name: string | null, inputJson: string | null): string {
  if (!name) return 'exec'
  let input: Record<string, unknown> = {}
  if (inputJson) {
    try {
      const parsed = JSON.parse(inputJson)
      if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
    } catch { /* use empty input */ }
  }
  const meta = TOOL_META[name]
  return meta ? meta.label(input) : name
}

export function toolIcon(name: string | null, size = 14): React.ReactNode {
  const Icon = (name && TOOL_META[name]?.icon) || Terminal
  return <Icon size={size} />
}
