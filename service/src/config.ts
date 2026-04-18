import { z } from 'zod'
import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'

const schema = z.object({
  port:                z.coerce.number().int().default(3000),
  dbPath:              z.string().default('./foundry.db'),
  sandboxImage:        z.string().default('foundry-sandbox'),
  sandboxTimeout:      z.coerce.number().int().default(1200000),
  // Resource caps — every sandbox execution is bounded by these
  sandboxMemoryMb:     z.coerce.number().int().default(4096),
  sandboxCpus:         z.coerce.number().default(4.0),
  sandboxPidsLimit:    z.coerce.number().int().default(1024),
  sandboxNofileSoft:   z.coerce.number().int().default(4096),
  sandboxNofileHard:   z.coerce.number().int().default(8192),
  sandboxTmpfsMb:      z.coerce.number().int().default(512),
  // Auth — GitHub App user OAuth + cookie session. The OAuth callback URL is
  // derived from the incoming request host, so the same binary works on
  // localhost, a tailnet name, or a public domain — only GitHub's registered
  // callback has to match whatever URL you actually use.
  //
  // gitHubClientId / gitHubClientSecret come from the GitHub App's "Client ID"
  // and a generated client secret. gitHubAppId + the PEM at gitHubAppPrivateKeyPath
  // are only needed for installation-token (repo) operations, not for login —
  // they stay optional until repo features land.
  gitHubClientId:           z.string().min(1),
  gitHubClientSecret:       z.string().min(1),
  gitHubAppId:              z.coerce.number().int().positive().optional(),
  gitHubAppPrivateKeyPath:  z.string().optional(),
  ownerGitHubLogin:         z.string().optional(),
  // Allowlist of GitHub logins permitted to sign in. The effective allowlist
  // is the union of this list and ownerGitHubLogin. If empty, no one can
  // sign in — fail-closed by design so an unset config doesn't open
  // registration to the whole internet.
  allowedGithubLogins:      z.preprocess(
    v => typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : v,
    z.array(z.string()).default([]),
  ),
  // z.coerce.boolean uses Boolean(), which makes the string "false" truthy.
  // Preprocess so the env var actually behaves like a boolean.
  cookieSecure:             z.preprocess(
    v => typeof v === 'string' ? v.toLowerCase() === 'true' : v,
    z.boolean(),
  ).default(true),
  sessionMaxAgeSec:         z.coerce.number().int().default(60 * 60 * 24 * 7),
})

const parsed = schema.parse({
  port:               process.env.PORT,
  dbPath:             process.env.DB_PATH,
  sandboxImage:       process.env.SANDBOX_IMAGE,
  sandboxTimeout:     process.env.SANDBOX_TIMEOUT,
  sandboxMemoryMb:    process.env.SANDBOX_MEMORY_MB,
  sandboxCpus:        process.env.SANDBOX_CPUS,
  sandboxPidsLimit:   process.env.SANDBOX_PIDS_LIMIT,
  sandboxNofileSoft:  process.env.SANDBOX_NOFILE_SOFT,
  sandboxNofileHard:  process.env.SANDBOX_NOFILE_HARD,
  sandboxTmpfsMb:     process.env.SANDBOX_TMPFS_MB,
  gitHubClientId:          process.env.GITHUB_CLIENT_ID,
  gitHubClientSecret:      process.env.GITHUB_CLIENT_SECRET,
  gitHubAppId:             process.env.GITHUB_APP_ID,
  gitHubAppPrivateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
  ownerGitHubLogin:        process.env.OWNER_GITHUB_LOGIN,
  allowedGithubLogins:     process.env.ALLOWED_GITHUB_LOGINS,
  cookieSecure:            process.env.COOKIE_SECURE,
  sessionMaxAgeSec:        process.env.SESSION_MAX_AGE_SEC,
})

// Read the App private key eagerly so a malformed/missing path fails at boot,
// not on the first installation-token call. The PEM stays in memory.
const gitHubAppPrivateKey = parsed.gitHubAppPrivateKeyPath
  ? readFileSync(parsed.gitHubAppPrivateKeyPath, 'utf-8')
  : undefined

// Internal API token: generated fresh per boot, accepted by requireAuth as
// an alternative to a session cookie. Used by sandbox-hosted tool calls
// (foundry introspection, future integrations) to curl back into the
// service. Every sandbox the token authorizes is a child of this process,
// so we don't need persistence across reboots.
const internalApiToken = process.env.INTERNAL_API_TOKEN ?? randomBytes(32).toString('hex')

export const config = { ...parsed, gitHubAppPrivateKey, internalApiToken }
export type Config = typeof config
