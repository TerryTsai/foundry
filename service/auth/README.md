# @foundry/auth

GitHub OAuth login flow, cookie-backed session lookup, per-session sandbox JWT mint/verify, the express middleware that resolves a session/bearer token to an Account, and a tiny in-memory rate limiter used in front of the auth surface. OAuth provider calls (authorize URL build, code exchange, /user fetch) are injected as callbacks because logic modules cannot import other logic modules. Does NOT own the express route handlers (those live in the composition root) or any GitHub App / installation-token logic — that belongs to @foundry/mcp.

See /ARCHITECTURE.md for the conventions every module follows.
