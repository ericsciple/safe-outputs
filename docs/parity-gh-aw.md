# Parity analysis: `safe-outputs` vs. gh-aw safe outputs

A feature-by-feature comparison of this repo's safe outputs against
[`github/gh-aw`](https://github.com/github/gh-aw) (GitHub Agentic Workflows) "safe outputs",
recorded so we can decide **one item at a time** what's worth adopting. Nothing here is a
commitment — it's a map of the gaps.

- **Our surface:** 4 operations — `add-labels`, `add-comment`, `update-issue`, `create-pull-request`.
- **gh-aw surface:** ~45 safe-output types.
- **Snapshot date:** 2026-07-19. gh-aw refs are from its default branch (safe-outputs spec v1.26.0,
  `pkg/workflow/safe_output_handlers.go`, `safe_outputs_config_types.go`,
  `docs/.../safe-outputs-specification.md`). gh-aw evolves quickly; re-verify before acting.

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
| Threat scan | **LLM threat-detection** pass before writes (warn/abort per type) | ❌ none |
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
| `target` (`triggering` / `*` / explicit number / expr) | Which object to act on | We hardcode **triggering** (a deliberate least-privilege default). `*`/explicit could be opt-in. |
| `target-repo` + `allowed-repos` | **Cross-repo** writes with an allowlist | We're single-repo (triggering) only. |
| `max` (per type, op-count) | Cap number of ops of a type | We cap labels/links **per call**, not an op-count. |
| `title-prefix` | Prepend to every issue/PR title | — |
| `labels` (auto-apply) | Labels added to every created issue/PR | We only have `allowed-labels` on `add-labels`. |
| `assignees`, `reviewers` | Auto-assign | — |
| `staged` | Preview/dry-run | See §1. |
| `footer` / `messages.*` | Footer + templated status messages | — |
| `github-token` / `github-app` per handler | Per-handler credentials, App-minted tokens | We use one host-side token. |

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

---

## 5. Validation

- gh-aw: a 7-stage pipeline (schema → **op-count limits** → sanitization → **domain filter** →
  **cross-repo allowlist** → temp-id/dependency resolution → API), enforced at **both** the MCP
  gateway (immediate model feedback) and the processor (defense in depth).
- Us: JSON-schema validation (shape, `required`, `additionalProperties:false`, `minProperties`) at
  tool-call time + host-side apply; per-call caps (`--max`, `--max-links`); target bound from event
  context. No op-count cap, no cross-repo allowlist, single enforcement point (adequate given our
  isolation model).

---

## 6. Prioritized gap list (for one-by-one decisions later)

**P0 — cheap, high value**
- Add `create-issue` (most-used) and `missing-tool` (agent signals a missing capability).
- Sanitization hardening that matters even in our model: **zero-width/Unicode NFC**, **HTML/script
  tag stripping**, **truncation marker**.

**P1**
- `remove-labels`, `close-issue`, `create-discussion`.
- Opt-in **URL domain allow-listing** + protocol filter.
- **`staged`/preview** (dry-run: log instead of write).
- Per-type **max op-count** enforcement.

**P2 — heavier / niche**
- Cross-repo (`target-repo`/`allowed-repos`), `target:*`/explicit number, `title-prefix`/auto-`labels`/
  `assignees`, `push-to-pull-request-branch`, PR review flow, projects, dispatch, `merge-pull-request`.

---

## 7. Where we're deliberately different (our strengths)

- **Stronger isolation:** the agent runs in a hardware-virtualized microVM with **no credentials**
  and gateway-enforced egress; gh-aw relies on a read-only token + OS sandbox.
- **Target is not agent-selectable:** the tool schema exposes only the *intent* (which labels, what
  body); the target is bound host-side from the event payload, so the agent literally cannot address a
  different issue/PR. gh-aw supports agent-supplied targets (`target:*`, explicit numbers, cross-repo)
  guarded by allowlists — more flexible, larger surface.
- **Zero runtime dependencies** in the MCP server (`src/`); simple host-side inline apply, no
  artifact/second-job round trip.
