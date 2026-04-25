// Module-internal types for @foundry/sandbox.
//
// SandboxConfig is the minimal surface of the service-wide Config that
// sandbox needs. The route layer passes the full Config object; TS
// structural typing makes that compatible.

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
