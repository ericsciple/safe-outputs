# Core design principles — safe-outputs

> **These are core invariants, not style preferences.** An AI agent (or human) **must not
> modify, weaken, or work around any principle here without explicit human agreement**
> that names the specific principle and acknowledges the change is a deliberate, heavy
> decision. See [Changing a principle](#changing-a-principle). If a task seems to require
> violating one, **stop and surface it** — the violation is the finding.

## What safe-outputs is

A set of small, zero-runtime-dependency MCP servers. Each applies **one** narrowly-scoped
GitHub write with a token supplied host-side. The agent expresses *intent* ("add these
labels", "open a PR with this body"); it never chooses the target. These run host-side
(in the microvm-agent harness, or standalone) — never inside the sandbox.

---

## Principles

1. **One safe output = one MCP server = one narrow tool.** Each operation does exactly
   one thing, so least privilege is structural: there is no code path in a given server
   to do anything beyond its single write. Don't merge unrelated writes into one tool.

2. **The tool schema exposes only intent; the target is bound host-side.** Which issue/PR,
   which repo, and (for `create-pull-request`) the generated head branch + base branch are
   resolved from the environment/event context — **never** from an agent-supplied
   argument. The agent literally cannot address a different object through the schema.
   (`src/context.js`, `src/targets.js`, `src/branches.js`.)

3. **Safe by default; widening is author-only.** The narrowest scope is the default.
   Scope-widening (`--target`, `--target-repo`/`--allowed-repos`, `--base-branch`,
   allow-lists, `--max`) is supplied by the **workflow author** on the command line and is
   never agent-settable. A safer default is preferred even when it's less convenient.

4. **Durable content is sanitized; policy violations are rejected inline.** Body/title
   text becomes a permanent GitHub artifact, so it's sanitized before the write
   (NFC/zero-width/control normalization; code-region-aware `@mention` + dangerous-HTML
   neutralization). Author-policy violations (oversize, disallowed domain/label,
   over-limit) are **rejected** (the agent sees the error and can retry) — not silently
   truncated or mutated. (`src/sanitize.js`, `src/validate.js`, `src/domains.js`.) The
   locked reject-vs-transform split lives in `docs/parity-gh-aw.md` §4.1.

5. **The credential stays host-side.** Each server receives its token via its MCP `env`
   block and uses it host-side. The token is never written into anything the guest reads.
   (This is the safe-outputs half of the harness's "no credential in the guest" invariant.)

6. **File-changing outputs use the `additions`/`deletions` schema contract.** `create-pull-request`
   / `push-to-pull-request-branch` take whole-file `additions:[{path,contents(base64)}]`
   and `deletions:[{path}]` and commit them via GraphQL `createCommitOnBranch` (one signed
   commit). The caller (agent) provides the file bytes per the schema; the server does not
   reach into any workspace. Branch is generated host-side; base is the repo default
   branch. (`src/changeset.js`, `src/operations/create-pull-request.js`.)

7. **Zero runtime dependencies.** The servers use only built-ins (`fetch`, `node:test`,
   stdio). Adding a runtime dependency is a deliberate decision, not a convenience.

8. **Parity is measured against gh-aw, deliberately.** New operations and behaviors are
   evaluated against `github/gh-aw` safe outputs and recorded in `docs/parity-gh-aw.md`
   before building. We adopt gh-aw's proven semantics unless our stronger-isolation model
   justifies a safer default (documented when we differ).

---

## Changing a principle

A principle changes **only** with explicit, unambiguous human sign-off that names the
principle and acknowledges it's a heavy, deliberate decision — obtained **before**
implementing, not bundled into an unrelated change. "It was easier" or "the test needed
it" is never sufficient. Update this doc, with rationale, in the same change.
