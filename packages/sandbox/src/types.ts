// Module-internal types for @foundry/sandbox.
//
// SandboxConfig is the minimal surface of the service-wide Config that
// sandbox needs. The route layer passes the full Config object; TS
// structural typing makes that compatible.

import type { Db, Execution, Session } from '@foundry/db'

export interface SandboxConfig {
  port:               number
  sandboxImage:       string
  sandboxTimeout:     number
  sandboxMemoryMb:    number
  sandboxCpus:        number
  sandboxPidsLimit:   number
  sandboxNofileSoft:  number
  sandboxNofileHard:  number
  sandboxTmpfsMb:     number
  internalApiToken:   string
}

// Cross-module callback bag — sandbox can't import @foundry/crud, so the
// composition root binds these from crud's helpers.

export interface SandboxCrudOps {
  // reads
  sessionGetById:       (db: Db, id: string) => Session | undefined
  executionList:        (db: Db, accountId: string) => Execution[]
  executionBySession:   (db: Db, sessionId: string) => Execution[]
  sessionsForTicketRaw: (db: Db, ticketId: string) => Session[]
  // writes — execution metering
  executionMeterCreate: (db: Db, input: ExecutionMeterCreateInput) => Execution
  executionMeterUpdate: (db: Db, id: string, data: Record<string, unknown>) => Execution
  executionMarkCancelled: (db: Db, id: string) => Execution
}

export interface ExecutionMeterCreateInput {
  session_id?:  string | null
  tool_name?:   string | null
  tool_input?:  string | null
  tool_use_id?: string | null
  command:      string
  status:       string
  timeout_ms:   number
  memory_mb?:   number | null
  started_at:   string
}
