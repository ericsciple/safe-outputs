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
   * @param {{allowedLabels?: string, max?: string}} [config] - scope-widening flags
   * @returns {Promise<string>} human-readable summary
   */
  async apply(args, ctx, github, config = {}) {
    // Optional allow-list: when the workflow author restricts which labels this
    // safe output may apply, reject anything outside it (as an actionable tool
    // error the model can correct).
    if (config.allowedLabels !== undefined) {
      const allowed = String(config.allowedLabels)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const disallowed = args.labels.filter((l) => !allowed.includes(l));
      if (disallowed.length) {
        throw new Error(
          `These labels are not permitted by this workflow: ${disallowed.map((l) => `'${l}'`).join(", ")}. ` +
            `Allowed labels: ${allowed.map((l) => `'${l}'`).join(", ")}.`
        );
      }
    }

    // Optional cap on how many labels a single call may add.
    if (config.max !== undefined) {
      const max = Number.parseInt(config.max, 10);
      if (Number.isFinite(max) && args.labels.length > max) {
        throw new Error(
          `Too many labels: ${args.labels.length} requested but this workflow allows at most ${max} per call.`
        );
      }
    }

    await github.request(
      "POST",
      `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.issueNumber}/labels`,
      { labels: args.labels }
    );
    const list = args.labels.map((l) => `'${l}'`).join(", ");
    return `Added label(s) ${list} to ${ctx.owner}/${ctx.repo}#${ctx.issueNumber}.`;
  },
};
