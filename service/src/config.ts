import { z } from 'zod'
import { readFileSync } from 'fs'

const schema = z.object({
  port:                z.coerce.number().int().default(3000),
  dbPath:              z.string().default('./foundry.db'),
  repoBase:            z.string().default('/home/terry/repos'),
  sandboxImage:        z.string().default('foundry-sandbox'),
  sandboxTimeout:      z.coerce.number().int().default(300000),
  // Resource caps — every sandbox execution is bounded by these
  sandboxMemoryMb:     z.coerce.number().int().default(512),
  sandboxCpus:         z.coerce.number().default(1.0),
  sandboxPidsLimit:    z.coerce.number().int().default(128),
  sandboxNofileSoft:   z.coerce.number().int().default(1024),
  sandboxNofileHard:   z.coerce.number().int().default(2048),
  sandboxTmpfsMb:      z.coerce.number().int().default(64),
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
  cookieSecure:             z.coerce.boolean().default(true),
  sessionMaxAgeSec:         z.coerce.number().int().default(60 * 60 * 24 * 7),
})

const parsed = schema.parse({
  port:               process.env.PORT,
  dbPath:             process.env.DB_PATH,
  repoBase:           process.env.REPO_BASE,
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
  cookieSecure:            process.env.COOKIE_SECURE,
  sessionMaxAgeSec:        process.env.SESSION_MAX_AGE_SEC,
})

// Read the App private key eagerly so a malformed/missing path fails at boot,
// not on the first installation-token call. The PEM stays in memory.
const gitHubAppPrivateKey = parsed.gitHubAppPrivateKeyPath
  ? readFileSync(parsed.gitHubAppPrivateKeyPath, 'utf-8')
  : undefined

export const config = { ...parsed, gitHubAppPrivateKey }
export type Config = typeof config
