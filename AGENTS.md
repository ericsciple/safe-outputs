# AGENTS.md — safe-outputs

Instructions for AI coding agents working in this repository.

Before changing this repository, read **`docs/design-principles.md`**. It lists the core
invariants (one narrow tool per server, target bound host-side, safe-by-default, sanitize +
reject-inline, zero runtime dependencies).

**Heavy-change rule (do not skip):** You **must not** modify, weaken, or work around any core
design principle without **explicit human agreement** that names the specific principle and
acknowledges the change is a deliberate, heavy decision. If a task appears to require violating a
principle, **stop and surface it as a finding** — do not quietly route around it. Convenience is
never sufficient justification. When a principle legitimately changes, update
`docs/design-principles.md` in the same change with the rationale.

Other conventions:
- Zero runtime dependencies — built-ins only (`fetch`, `node:test`, stdio). Adding a dependency is
  a deliberate decision.
- Each operation is one MCP server exposing one tool; the agent supplies intent, never the target.
- Parity direction and locked decisions live in `docs/parity-gh-aw.md`; consult it before adding or
  changing operations.
- Tests: `npm test`.
