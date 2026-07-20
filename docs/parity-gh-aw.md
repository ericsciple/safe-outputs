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

**System "signals" in gh-aw — NOT safe outputs for us (harness concern, out of scope here):**
- `missing-tool`, `missing-data`, `report-incomplete`, `noop` aren't GitHub writes — they're the agent
  **reporting back to the Actions run**. In gh-aw they ride the safe-outputs pipeline; **in our design
  they belong to the harness (microvm-agent)**, surfaced the Actions-native way (annotations
  `::error::`/`::warning::` + step status), and should be **always on** (independent of whether any
  safe output is configured). Tracked in `microvm-agent/TODO.md`, not here. See §2.1.

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

### 2.1 Build order + per-op decisions

**Sequencing (confirmed 2026-07-20): do §3.1 + §4.1 first, then §2.** §3.1 (flag parsing for
`target`/`target-repo`/`allowed`/`blocked`/`max`, the `MCP_STATE_DIR` op-counter, footer) and §4.1 (the
reject/transform sanitize pipeline) are **cross-cutting infrastructure**, not per-op work. Build them
**once against the existing 4 ops** as the test bed; then each new §2 op is "declare a schema + bind
context + call the shared helpers." §3.1 and §4.1 are largely independent (can be parallel); footer
(§3.1(6)) pairs with §4.1 since both touch bodies.

**After the infra, most of §2 is mechanical** — `remove-labels` and `close-issue` are object-acting
mirrors of add-labels/update-issue; `create-issue` is a creation op in the current repo. Two items
carry **real decisions** (resolve before building them):

1. **`create-discussion` needs GraphQL (small, no new dependency).** GitHub Discussions are
   **GraphQL-only** — not in the REST API `src/github.js` speaks today. But this is a *small* addition,
   **not** a bundle/size problem: `github.js` already uses built-in `fetch`, so GraphQL is just a
   `POST /graphql` with `{ query, variables }` — no library, and safe-outputs ships `src/` unbundled
   anyway. The only real differences from REST: (a) it needs **node IDs** — create-discussion first looks
   up the repository ID + category ID (extra queries), and (b) GraphQL returns **HTTP 200 even on
   errors** (errors in `body.errors`), so a `graphql()` helper checks that instead of `res.ok`. Net: a
   tiny helper + a 2–3-step create flow.
2. **Creation vs. object-acting `target`.** The §3.1 `target` model is written for ops that *act on* the
   triggering object. **Creation ops** (`create-issue`, `create-discussion`, `create-pull-request`) have
   no triggering-object target — they take **`target-repo` only** (where to create), not `target`. Fold
   this distinction into the §3.1 target work.

**Out of scope for this repo:** `missing-tool` / `missing-data` / `report-incomplete` / `noop` are **not
safe outputs** — they're the agent reporting back to the Actions run (annotations + step status), which
is a **harness (microvm-agent) concern**, always-on and independent of safe-outputs config. gh-aw bundles
them into its safe-outputs pipeline; we deliberately separate them. **The harness plan is summarized in
§2.2 below** (full detail lives in `microvm-agent/TODO.md`).

### 2.2 Harness-side error surfacing (NOT this repo — summarized for planning)

Lives in **microvm-agent**, not safe-outputs; captured here so the build plan is self-contained. This is
how the agent's problems surface on the Actions run, orthogonal to safe outputs (GitHub writes).

- **Result model — how a step passes/fails.** Actions decides a step's result from the **exit code of the
  step process** (`node dist/index.js` = microvm-agent), NOT the guest agent. `core.setFailed()` = exit 1
  + an `::error::` annotation; **there is no `::set-result::` command**. The Copilot CLI's exit code lives
  in the guest and surfaces to the harness via the console (`=== GUEST: AGENT_EXIT=$? ===`). microvm-agent
  grades in **three layers**: (1) infra/boot failure → fail; (2) **guest agent exited non-zero** → fail
  (read `AGENT_EXIT`); (3) **agent exited 0 but couldn't do the job** → the agent must *declare* it (no
  exit code / workflow command can express "ran fine but unachievable").
