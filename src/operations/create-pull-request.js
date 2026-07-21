// Safe output: create-pull-request.
//
// Opens a pull request from a set of FILE CHANGES the agent produced in the guest
// workspace. The agent (via the guest-side `create-pull-request` helper) computes
// the change set with git and ships it as `{ base_sha, additions, deletions }`; this
// host-side server — where the real token lives — creates a branch at `base_sha`,
// commits the changes as a single SIGNED commit (GraphQL `createCommitOnBranch`),
// and opens the PR against the repo's default branch.
//
// The head branch is GENERATED host-side (the agent never names it); the base is the
// repo default branch unless the author sets `--base-branch`. This is the guest->host
// data path — the Class C output that needs it (see docs/parity-gh-aw.md §2.0).

import { sanitizeText, sanitizeTitle } from "../sanitize.js";
import { withFooter } from "../footer.js";
import { checkAllowedDomains } from "../domains.js";
import { parseList } from "../glob.js";
import { applyChangeset, normalizeChangeset } from "../changeset.js";
import { generateBranchName, resolveBaseBranch } from "../branches.js";

const fileChangeSchema = {
  additions: {
    type: "array",
    description: "Files to add or overwrite, each with its FULL new contents base64-encoded.",
    items: {
      type: "object",
      required: ["path", "contents"],
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, description: "Repo-relative file path." },
        contents: { type: "string", description: "The file's full contents, base64-encoded." },
      },
    },
  },
  deletions: {
    type: "array",
    description: "Files to delete.",
    items: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: { path: { type: "string", minLength: 1, description: "Repo-relative file path to delete." } },
    },
  },
};

export default {
  id: "create-pull-request",
  name: "create_pull_request",
  targetKind: "create",
  defaultMax: 1,
  description:
    "Open a pull request containing a set of file changes. The source branch is created and the " +
    "changes are committed host-side; the base branch and repository are fixed by the workflow — you " +
    "supply the title, body, and the file changes. Do not use placeholder content; open the PR only " +
    "when the changes are ready. (Normally invoked via the guest 'create-pull-request' helper, which " +
    "fills in the file changes from your git workspace.)",
  inputSchema: {
    type: "object",
    required: ["title", "body", "base_sha"],
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 256, description: "Concise pull request title." },
      body: {
        type: "string",
        maxLength: 65536,
        description: "Pull request description in GitHub-flavored Markdown: what changed, why, testing notes.",
      },
      draft: { type: "boolean", description: "Whether to open the PR as a draft. Defaults to true." },
      base_sha: {
        type: "string",
        minLength: 7,
        description: "The commit SHA the changes are based on (the workspace HEAD).",
      },
      ...fileChangeSchema,
    },
  },

  async apply(args, ctx, github, config = {}) {
    const { additions, deletions } = normalizeChangeset(args);
    const title = sanitizeTitle(args.title);

    // Base = repo default branch (or author --base-branch). Resolve before we mutate.
    const baseBranch = await resolveBaseBranch(github, ctx, config);

    // Generate the head branch host-side and create its ref at the workspace HEAD.
    const branch = generateBranchName(config);
    await github.request("POST", `/repos/${ctx.owner}/${ctx.repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: args.base_sha,
    });

    // Commit the file changes as ONE signed commit on the new branch.
    await applyChangeset(github, {
      owner: ctx.owner,
      repo: ctx.repo,
      branch,
      expectedHeadOid: args.base_sha,
      additions,
      deletions,
      message: title,
    });

    // Open the PR.
    const body = withFooter(sanitizeText(args.body, { maxLength: 65536 }), config);
    checkAllowedDomains(body, parseList(config.allowedDomains));
    const res = await github.request("POST", `/repos/${ctx.owner}/${ctx.repo}/pulls`, {
      title,
      body,
      head: branch,
      base: baseBranch,
      draft: args.draft === undefined ? true : args.draft,
    });

    // Author-supplied extras (never agent-settable): auto-apply labels + reviewers.
    const prNumber = res && res.number;
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
      ? `Opened pull request: ${res.html_url}`
      : `Opened pull request on ${ctx.owner}/${ctx.repo} (${branch} -> ${baseBranch}).`;
  },
};
