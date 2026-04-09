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
})

export const config = schema.parse({
  port:              process.env.PORT,
  dbPath:            process.env.DB_PATH,
  repoBase:          process.env.REPO_BASE,
  sandboxImage:      process.env.SANDBOX_IMAGE,
  sandboxTimeout:    process.env.SANDBOX_TIMEOUT,
  sandboxMemoryMb:   process.env.SANDBOX_MEMORY_MB,
  sandboxCpus:       process.env.SANDBOX_CPUS,
  sandboxPidsLimit:  process.env.SANDBOX_PIDS_LIMIT,
  sandboxNofileSoft: process.env.SANDBOX_NOFILE_SOFT,
  sandboxNofileHard: process.env.SANDBOX_NOFILE_HARD,
  sandboxTmpfsMb:    process.env.SANDBOX_TMPFS_MB,
})

export type Config = typeof config
