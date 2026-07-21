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
| `remove-labels` | `remove_labels` | `labels: string[]` | Remove labels from the triggering issue/PR |
| `replace-labels` | `replace_labels` | `labels: string[]` | Set the triggering issue/PR's labels to exactly this set |
| `add-comment` | `add_comment` | `body: string` | Comment on the triggering issue/PR |
| `update-issue` | `update_issue` | `title?`, `body?`, `state?` (≥1) | Edit the triggering issue's title/body/state |
| `close-issue` | `close_issue` | `body?`, `state_reason?` | Close the triggering issue (optional closing comment) |
| `create-issue` | `create_issue` | `title`, `body`, `labels?` | Create a new issue in the repo |
| `assign-to-user` | `assign_to_user` | `assignees: string[]` | Assign users to the triggering issue/PR |
| `unassign-from-user` | `unassign_from_user` | `assignees: string[]` | Remove assignees from the triggering issue/PR |
| `assign-milestone` | `assign_milestone` | `milestone: string` (number or title) | Assign a milestone to the triggering issue/PR |
| `create-discussion` | `create_discussion` | `title`, `body`, `category?` | Create a GitHub Discussion (GraphQL) |
| `update-discussion` | `update_discussion` | `discussion_number`, `title?`, `body?` | Edit a discussion's title/body (GraphQL) |
| `close-discussion` | `close_discussion` | `discussion_number`, `reason?` | Close a discussion (GraphQL) |
| `hide-comment` | `hide_comment` | `comment_id` (node id), `reason?` | Minimize/hide a comment (GraphQL) |
| `create-pull-request` | `create_pull_request` | `title`, `body`, `draft?` | Open a PR from the harness-prepared branch |
| `update-pull-request` | `update_pull_request` | `title?`, `body?`, `state?` (≥1) | Edit the triggering PR's title/body/state |
| `close-pull-request` | `close_pull_request` | `body?` | Close (without merging) the triggering PR |
| `merge-pull-request` | `merge_pull_request` | `merge_method?`, `commit_title?`, `commit_message?` | Merge the triggering PR |
| `mark-pull-request-ready-for-review` | `mark_pull_request_ready_for_review` | — | Take the triggering PR out of draft (GraphQL) |
| `request-reviewers` | `request_reviewers` | `reviewers?`, `team_reviewers?` | Request reviewers on the triggering PR |
| `submit-pull-request-review` | `submit_pull_request_review` | `event`, `body?` | Submit a review (COMMENT / APPROVE / REQUEST_CHANGES) |
| `create-pull-request-review-comment` | `create_pull_request_review_comment` | `path`, `line`, `body`, `start_line?`, `side?` | Inline review comment on the triggering PR's diff |
| `resolve-pull-request-review-thread` | `resolve_pull_request_review_thread` | `thread_id` (node id) | Resolve a PR review thread (GraphQL) |
| `dispatch-workflow` | `dispatch_workflow` | `workflow`, `ref?`, `inputs?` | `workflow_dispatch` an allow-listed workflow |
| `dispatch-repository` | `dispatch_repository` | `event_type`, `client_payload?` | Fire an allow-listed `repository_dispatch` event |

Every tool schema exposes only the *intent*. The target — which issue/PR, which repo, and (for
`create-pull-request`) which head/base branch — is bound host-side from the environment, never
from an agent argument.

## Scope-widening flags

Safe outputs default to the narrowest scope. A workflow author can opt into a slightly wider
scope with flags placed **after the operation id** — the harness puts them on the command line,
so the agent never sees or controls them:

```
safe-outputs add-labels --allowed bug,triage,question --max 3
safe-outputs add-comment --max-links 10 --no-footer
```

