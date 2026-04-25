# @foundry/admin

The system-administration React SPA. Stubbed in v1 — content lands here as observability and admin features become real product needs (audit log explorer, account-level metrics, billing reconciliation, system health drill-downs).

This module owns: any UI that targets system administration rather than day-to-day project work. It does NOT own: the customer surface (that's `@foundry/site`), or backend logic.

The split exists so admin can be deployed independently, gated by stronger auth, or hidden from non-operator accounts later. Today site carries everything; expand admin as needs justify.

See `/ARCHITECTURE.md` for the rules and conventions.
