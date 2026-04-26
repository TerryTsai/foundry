import type { AccountId, ProjectId, Timestamp } from '../primitives.js'

export type Project = {
  id:          ProjectId
  owner_id:    AccountId
  repo:        string
  name:        string
  description: string
  status:      string
  max_agents:  number
  created_at:  Timestamp
  updated_at:  Timestamp
}