| Flag | Operation | Effect |
|---|---|---|
| `--allowed a,b,c` | `add-labels`, `remove-labels`, `replace-labels`, `assign-to-user`, `request-reviewers` | Reject any label/user not in the allow-list (glob patterns OK) |
| `--blocked a,*[bot]` | `add-labels`, `remove-labels`, `replace-labels` | Reject any label matching the block-list (glob patterns OK) |
| `--max N` | all | Cap at N **calls per run** (also caps labels per call for label ops). `-1` = unlimited |
| `--max-links N` | `add-comment` | Reject a comment body with more than N links |
| `--allowed-domains a.com,b.com` | body ops | **Opt-in**: reject body text that links to a domain not in the list |
| `--target triggering\|*\|<n>` | issue ops | Which object to act on. Default `triggering`; `*` lets the agent pass `item_number`; `<n>` pins a number |
| `--target-repo owner/repo` | all | Act on another repo (must be same-repo or in `--allowed-repos`) |
| `--allowed-repos o/r,o/r2` | all | Allow-list for cross-repo `--target-repo` (default deny) |
| `--allowed-labels a,b` | `create-issue` | Gate the agent-supplied labels on the new issue (glob patterns OK) |
| `--labels a,b` | `create-issue`, `create-pull-request` | Author-set labels always applied to the new issue/PR |
| `--assignees u1,u2` | `create-issue` | Auto-assign the new issue |
| `--reviewers u1,u2` | `create-pull-request` | Request reviewers on the new PR |
| `--title-prefix "<s>"` | `create-issue`, `create-discussion` | Prefix the agent's title (e.g. `"[bot] "`) |
| `--category name` | `create-discussion` | Pin the discussion category (else the workflow's default / first) |
| `--allow-body true\|false` | `close-issue`, `close-pull-request` | Allow an agent-supplied closing comment (default `true`) |
| `--merge-method merge\|squash\|rebase` | `merge-pull-request` | Pin the merge method (agent can't override) |
| `--allowed-events approve,comment` | `submit-pull-request-review` | Which review events are permitted (default: `comment` only) |
| `--allowed-workflows a.yml,b.yml` | `dispatch-workflow` | **Required** allow-list of dispatchable workflows (default deny) |
| `--allowed-event-types a,b` | `dispatch-repository` | **Required** allow-list of `repository_dispatch` types (default deny) |
| `--footer` / `--no-footer` / `--footer-text "<tmpl>"` | body ops | Attribution footer (default **on**); `{workflow}`/`{run_url}`/`{repo}` placeholders |

Run-wide `--max` needs a per-instance state dir; the harness supplies it via the `MCP_STATE_DIR`
env var (each configured MCP server instance gets its own, so the same server added twice counts
separately). Without it, the CLI falls back to a best-effort dir under `RUNNER_TEMP`.

## Sanitization

Body and title content the agent supplies is sanitized before it becomes a durable GitHub
artifact (see `src/sanitize.js`). Applied everywhere: Unicode NFC normalization, control-character
and zero-width-character removal, and CRLF normalization. Applied **outside code regions** (fenced
```` ``` ```` blocks and inline `` `code` `` are left intact): `@mentions` are neutralized (wrapped
in backticks) so a privileged host-side writer can't mass-notify people or ping teams, and dangerous
raw HTML (`<script>`/`<iframe>`/`<object>`/`<style>`/`on*=` handlers, …) is stripped. Oversized
content is **rejected** (not silently truncated) against a per-field max length. Optionally, with
`--allowed-domains`, any body linking to a domain outside the allow-list is rejected. Legitimate
Markdown is left intact. (Some further defenses — slash-command escaping, closing-keyword defang —
are tracked as future work in `docs/parity-gh-aw.md` §4.1.)

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
- uses: ericsciple/safe-outputs/setup@v1     # puts safe-outputs on PATH (job-scoped)
- uses: ericsciple/microvm-agent@v1
  with:
    prompt: "Triage this issue and apply the most relevant label."
    mcp-config: |
      { "mcpServers": { "labeler": {
          "command": "safe-outputs", "args": ["add-labels"],
          "env": { "GITHUB_TOKEN": "${{ github.token }}" } } } }
```

`setup@<ref>` uses the repo already checked out at that ref (no re-download; version matches the
ref). It's a **Node.js action**, so it uses the runner's own Node (`process.execPath`, from
externals) — it bakes that absolute path into a tiny wrapper and puts the wrapper on `$GITHUB_PATH`
(job-scoped). So it needs **no `setup-node`** (the CLI runs under the runner's guaranteed Node) and
does **no global `npm install -g`** (which would leak across jobs on self-hosted runners). Since
safe-outputs is zero-dependency, nothing is installed at all. Inside the microVM harness the server
runs host-side and is delivered to the guest as a shim, so the token never enters the sandbox.

## Development

Requires Node.js 20+. Zero runtime dependencies (built-in `fetch`, `node:test`, stdio).

```bash
npm test        # runs the unit tests (node --test)
```

## Status

Prototype. Part of a microVM agent harness exploration; see the `microvm-agent` action.
