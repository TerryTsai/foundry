import { z } from 'zod'
import { readFileSync } from 'node:fs'

const environment = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  FOUNDRY_STATE_PATH: z.string().default('./foundry-local.db'),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GITHUB_TOKEN: z.string().default(''),
  GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().default(''),
  OWNER_GITHUB_LOGIN: z.string().default(''),
  COOKIE_SECURE: z.string().default('false'),
  SANDBOX_RUNTIME: z.enum(['podman', 'docker']).default('podman'),
  SANDBOX_IMAGE: z.string().default('foundry-worker:latest'),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(1_200_000),
  OPENAI_API_KEY: z.string().default(''),
}).parse(process.env)

export const config = {
  port: environment.PORT,
  statePath: environment.FOUNDRY_STATE_PATH,
  githubClientId: environment.GITHUB_CLIENT_ID,
  githubClientSecret: environment.GITHUB_CLIENT_SECRET,
  githubToken: environment.GITHUB_TOKEN,
  githubAppId: environment.GITHUB_APP_ID,
  githubAppPrivateKey: environment.GITHUB_APP_PRIVATE_KEY_PATH ? readFileSync(environment.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8') : '',
  ownerGithubLogin: environment.OWNER_GITHUB_LOGIN,
  cookieSecure: environment.COOKIE_SECURE.toLowerCase() === 'true',
  sandboxRuntime: environment.SANDBOX_RUNTIME,
  sandboxImage: environment.SANDBOX_IMAGE,
  sandboxTimeoutMs: environment.SANDBOX_TIMEOUT_MS,
  openaiApiKey: environment.OPENAI_API_KEY,
}

export type Config = typeof config
