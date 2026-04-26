// Boundary validators for @foundry/auth. Zod schemas live here (and only
// here) so schema.ts and client.ts stay free of the zod runtime —
// type-only consumers don't drag the validator in.

import { z } from 'zod'

// GitHub OAuth callback query: ?code=...&state=...
// state is verified against the cookie set in /auth/github.
export const oauthCallbackQuery = z.object({
  code:  z.string().min(1),
  state: z.string().min(1),
})
export type OauthCallbackQuery = z.infer<typeof oauthCallbackQuery>
