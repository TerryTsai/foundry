import { z } from 'zod'

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
  // Auth — GitHub OAuth + cookie session
  gitHubClientId:      z.string().min(1),
  gitHubClientSecret:  z.string().min(1),
  publicBaseUrl:       z.string().url(),
  ownerGitHubLogin:    z.string().optional(),
  cookieSecure:        z.coerce.boolean().default(true),
  sessionMaxAgeSec:    z.coerce.number().int().default(60 * 60 * 24 * 7),
})

export const config = schema.parse({
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
  gitHubClientId:     process.env.GITHUB_CLIENT_ID,
  gitHubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  publicBaseUrl:      process.env.PUBLIC_BASE_URL,
  ownerGitHubLogin:   process.env.OWNER_GITHUB_LOGIN,
  cookieSecure:       process.env.COOKIE_SECURE,
  sessionMaxAgeSec:   process.env.SESSION_MAX_AGE_SEC,
})

export type Config = typeof config
