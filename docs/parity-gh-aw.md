# Parity analysis: `safe-outputs` vs. gh-aw safe outputs

A feature-by-feature comparison of this repo's safe outputs against
[`github/gh-aw`](https://github.com/github/gh-aw) (GitHub Agentic Workflows) "safe outputs",
recorded so we can decide **one item at a time** what's worth adopting. Nothing here is a
commitment — it's a map of the gaps.

- **Our surface:** 4 operations — `add-labels`, `add-comment`, `update-issue`, `create-pull-request`.
- **gh-aw surface:** ~45 safe-output types.
- **Snapshot date:** 2026-07-19 (inventory); direction/decisions added 2026-07-20. gh-aw refs are from
  its default branch (safe-outputs spec v1.26.0, `pkg/workflow/safe_output_handlers.go`,
  `safe_outputs_config_types.go`, `docs/.../safe-outputs-specification.md`). gh-aw evolves quickly;
  re-verify before acting.

> **Framing:** the biggest differences are (1) **breadth** (4 ops vs ~45) and (2) **content
> sanitization depth**. Architecturally we're aligned (the agent never holds a write token). Our
> **sandbox isolation is stronger** — the agent runs in a hardware microVM with no credentials and
> gateway-enforced egress, and the write target is hardcoded to the triggering object.

---

## 1. Delivery / architecture — aligned, different tradeoffs

| Aspect | gh-aw | us |
|---|---|---|
| Token isolation | Agent runs read-only; writes happen in a **separate privileged job** | Agent has **no token at all** (runs in a microVM); writes applied **host-side** |
| Transport | MCP gateway (container) → **NDJSON artifact** → download in a processor job | Host-side MCP server, invoked **inline per call** by the harness |
| Enforcement points | **Dual** (MCP gateway + processor job) | Single (host-side server) |
| Preview | **`staged`** mode (dry-run: render instead of write) | ❌ none |
| Threat scan | **LLM threat-detection** pass before writes — a second model classifies the proposed outputs and either **warns** (annotates reviewable types: comments/issues) or **aborts** (destructive types: close/merge/label) | ❌ none (worth considering; see §7) |
| Integrity | Frontmatter **SHA-256** policy hash re-verified at exec | N/A (config is host-side, not agent-reachable) |

**Our edge:** hardware microVM + gateway-enforced egress + the write target is **hardcoded to the
triggering issue/PR** (the agent can't even express a different target in the tool schema). gh-aw
relies on a read-only token + OS sandbox.
**Gaps worth noting:** no `staged`/dry-run mode; no threat-detection pass.

---

## 2. Operation coverage — the largest gap

We implement **4**; gh-aw has ~45. Grouped by how relevant they are to us:

**High-value, common — strong candidates:**
- `create-issue` — arguably the single most-used safe output. **We lack it.**
- `create-discussion`, `close-issue`, `remove-labels`, `push-to-pull-request-branch`.

**System / "mandatory" in gh-aw (cheap, useful) — we have none:**
- `missing-tool` — agent reports a capability it needed but didn't have (great signal).
- `missing-data`, `noop`, `report-incomplete`.

**Niche / heavy — probably skip for now (~25 types):**
- Projects (`create-project`, `update-project`, `create-project-status-update`), code scanning
  (`create-code-scanning-alert`, `autofix-code-scanning-alert`), releases (`update-release`),
  assets (`upload-asset`, `upload-artifact`), dispatch (`dispatch-workflow`, `dispatch_repository`,
  `call-workflow`), PR review flow (`create-pull-request-review-comment`,
  `submit-pull-request-review`, `resolve-pull-request-review-thread`,
  `reply-to-pull-request-review-comment`, `dismiss-pull-request-review`,
  `mark-pull-request-as-ready-for-review`), `merge-pull-request`, `update-pull-request`,
  `close-pull-request`, labels (`replace-label`), issue meta (`set-issue-type`, `set-issue-field`,
  `link-sub-issue`, `assign-milestone`, `assign-to-agent`, `assign-to-user`, `unassign-from-user`,
  `add-reviewer`), `hide-comment`, `comment-memory`, `create-check-run`, `create-agent-session`,
  `update-discussion`, `close-discussion`.

---

## 3. Per-operation configuration richness — gaps

What we have per operation today: `add-labels` → `--allowed-labels`, `--max`; `add-comment` →
`--max-links`; `create-pull-request` → `draft` (head/base/repo fixed by the harness); `update-issue`
→ title/body/state.

gh-aw per-type options we **don't** have:

| gh-aw option | What it does | Note for us |
|---|---|---|
| `target` (`triggering` / `*` / explicit number / expr) | Which object to act on | We hardcode **triggering** (a deliberate least-privilege default). `*`/explicit could be an author opt-in flag (never agent-settable). |
| `target-repo` + `allowed-repos` | **Cross-repo** writes with an allowlist | We're single-repo (triggering) only. **Decision:** we can add these as **author-supplied flags**, but the **default must stay "the object from the event payload"** — widening scope is always an explicit opt-in, never agent-reachable. |
| `max` (per type, op-count) | Cap **how many times** the agent may invoke that op in a run (e.g. create ≤1 issue, ≤3 label calls) | **Not the same as our `--max`**, which caps labels/links **per single call** — the agent could still call the tool many times. A run-wide op-count needs external state (see §5), since microvm-agent spawns a fresh `safe-outputs <op>` process per call. |
| `title-prefix` | Prepend to every issue/PR title | — |
| `labels` (auto-apply) | Labels added to every created issue/PR | We only have `allowed-labels` on `add-labels`. |
| `assignees`, `reviewers` | Auto-assign | — |
| `staged` | Preview/dry-run | See §1. |
| `footer` / `messages.*` | Footer + templated status messages | — |
| `github-token` per handler | Per-handler credential | **We already have this** — each safe-output MCP server is added with its own `env: { GITHUB_TOKEN: ... }` in `mcp-config`, and `createGitHubClient` uses exactly that (`src/github.js:16`). **Not a gap.** |
| `github-app` per handler | Mint a short-lived **installation** token from an App id + private key | **Not a gap for us** — this is what the composable [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) action already does. A customer runs it in their workflow YAML and passes the resulting token into the MCP server's `env` block. No need to build App-minting into safe-outputs. |

---

## 4. Content sanitization — real gaps (the output is durable regardless of the sandbox)

Even though our agent is sandboxed, safe-output text becomes a **permanent GitHub artifact**, so
content sanitization still matters. What each side does:

**Us (`src/sanitize.js`):**
- Strip C0 control chars + DEL (keep tab/newline); normalize CRLF→LF.
- **Neutralize @mentions** by backtick-wrapping (keeps text visible, no notification).
- Length caps (65,536 body / 256 title); **count** links for an optional `--max-links` cap.

**gh-aw additionally does (we lack these):**
- **Unicode NFC normalization + zero-width char removal** (U+200B/200C/200D/FEFF) — anti-spoofing.
- **HTML tag filtering** — strip `<script>`, `<iframe>`, `<object>`, `<embed>` and `on*` handler
  attributes; keep safe GFM tags (`<details>`, `<summary>`, `<sub>`, `<sup>`, `<kbd>`).
- **URL domain allow-listing** (`allowed-domains`) + **protocol filtering** (only `http`/`https`/
  `mailto`); redact offenders (`[URL redacted: unauthorized domain]`) and log them. We only *count*
  links.
- **Slash-command neutralization** — escape line-start `^/command` → `\/command`.
- **XML-comment removal** (`<!-- -->`) + **code-fence balancing** (close unterminated ``` blocks).
- **Closing-keyword normalization** (defang `fixes #123` via backtick stripping) + **bot-mention cap**
  (`max-bot-mentions`).
- **Truncation marker** — append `[Content truncated...]` (we truncate silently).
- **Configurable @mention allowlists** (collaborators / teams / event context). We neutralize *all*
  mentions (simpler; arguably a safer default, but less flexible).

### 4.1 When sanitization runs — and why our model can *reject* instead of transform

- **gh-aw runs it at BOTH ends:** synchronously at the MCP gateway (tool-call time → the model gets
  immediate feedback) **and** in the async processor job (defense-in-depth, after the agent process is
  gone). Because the processor runs when the **agent no longer exists**, it can't ask the agent to fix
  anything, so there it **transforms** (redacts URLs, neutralizes mentions) rather than rejecting.
- **We run fully inline and synchronous:** the agent's `tools/call` blocks on our host-side response,
  so we **can return an actionable error and the agent self-corrects on its next turn**. That's an
  advantage of the inline model. Direction:
  - **Reject** (return `isError` with a fix hint) for policy violations the agent *should* fix:
    disallowed URL domain, too many links/mentions, oversized body, disallowed label.
  - **Transform silently** only for harmless normalizations where a reject would be pointless noise:
    control-char strip, CRLF→LF, Unicode NFC / zero-width removal, `<script>`/HTML stripping.
  - **@mentions** are the judgment call: reject ("remove or code-quote the @mention") is cleaner and
    more transparent than silently backtick-wrapping, but chattier. Undecided — lean reject.

---

## 5. Validation

- gh-aw: a 7-stage pipeline (schema → **op-count limits** → sanitization → **domain filter** →
  **cross-repo allowlist** → temp-id/dependency resolution → API), enforced at **both** the MCP
  gateway (immediate model feedback) and the processor (defense in depth).
- Us: JSON-schema validation (shape, `required`, `additionalProperties:false`, `minProperties`) at
  tool-call time + host-side apply; per-call caps (`--max`, `--max-links`); target bound from event
  context. No **run-wide op-count** cap, no cross-repo allowlist, single enforcement point (adequate
  given our isolation model).
- **Op-count wrinkle:** our server is invoked as a fresh `safe-outputs <op>` process **per call**
  (stateless), so a run-wide "at most N `create_issue` calls" needs **external state** — e.g. a small
  counter file under `RUNNER_TEMP` that each invocation increments + checks (author-supplied cap on the
  command line, like `--max`). Cheap; most worth it for destructive ops, least for idempotent ones.

---

## 6. Prioritized gap list (for one-by-one decisions later)

**P0 — cheap, high value**
- Add `create-issue` (most-used) and `missing-tool` (agent signals a missing capability).
- Sanitization hardening that matters even in our model: **zero-width/Unicode NFC**, **HTML/script
  tag stripping**, **truncation marker**; move to **reject-inline** for policy violations (§4.1).

**P1**
- `remove-labels`, `close-issue`, `create-discussion`.
- Opt-in **URL domain allow-listing** + protocol filter (reject on violation).
- **`staged`/preview** (dry-run: log instead of write).
- Run-wide **op-count** enforcement (§5 external-state approach).

**P2 — heavier / niche**
- Cross-repo (`target-repo`/`allowed-repos`) + `target:*`/explicit number — **as author-supplied flags,
  default stays triggering-object-only**; `title-prefix`/auto-`labels`/`assignees`,
  `push-to-pull-request-branch`, PR review flow, projects, dispatch, `merge-pull-request`.
- **LLM threat-detection** pass (a second-model safety net over proposed outputs) — heavier; less
  critical for us given isolation, but would catch an agent laundering malicious text through a write.

**Explicitly NOT gaps (resolved in discussion 2026-07-20)**
- **Per-handler token:** already supported via each MCP server's `env: { GITHUB_TOKEN }` (§3).
- **App-minted tokens:** obtained by composing `actions/create-github-app-token` in the workflow YAML
  and passing the result into the server's `env` — nothing to build into safe-outputs (§3).

---

## 7. Direction / decisions (from the 2026-07-20 walkthrough)

- **Safe default is sacred:** every op stays bound to the **object in the event payload** by default;
  the target is never in the agent-visible schema. Scope-widening (`target`, `target-repo`,
  `allowed-repos`) is added only as **author-supplied flags** (like `--allowed-labels`/`--max` today).
- **Prefer reject over transform** for policy violations — our inline/synchronous model lets the agent
  self-correct, which gh-aw's async processor can't. Keep silent transforms only for harmless
  normalizations (§4.1).
- **Per-handler tokens are done; App-minting is a composition concern**, not a safe-outputs feature.
- **Op-count** limits are worthwhile but need an external counter (§5) because we run stateless per call.

---

## 8. Where we're deliberately different (our strengths)

- **Stronger isolation:** the agent runs in a hardware-virtualized microVM with **no credentials**
  and gateway-enforced egress; gh-aw relies on a read-only token + OS sandbox.
- **Target is not agent-selectable:** the tool schema exposes only the *intent* (which labels, what
  body); the target is bound host-side from the event payload, so the agent literally cannot address a
  different issue/PR. gh-aw supports agent-supplied targets (`target:*`, explicit numbers, cross-repo)
  guarded by allowlists — more flexible, larger surface.
- **Zero runtime dependencies** in the MCP server (`src/`); simple host-side inline apply, no
  artifact/second-job round trip.
