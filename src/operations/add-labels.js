// Safe output: add-labels.
//
// Advertises the `add_labels` tool. The schema exposes ONLY the intent (which
// labels) — never the target object. The target is bound from the event
// context, so the agent can only add labels to the triggering issue/PR.

export default {
  id: "add-labels",
  name: "add_labels",
  description:
    "Add one or more labels to the issue or pull request this workflow is running on. " +
    "The target is fixed to the triggering issue/PR — you cannot choose a different one.",
  inputSchema: {
    type: "object",
    required: ["labels"],
    additionalProperties: false,
    properties: {
      labels: {
        type: "array",
        minItems: 1,
        items: { type: "string" },
        description:
          "Labels to add to the triggering issue or pull request. Each label must already exist in the repository.",
      },
    },
  },

  /**
   * @param {{labels: string[]}} args - validated arguments
   * @param {{owner: string, repo: string, issueNumber: number}} ctx - bound context
   * @param {{request: Function}} github - GitHub client
   * @returns {Promise<string>} human-readable summary
   */
  async apply(args, ctx, github) {
    await github.request(
      "POST",
      `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.issueNumber}/labels`,
      { labels: args.labels }
    );
    const list = args.labels.map((l) => `'${l}'`).join(", ");
    return `Added label(s) ${list} to ${ctx.owner}/${ctx.repo}#${ctx.issueNumber}.`;
  },
};
