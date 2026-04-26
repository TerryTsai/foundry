# @foundry/billing

Quota and cost accounting for accounts. Stubbed in v1 — every quota check returns unlimited; no usage is recorded. The surface is locked now so callers (reconciler, engine, crud) can take dependencies on it without churn when the real implementation lands.

This module owns: quota policies, usage recording, billing reconciliation. It does NOT own: pricing display (that's analytics), payment processing (external), session execution (engine).

See `/ARCHITECTURE.md` for the rules and conventions.
