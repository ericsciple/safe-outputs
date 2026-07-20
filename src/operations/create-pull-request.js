// Safe output: create-pull-request.
//
// Advertises the `create_pull_request` tool. The schema exposes only the intent
// — the title, body, and whether it is a draft. It does NOT expose the head or
// base branch: those are bound host-side from context. The harness commits the
// agent's changes to a branch and sets GITHUB_HEAD_BRANCH (and GITHUB_BASE_BRANCH
// for the target), so the agent proposes "open a PR with this description" but
// cannot retarget the branches or the repository.

import { sanitizeText, sanitizeTitle } from "../sanitize.js";
import { requirePullRequestContext } from "../context.js";
import { withFooter } from "../footer.js";
import { parseList } from "../glob.js";

export default {
  id: "create-pull-request",
  name: "create_pull_request",
  targetKind: "pull-request",
  defaultMax: 1,
  // Context for a PR is the source/target branch (bound host-side), not the
  // triggering issue, so this operation uses a different context requirement.
  requireContext: requirePullRequestContext,
  description:
    "Open a pull request for the changes this workflow has prepared. The source and target " +
    "branches and the repository are fixed by the harness — you only supply the title and body. " +
    "Do not use placeholder or test content; open the PR only when the changes are ready.",
  inputSchema: {
    type: "object",
    required: ["title", "body"],
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        minLength: 1,
        description: "Concise pull request title describing the change.",
      },
      body: {
        type: "string",
        maxLength: 65536,
        description:
          "Pull request description in GitHub-flavored Markdown: what changed, why, and any testing notes.",
      },
      draft: {
        type: "boolean",
        description: "Whether to open the PR as a draft. Defaults to true.",
      },
    },
  },

  /**
   * @param {{title: string, body: string, draft?: boolean}} args - validated arguments
   * @param {{owner: string, repo: string, headBranch: string, baseBranch: string}} ctx - bound context
   * @param {{request: Function}} github - GitHub client
   * @returns {Promise<string>} human-readable summary
   */
  async apply(args, ctx, github, config = {}) {
    const res = await github.request("POST", `/repos/${ctx.owner}/${ctx.repo}/pulls`, {
      title: sanitizeTitle(args.title),
      body: withFooter(sanitizeText(args.body, { maxLength: 65536 }), config),
      head: ctx.headBranch,
      base: ctx.baseBranch,
      draft: args.draft === undefined ? true : args.draft,
    });
    const where = `${ctx.owner}/${ctx.repo}`;
    const prNumber = res && res.number;

    // Author-supplied extras (never agent-settable): auto-apply labels + request
    // reviewers on the new PR. Best-effort — a failure here doesn't undo the PR.
    if (prNumber) {
      const labels = parseList(config.labels);
      if (labels.length) {
        try {
          await github.request("POST", `/repos/${ctx.owner}/${ctx.repo}/issues/${prNumber}/labels`, { labels });
        } catch {
          /* best effort */
        }
      }
      const reviewers = parseList(config.reviewers);
      if (reviewers.length) {
        try {
          await github.request("POST", `/repos/${ctx.owner}/${ctx.repo}/pulls/${prNumber}/requested_reviewers`, { reviewers });
        } catch {
          /* best effort */
        }
      }
    }

    return res && res.html_url
      ? `Opened pull request on ${where}: ${res.html_url}`
      : `Opened pull request on ${where} (${ctx.headBranch} → ${ctx.baseBranch}).`;
  },
};