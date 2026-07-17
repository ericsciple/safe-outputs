// Safe output: add-comment.
//
// Advertises the `add_comment` tool. The schema exposes ONLY the comment body —
// never the target object. The target is bound from the event context, so the
// agent can only comment on the triggering issue/PR.

export default {
  id: "add-comment",
  name: "add_comment",
  description:
    "Post a comment on the issue or pull request this workflow is running on. " +
    "The target is fixed to the triggering issue/PR — you cannot choose a different one.",
  inputSchema: {
    type: "object",
    required: ["body"],
    additionalProperties: false,
    properties: {
      body: {
        type: "string",
        minLength: 1,
        description: "The comment body, in GitHub-flavored Markdown.",
      },
    },
  },

  /**
   * @param {{body: string}} args - validated arguments
   * @param {{owner: string, repo: string, issueNumber: number}} ctx - bound context
   * @param {{request: Function}} github - GitHub client
   * @returns {Promise<string>} human-readable summary
   */
  async apply(args, ctx, github) {
    const res = await github.request(
      "POST",
      `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.issueNumber}/comments`,
      { body: args.body }
    );
    const where = `${ctx.owner}/${ctx.repo}#${ctx.issueNumber}`;
    return res && res.html_url
      ? `Posted comment on ${where}: ${res.html_url}`
      : `Posted comment on ${where}.`;
  },
};
