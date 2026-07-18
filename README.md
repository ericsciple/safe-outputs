# safe-outputs

Context-aware MCP servers that apply narrowly-scoped GitHub writes — **safe outputs** — for
sandboxed AI agents.

A sandboxed agent should never hold a write token. Instead it *proposes* a specific outcome
("add these labels", "post this comment") by calling a tool, and a trusted server performs
exactly that one write, scoped to the issue or pull request the workflow is running on. This
repo provides those servers.

Each safe output is an **ordinary MCP server** (stdio). One app, a subcommand per operation:

```
safe-outputs add-labels          # MCP server exposing the add_labels tool
safe-outputs add-comment         # MCP server exposing the add_comment tool
safe-outputs update-issue        # MCP server exposing the update_issue tool
safe-outputs create-pull-request # MCP server exposing the create_pull_request tool
```

## How it's used

A workflow (or a harness) adds a safe output to its MCP configuration like any other MCP
server — including giving it the token via the server's `env`, exactly as you would any MCP
server that needs a secret. For the Copilot CLI's MCP JSON:

```json
{
  "mcpServers": {
    "labeler": {
      "command": "safe-outputs",
      "args": ["add-labels"],
      "env": { "GITHUB_TOKEN": "${{ github.token }}" }
    },
    "commenter": {
      "command": "safe-outputs",
      "args": ["add-comment"],
      "env": { "GITHUB_TOKEN": "${{ github.token }}" }
    }
  }
}
```

The name (`labeler`, `commenter`) is just the agent's handle; you can name them anything unique.
These are **not actions** and have **no inputs** — the token reaches them through the standard
MCP `env` mechanism. When they run inside a sandboxing harness, the harness keeps that secret
host-side (see Design), so the agent never sees it.

## Design

- **Host-side only.** These servers run on the trusted side (the runner host), never inside the
  agent's sandbox. They receive the job token the standard MCP way (the server's `env`) and read
  the event payload from the host; inside a sandbox harness both are kept host-side, so the agent
  sees neither.
- **Target is bound, not chosen.** The server reads `GITHUB_EVENT_PATH` to find the triggering
  issue/PR. The advertised tool schema exposes only the *intent* (which labels, what comment) —
  there is no `issue_number`/`repo` field, so the agent cannot widen the target.
- **Apply immediately.** On a tool call the server validates the arguments against the tool's
  JSON Schema, then performs exactly that one write with the job token and returns the result.
  Validation failures come back as actionable errors so the model can self-correct.
- **One operation per process.** Each server does exactly one thing (add labels, add a comment),
  so least privilege is structural — there is no code path to do anything else.

## Operations

| Operation | Tool | Arguments | Effect |
|---|---|---|---|
| `add-labels` | `add_labels` | `labels: string[]` | Add labels to the triggering issue/PR |
| `add-comment` | `add_comment` | `body: string` | Comment on the triggering issue/PR |
| `update-issue` | `update_issue` | `title?`, `body?`, `state?` (≥1) | Edit the triggering issue's title/body/state |
| `create-pull-request` | `create_pull_request` | `title`, `body`, `draft?` | Open a PR from the harness-prepared branch |

Every tool schema exposes only the *intent*. The target — which issue/PR, which repo, and (for
`create-pull-request`) which head/base branch — is bound host-side from the environment, never
from an agent argument.

## Scope-widening flags

Safe outputs default to the narrowest scope. A workflow author can opt into a slightly wider
scope with flags placed **after the operation id** — the harness puts them on the command line,
so the agent never sees or controls them:

```
safe-outputs add-labels --allowed-labels bug,triage,question --max 3
safe-outputs add-comment --max-links 10
```

| Flag | Operation | Effect |
|---|---|---|
| `--allowed-labels a,b,c` | `add-labels` | Reject any label not in the allow-list |
| `--max N` | `add-labels` | Reject calls adding more than N labels |
| `--max-links N` | `add-comment` | Reject a comment body with more than N links |

## Sanitization

Body and title content the agent supplies is sanitized before it becomes a durable GitHub
artifact (see `src/sanitize.js`): control characters are stripped, CRLF is normalized, the text
is length-capped, and `@mentions` are neutralized (wrapped in backticks) so a privileged
host-side writer can't be used to mass-notify people or ping teams. Legitimate Markdown is left
intact.

## Environment

- `GITHUB_TOKEN` — the token used to apply the write. Supplied via the server's MCP `env` block
  (like any MCP server secret); held host-side.
- `GITHUB_EVENT_PATH` — path to the event payload JSON (provided by Actions).
- `GITHUB_REPOSITORY` — `owner/repo` (provided by Actions; falls back to the payload).
- `GITHUB_HEAD_BRANCH` — for `create-pull-request`: the branch holding the agent's committed
  changes (set by the harness).
- `GITHUB_BASE_BRANCH` — for `create-pull-request`: the branch the PR should target.
- `GITHUB_API_URL` — optional, for GitHub Enterprise Server.

## Packaging

The `bin` entry (`safe-outputs`) is declared in `package.json`, and `files` restricts what is
published to `src/` + the README. To put the CLI on `PATH` for local/dev use:

```bash
npm install -g .   # or: npm link
```

In a workflow, use the **setup action** to put `safe-outputs` on the runner PATH the Actions way,
then reference it as an MCP server (e.g. from the `microvm-agent` harness):

```yaml
- uses: ericsciple/safe-outputs/setup@v1     # installs the safe-outputs CLI on PATH
- uses: ericsciple/microvm-agent@v1
  with:
    prompt: "Triage this issue and apply the most relevant label."
    mcp-config: |
      { "mcpServers": { "labeler": {
          "command": "safe-outputs", "args": ["add-labels"],
          "env": { "GITHUB_TOKEN": "${{ github.token }}" } } } }
```

`setup@<ref>` installs the matching CLI version; pass `with: { version: <ref> }` to override.
Inside the microVM harness the server runs host-side and is delivered to the guest as a shim, so
the token never enters the sandbox.

## Development

Requires Node.js 20+. Zero runtime dependencies (built-in `fetch`, `node:test`, stdio).

```bash
npm test        # runs the unit tests (node --test)
```

## Status

Prototype. Part of a microVM agent harness exploration; see the `microvm-agent` action.
