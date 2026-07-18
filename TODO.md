# TODO

Prototype status and remaining work. Intended to be picked up in a Codespace
(Node 20+). Nothing here needs installing beyond Node — the app has zero runtime
dependencies.

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

- The server reads `GITHUB_TOKEN` from its **process environment** and never from
  the MCP config. In the microVM harness this env is set **host-side** by the
  harness when it launches the server; the guest's MCP config must NOT contain the
  real token (that would expose it to the agent).
- For standalone/dev runs, set `GITHUB_TOKEN` yourself before launching.

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
