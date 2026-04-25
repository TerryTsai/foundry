// Empty for now. Methods land here as the auth module migrates in Phase 4a.
//
// Method shape:
//   methodName(ctx: Ctx, ...args): Promise<Result<T, AuthError>>
// Streaming:
//   methodNameStream(ctx: Ctx, ...args): AsyncIterable<Result<T, AuthError>>

export type AuthSlice = Record<string, never>
