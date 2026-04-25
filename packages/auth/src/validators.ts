import { z } from 'zod'

// GitHub OAuth callback query: ?code=...&state=...
// state is verified against the cookie set in /auth/github.
export const authCallback = z.object({
  code:  z.string().min(1),
  state: z.string().min(1),
})
