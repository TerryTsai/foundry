import type { AccountId, Timestamp, Ulid } from '../primitives.js'

export type Account = {
  id:          AccountId
  github_id:   number
  login:       string
  name:        string | null
  email:       string | null
  avatar_url:  string | null
  description: string
  created_at:  Timestamp
  updated_at:  Timestamp
}

export type AuthSession = {
  id:         Ulid
  account_id: AccountId
  created_at: Timestamp
  expires_at: Timestamp
}
