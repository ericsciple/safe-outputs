# TODO

Prototype status and remaining work. Intended to be picked up in a Codespace
(Node 20+). Nothing here needs installing beyond Node — the app has zero runtime
dependencies.

## Actions workflows

Workflows are now allowed in this repo (the earlier "no workflows / personal budget" restriction
was lifted). `.github/workflows/e2e.yml` runs the servers end-to-end on `ubuntu-latest`: it creates
a throwaway issue + branch, exercises `add-labels`, `add-comment`, `update-issue`, and
`create-pull-request` against real GitHub, verifies the effects, and cleans up. Trigger it manually
(`workflow_dispatch`).

## Verify

- [x] Run the unit tests: `npm test` (uses `node --test`; validator, config, sanitize,
      context, operations, MCP core). No network, no deps. 61 tests green.
- [x] Smoke-test the servers end to end against a throwaway issue — now automated in
      `.github/workflows/e2e.yml` (create issue/branch → add-labels/add-comment/update-issue/
      create-pull-request → verify → cleanup). Trigger via `workflow_dispatch`. Manual/local form:
  ```bash
  export GITHUB_TOKEN=<a token with issues:write>
  export GITHUB_REPOSITORY=you/scratch
  export GITHUB_EVENT_PATH=/tmp/event.json
  echo '{"issue":{"number":1}}' > /tmp/event.json
  # then send JSON-RPC lines to the server on stdin:
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_labels","arguments":{"labels":["triage"]}}}' \
    | node src/cli.js add-labels
  ```

## Token handling (important)

- The server reads `GITHUB_TOKEN` from its **process environment**, supplied the standard
  MCP way — the `env` block of its MCP server config, e.g.
  `"env": { "GITHUB_TOKEN": "${{ github.token }}" }`. Safe outputs are **not actions** and
  have **no inputs**; this is just how you give any MCP server a secret. (`${{ github.token }}`
  is expanded by Actions because the harness takes the MCP config as an action input.)
- Inside a sandboxing harness the server runs **host-side** with that env, and the harness
  keeps the secret out of the **guest's** copy of the config (the agent must never see it).
  This host-side / scrub behavior is the harness's job for *any* server with secrets — not
  special to safe outputs.
- For standalone/dev runs, set `GITHUB_TOKEN` in the environment when launching.

## Remaining features

- [x] More operations (each a small module under `src/operations/` + a registry entry):
      `update-issue` (title/body/state, target bound to the triggering issue) and
      `create-pull-request` (title/body/draft; head/base branch bound host-side). Schemas
      adapted from gh-aw's `safe_outputs_tools.json`, trimmed to intent-only fields.
- [x] Optional scope-widening flags parsed after the operation id (`src/config.js`), default
      stays narrowest: `add-labels --allowed-labels a,b,c --max N`, `add-comment --max-links N`.
- [x] Sanitization of agent-supplied content beyond schema validation (`src/sanitize.js`):
      strips control chars, normalizes CRLF, caps length, neutralizes `@mentions`. Wired into
      `add-comment`, `update-issue`, `create-pull-request` bodies/titles.
- [x] Packaging: `files` allowlist in `package.json` + README "Packaging" section. Deeper
      bundling/install-on-PATH decision is deferred to the harness (see open questions).

## Open questions (need @ericsciple input)

- **create-pull-request branch binding.** The prototype binds the head branch from
  `GITHUB_HEAD_BRANCH` and the base from `GITHUB_BASE_BRANCH`, both set host-side by the harness,
  and errors if they're missing (it does not guess "main"). Two things to confirm:
  1. Are those the env var names the microVM harness will actually set, or should this read the
     harness's own convention (and should base default to the repo's default branch via an API
     lookup when unset, instead of erroring)?
  2. Should `create-pull-request` be a safe output at all, vs. the harness opening the PR itself
     after the agent signals "done"? It's the one operation whose "target" (a new branch's diff)
     isn't the triggering object.
- **Scope-widening for cross-repo / base override.** The TODO mentioned cross-repo and base
  overrides. Left out for now (default = same repo, bound base). If wanted, add `--allowed-repos`
  / `--allowed-base` flags that turn a constrained `repo`/`base` into an *agent* input validated
  against the allow-list. Confirm whether cross-repo is in scope for the prototype.
- **Mention neutralization policy.** Currently ON by default for bodies (wraps `@name` in
  backticks). Confirm that's the desired default, or whether it should be opt-in via a flag.
- **Packaging in the harness.** `npm install -g .` / `npm link` works for dev. The harness needs
  to decide global-install vs. bundle vs. pinned `npx`/`@ref` for putting `safe-outputs` on the
  guest's PATH (this is the safe-outputs wiring item in the microvm-agent TODO).
