# TODO

Prototype status and remaining work. Intended to be picked up in a Codespace
(Node 20+). Nothing here needs installing beyond Node — the app has zero runtime
dependencies.

## ⚠️ No Actions workflows in this repo

Do **not** add `.github/workflows/` to this repo. It is a personal public repo and
workflow runs would eat into the personal Actions budget. This repo is **code only**,
referenced from elsewhere. End-to-end testing that needs a workflow lives in an
org-owned repo (e.g. `github/ericsciple-planning`), which references this code by
`@ref`. (Consider disabling Actions entirely in Settings → Actions to avoid default
setup features like CodeQL default setup also consuming budget.)

## Verify

- [ ] Run the unit tests: `npm test` (uses `node --test`; validator, context,
      operations, MCP core). No network, no deps.
- [ ] Smoke-test a server end to end against a throwaway issue:
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

## Remaining features (later)

- [ ] More operations (each is a small module under `src/operations/` + a registry
      entry): e.g. `create-pull-request`, `update-issue`. Lift schemas from gh-aw's
      `safe_outputs_tools.json`.
- [ ] Optional scope-widening args (e.g. `--allowed-labels`, `--max`, cross-repo)
      passed as flags after the operation id. Default stays narrowest (triggering
      object only).
- [ ] Sanitization of agent-supplied content beyond schema validation, if needed.
- [ ] Packaging so the harness can put `safe-outputs` on PATH (bin is declared in
      `package.json`; decide install/bundling in the harness).
