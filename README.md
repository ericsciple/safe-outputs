# safe-outputs

Context-aware MCP servers that apply narrowly-scoped GitHub writes — **safe outputs** — for
sandboxed AI agents.

A sandboxed agent should never hold a write token. Instead it *proposes* a specific outcome
("add these labels", "post this comment") by calling a tool, and a trusted server performs
exactly that one write, scoped to the issue or pull request the workflow is running on. This
repo provides those servers.

Each safe output is an **ordinary MCP server** (stdio). One app, a subcommand per operation:

```
safe-outputs add-labels     # MCP server exposing the add_labels tool
safe-outputs add-comment    # MCP server exposing the add_comment tool
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

## Environment

- `GITHUB_TOKEN` — the token used to apply the write. Supplied via the server's MCP `env` block
  (like any MCP server secret); held host-side.
- `GITHUB_EVENT_PATH` — path to the event payload JSON (provided by Actions).
- `GITHUB_REPOSITORY` — `owner/repo` (provided by Actions; falls back to the payload).
- `GITHUB_API_URL` — optional, for GitHub Enterprise Server.

## Operations

| Operation | Tool | Arguments | Effect |
|---|---|---|---|
| `add-labels` | `add_labels` | `labels: string[]` | Add labels to the triggering issue/PR |
| `add-comment` | `add_comment` | `body: string` | Comment on the triggering issue/PR |

## Development

Requires Node.js 20+. Zero runtime dependencies (built-in `fetch`, `node:test`, stdio).

```bash
npm test        # runs the unit tests (node --test)
```

## Status

Prototype. Part of a microVM agent harness exploration; see the `microvm-agent` action.