- **Error surfacing — guest-side helper scripts (preferred; no MCP round-trip).** For inline
  `error`/`warning`/`notice`, ship tiny helper scripts in a **harness-owned dir, off-PATH** (consistent
  with the `/__mcp` shims — not on PATH, so they don't shadow real tools) — `report-error`,
  `report-warning`, `report-notice`. Each takes the raw message as an arg, does the workflow-command
  **escaping** (`%`→`%25`, `\r`→`%0D`, `\n`→`%0A`), and prints `::error::<escaped>` to the console. The
  agent runs `"$MV_TOOLS_DIR/report-error" "my message"` — it never hand-formats the workflow command
  (the fragile part `core.error()` does host-side). The line prints to the guest console → the **stdout
  allowlist filter** (below) passes `::error::`/`::warning::`/`::notice::` through → the runner renders it
  **inline**. All **guest-side**, no dispatch round-trip. Deliver the helpers per-run (e.g. on the `/__rt`
  or `/__mcp` mount) in a dir that's granted via `--add-dir`; **not** baked into the prebuilt rootfs, and
  **not** on PATH.
- **Well-known env vars for the tool dirs (avoid hardcoded paths).** Both the MCP shims dir and the
  built-in helpers dir should be surfaced via **well-known env vars** so authors/prompts reference
  `"$MV_MCP_DIR/<server>"` and `"$MV_TOOLS_DIR/report-error"` instead of hardcoding `/__mcp` / the helper
  path — decoupling customers from the actual directory names (which we can then change freely). Today the
  preamble hardcodes `/__mcp`; switch it to `$MV_MCP_DIR`. (Env-var names open; could also colocate both
  in one dir + one var, but two keeps MCP-forwarders vs. local-helpers distinct.)
- **Status signal (fail the step) — the one thing that needs the host.** Printing `::error::` can't fail
  the step (that's microvm-agent's exit code, not a message). So `report-incomplete` (name open:
  `report-failure`/`fail`) is a guest helper that prints an `::error::` **plus a machine-readable sentinel**
  line; microvm-agent's **console grading already reads the console**, detects the sentinel, and does
  `setFailed`. So even this stays a guest-side helper + the host's existing grader — **no diagnostics MCP
  needed.** (An in-process MCP handler remains a possible alternative if we later want structured
  outputs/aggregation, but the helper+sentinel path is simpler and covers the requirement.)
- **Stdout allowlist filter (fixes a workflow-command-injection bug).** The harness streams the guest
  console to the step log, so a guest could inject `::set-output::`/`::add-path::`/etc. Fix: parse guest
  stdout/stderr line-by-line — **allow** informational commands inline (`::error::`, `::warning::`,
  `::notice::`, `::debug::`, `::group::`/`::endgroup::` — what the helper scripts emit) and **neutralize**
  capability commands (`::set-output::`, `::save-state::`, `::add-path::`, `::set-env::`, `::add-mask::`,
  `::stop-commands::`, …). This is what makes the guest-side helper approach safe.
- **Known grading gap (bug):** `gradeConsole` currently only checks the "starting copilot" marker, so a
  crash-after-start grades as success — it must also honor `AGENT_EXIT` (layer 2), and the
  `report-incomplete` sentinel (layer 3).
- **Preamble edit required.** The MCP preamble (`generateMcpPreamble`, prepended to the user prompt) must
  gain a short **behavioral** instruction about the helper commands — especially "if you cannot complete
  the task, run `report-incomplete "<reason>"`; use `report-error`/`report-warning` to surface problems."
  The agent needs to be told *when* to use them (not just that they exist). A deliberate exception to the
  tiny-preamble rule (1–2 lines), justified because it's always-on + status-critical.

---

## 3. Per-operation configuration richness — gaps

What we have per operation today: `add-labels` → `--allowed-labels`, `--max`; `add-comment` →
`--max-links`; `create-pull-request` → `draft` (head/base/repo fixed by the harness); `update-issue`
→ title/body/state.

gh-aw per-type options we **don't** have:

| gh-aw option | What it does | Note for us |
|---|---|---|
| `target` (`triggering` / `*` / explicit number / expr) | Which object to act on | Keep **triggering** as the default (least-privilege); add `*`/explicit as author opt-in. **Decision → §3.1(2).** |
| `target-repo` + `allowed-repos` | **Cross-repo** writes with an allowlist | Add as **author-supplied flags**; default stays the event-payload object. **Decision → §3.1(3).** |
| `max` (per type, op-count) | Cap **how many times** the agent may invoke that op in a run (e.g. create ≤1 issue, ≤3 label calls) | **Adopt gh-aw's call-count semantics**, retire our per-call `--max`. Needs external state (stateless-per-call). **Decision + mechanism → §3.1(1).** |
| `title-prefix` | Prepend to every issue/PR title | — |
| `labels` (auto-apply) | Labels added to every created issue/PR | We only have a label allowlist on `add-labels`. **Decision: add** (author-supplied). |
| `assignees`, `reviewers` | Auto-assign | **Decision: add** (author-supplied). |
| `staged` | Preview/dry-run | See §1. |
| `footer` / `messages.*` | **Footer** = boolean toggle **+** a string template with `{placeholders}`, auto-appended to created bodies (default `> Generated by [{workflow_name}]({run_url}) for #42`). **`messages.*`** = ~19 templates, mostly for gh-aw's async activation/status comments. | Footer maps to us; the rest is N/A (we post no activation comments). **Decision → §3.1(6).** |
| `github-token` per handler | Per-handler credential | **We already have this** — each safe-output MCP server is added with its own `env: { GITHUB_TOKEN: ... }` in `mcp-config`, and `createGitHubClient` uses exactly that (`src/github.js:16`). **Not a gap.** |
| `github-app` per handler | Mint a short-lived **installation** token from an App id + private key | **Not a gap for us** — this is what the composable [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) action already does. A customer runs it in their workflow YAML and passes the resulting token into the MCP server's `env` block. No need to build App-minting into safe-outputs. |

### 3.1 Plan / decisions (2026-07-20 walkthrough)

Decisions for §3. gh-aw is the proven pattern, so where we differ we adopt theirs unless our
stronger-isolation model calls for a safer default. Nothing implemented yet — this is the plan.

1. **`max` — adopt gh-aw semantics (call-count), retire ours (per-call cap).**
   - `--max N` = at most **N successful calls** to this tool **per run** (gh-aw counts calls, not
     items). For `add-labels`, `--max` also caps labels **per call** (gh-aw's dual use). Defaults:
     **10** generally, **1** for create-issue (match gh-aw). This replaces our current `add-labels
     --max` (which today means labels-per-call only).
   - **Tracking mechanism (our stateless-per-call model).** gh-aw uses an in-memory counter in a
     **long-lived** MCP server; we spawn a **fresh `safe-outputs <op>` process per call**, so we need
     external, run-scoped, per-instance state. Design:
     - **Location via an env var, not a flag.** The harness gives **every** MCP server a private,
       per-(step, instance) scratch dir via a **generic** env var **`MCP_STATE_DIR`** (set on each
       server's `env` block, where the token already goes). This is a general primitive — not
       safe-outputs special-casing; other servers just ignore it. safe-outputs consumes it (documented
       convention) and treats the value as **opaque**. (An `--id` flag was rejected — a server shouldn't
       need to know its own config-key name; identity is encoded in the path.)
     - **Path layout:** `${RUNNER_TEMP}/mcp-state/${STEP_GUID}/${instance}` where
       - **`STEP_GUID`** is generated **once per agent-step invocation** by the harness → two agent
         steps in one job get different GUIDs → **independent limits** (RUNNER_TEMP is per-*job*, so a
         per-step GUID is required to separate steps).
       - **`instance`** is the mcp-config server name, used **verbatim** (see name validation below), so
         `add_labels1` / `add_labels2` count separately.
     - **Name validation — reject, don't sanitize.** The server name is **already** used verbatim as the
       `/__mcp/<name>` shim filename and referenced by the author in the prompt, so it must be safe
       regardless. The harness **validates each mcp-config key** at parse time against a safe charset
       (`[A-Za-z0-9._-]`, length-capped) and **rejects** invalid names with a clear error — no
       mangling, so the name the author configures is exactly what they reference. (This also fixes a
       latent bug: a name with `/` currently breaks shim generation with no clear error.) The verbatim
       name is then a safe path segment.
     - **Counter file + concurrency (lock-free, no TOCTOU).** Keep a `calls` file in the state dir. Per
       call, **after** schema-validation + sanitization pass and **immediately before** the GitHub
       write: **append one claim line (atomic small POSIX write), then read the file and take my line's
       ordinal; if ordinal > max, reject** ("max of N reached"); else perform the write. Atomic ordered
       appends give each concurrent caller a **distinct ordinal**, so at most `max` writes ever proceed.
       A claimed line whose write then fails still consumes its slot — **this matches gh-aw** (it does
       `processedCount++` before the write, no refund on failure); a *validation*-rejected call appends
       nothing, so bad input never burns budget (also matches gh-aw, which rejects schema-invalid calls
       earlier).
     - **Cleanup.** The harness removes `${RUNNER_TEMP}/mcp-state/${STEP_GUID}` in its **teardown**
       (end of the agent step); the runner wiping `RUNNER_TEMP` between jobs is the backstop.
     - **Fallbacks.** No `--max` → no file, no cap. `--max` set but `MCP_STATE_DIR` absent
       (safe-outputs run outside our harness) → best-effort: default to a dir under `RUNNER_TEMP`/tmp and
       log that per-step/per-instance isolation isn't guaranteed.

2. **`target` — support, safe default preserved.**
   - **Default (no `target`):** bound to the **event-payload object**, and the target is **not in the
     agent-visible schema** (agent can't choose). Unchanged from today.
   - **`target: "*"` (author opt-in):** expose an explicit `item_number` field in the tool schema so
     the agent may target a specific issue/PR it names. Never conjures a number.
   - **`target: <number>` (author):** fixed explicit target.
   - **No triggering issue/PR + no opt-in → REJECT** with a clear error (e.g. "this run was not
     triggered by an issue or pull request, so `add_labels` has no target"). We do **not** silently
     skip. (gh-aw is inconsistent here — `add_labels` errors, `add_comment` silently skips; we pick
     the transparent reject uniformly, matching our inline-reject philosophy from §4.1.) `target: "*"`
     without a supplied number is also rejected.

3. **`target-repo` / `allowed-repos` — support, safe default = current repo.**
   - Author-supplied flags only (never agent-settable). `target-repo` widens to another repo;
     `allowed-repos` gates permitted cross-repo targets (**default deny**; same-repo always allowed).

4. **Label allowlist — KEEP (gh-aw has it), align naming to gh-aw.**
   - gh-aw's `add-labels` uses **`allowed:`** + **`blocked:`** (glob patterns); `create-issue` /
     `create-discussion` use a dedicated **`allowed-labels:`**. **Rename** our add-labels
     `--allowed-labels` → **`--allowed`**, add **`--blocked`** (glob). Reserve `--allowed-labels` for a
     future create-issue/create-discussion.

5. **`title-prefix`, `labels` (auto-apply), `assignees`, `reviewers` — add** (author-supplied,
   low-risk, closes the gap).

6. **`footer` — start here (low-priority but simple). `messages.*` — mostly N/A.**
   - **What footer is in gh-aw:** *both* a top-level **boolean** (`footer: true|false`, per-handler
     override) **and** `messages.footer` = a **string template with `{placeholders}`**
     (`{workflow_name}`, `{run_url}`, `{triggering_number}`). Default template:
     `> Generated by [{workflow_name}]({run_url}) for #{triggering_number}`. It's auto-appended to every
     created issue/PR/comment body; `footer: false` hides the visible line (gh-aw keeps a hidden XML
     traceability marker).
   - **`messages.*` (~19 templates) is mostly N/A for us:** most customize gh-aw's **async
     activation/status comments** about the run (`run-started`, `run-success`, `pull-request-created`,
     `issue-created`, `commit-pushed`, agent-failure messages, staged-mode title/description) + a
     `disclosure-header`. **We run inline and post no activation comments**, so that layer doesn't apply.
     The only piece that maps to us is the **footer on the safe-output body**.
   - **Proposed shape for us:** `--footer` boolean, **default ON** (decided — attribution/disclosure is
     good practice for AI-generated GitHub content, and it's good advertising) + optional
     `--footer-text "<template>"` with a small placeholder set (`{workflow}`, `{run_url}`, `{repo}`,
     `{number}`) resolved host-side from `GITHUB_WORKFLOW` /
     `GITHUB_SERVER_URL`+`GITHUB_REPOSITORY`+`GITHUB_RUN_ID` / event payload. Applies to body-bearing ops
     (add-comment, create-issue, update-issue, create-pull-request), not label-only ops.

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

### 4.1 When sanitization runs — reject (inline) vs. transform (LOCKED 2026-07-20)

- **gh-aw runs it at BOTH ends:** synchronously at the MCP gateway (tool-call time → the model gets
  immediate feedback) **and** in the async processor job (defense-in-depth, after the agent process is
  gone). Because the processor runs when the **agent no longer exists**, it can't ask the agent to fix
  anything, so there it **transforms** (redacts URLs, neutralizes mentions) rather than rejecting.
- **We run fully inline and synchronous:** the agent's `tools/call` blocks on our host-side response,
  so we **can return an actionable error and the agent self-corrects on its next turn**. Locked split:

**A. Reject** (return `isError` + a one-line fix hint; the agent corrects and retries) — author-policy
violations the agent *should* fix:
- **Body over the max length** → reject with the limit ("shorten to under N characters"). **No silent
  truncation** (our inline model lets the agent trim meaningfully; drops gh-aw's truncation marker).
- **URL domain not in `--allowed-domains`** — opt-in feature; when unset we don't domain-filter.
- **More links than `--max-links`** — opt-in cap.
- **Label not in `--allowed`, or matching `--blocked`** (the renamed label allowlist, §3.1(4)).
- **Op-count over `--max`** — see §3.1(1).

**B. Transform silently** (mechanical, safe, where a reject would be pointless noise):
- Strip C0 control chars + DEL; normalize CRLF→LF.
- **Unicode NFC + zero-width char removal** (U+200B/200C/200D/FEFF) — anti-spoofing.
- **HTML filtering** — strip `<script>`, `<iframe>`, `<object>`, `<embed>` and `on*` handler attributes;
  keep safe GFM tags (`<details>`, `<summary>`, `<sub>`, `<sup>`, `<kbd>`).
- **Remove XML comments** (`<!-- -->`); **balance** unterminated code fences.
- **Neutralize non-`http(s)`/`mailto` link protocols** (defense-in-depth; GitHub also strips these on
  render).
- **Escape line-start slash-commands** (`^/cmd` → `\/cmd`) and **defang closing keywords** (`fixes #123`
  → backticked) so a privileged write can't trigger bot actions / auto-close issues.

**C. @mentions → transform (backtick-wrap ALL), NOT reject** — resolving the earlier "undecided". Since
we neutralize *every* mention (keeps the text visible, no notification), no ping is possible, so a
per-message cap or a reject is unnecessary and would only add friction; the backtick rendering also
visibly signals the neutralization. (This is the one place we **refine** the doc's earlier "lean reject":
transform-all is safe *and* lower-friction than rejecting on every `@name`.)

Applies to body/title text fields on the body-bearing ops.

**Scope (important):** sanitization runs **only on human-facing text fields** — `title`, `body`,
comment body. It **never touches file contents or the code diff.** For `create-pull-request` the tool
carries only `title` + `body`; the code lives as **git commits on a branch bound host-side**
(`ctx.headBranch`), so it is never a tool argument and can't be sanitized. So an agent writing "odd
shapes" into source code for testing is unaffected — that goes through git, not the sanitizer.
**gh-aw draws the same boundary:** it sanitizes the same text fields and applies *separate,
non-content* controls to the diff (`max-patch-size`, `max-patch-files`, workflow-file gating), never
the text pipeline. We're consistent.

**Code regions inside a body are preserved:** the character-altering transforms (@mention backtick,
slash-command escape, closing-keyword defang, HTML strip) are **code-region-aware** — they apply to
prose but skip fenced/inline code, so a legitimate code snippet inside a PR/issue body isn't mangled
(matches gh-aw's "preserve code blocks verbatim"). Control-char strip / NFC / zero-width removal are
safe everywhere and apply throughout.

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
  (stateless), so a run-wide op-count needs **external state** — a per-instance counter dir provided via
  the `MCP_STATE_DIR` env var. Full mechanism in **§3.1(1)**.

---

## 6. Prioritized gap list (for one-by-one decisions later)

**P0 — cheap, high value**
- Add `create-issue` (most-used). (`missing-tool` et al. moved to the harness — see §2 / microvm-agent.)
- Sanitization hardening (transforms): **zero-width/Unicode NFC**, **HTML/script stripping**, XML-comment
  removal + code-fence balancing; and move policy checks to **reject-inline** per the locked §4.1 split
  (reject oversize/bad-domain/over-limit/disallowed-label; no silent truncation).

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
- **Reject vs. transform is LOCKED (§4.1):** reject (inline, agent self-corrects) for author-policy
  violations — oversize body (no silent truncation), disallowed URL domain, over `--max-links`,
  disallowed label, over `--max`; transform silently for mechanical normalizations (control chars,
  NFC/zero-width, HTML/script strip, XML comments, code-fence balance, protocol/slash-command/closing-
  keyword defang); **@mentions stay a backtick transform** (neutralize all → no ping → no reject/cap).
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
