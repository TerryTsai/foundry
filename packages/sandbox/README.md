# @foundry/sandbox

Persistent per-session podman containers and the unified execution path that every sandbox-bound tool call routes through. Owns container lifecycle (lazy start, sticky workspace mount, SIGTERM cleanup), the exec wrapper that captures cgroup cpu and net deltas, secret scrubbing on captured stdout/stderr, and the execution row write/finalize. Folds in execution metering for v1 per the borderline-decision note in ARCHITECTURE.md. Does NOT own MCP tool definitions, route handlers, the reconciler tick, or ownership/permission checks — ownership lookups are passed in as callbacks because logic modules cannot import other logic modules.

See /ARCHITECTURE.md for the conventions every module follows.
