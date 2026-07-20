// Safe output: add-labels.
//
// Advertises the `add_labels` tool. The schema exposes ONLY the intent (which
// labels) — never the target object. By default the target is bound from the event
// context (the triggering issue/PR); an author can widen it with --target.

import { matchesGlob, parseList } from "../glob.js";
import { resolveMax } from "../limits.js";

export default {
  id: "add-labels",
  name: "add_labels",
  targetKind: "issue",
  defaultMax: 3,
  description:
    "Add one or more labels to the issue or pull request this workflow is running on. " +
    "The target is fixed to the triggering issue/PR unless the workflow widens it.",
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
          "Labels to add to the target issue or pull request. Each label must already exist in the repository.",
      },
    },
  },

  /**
   * @param {{labels: string[]}} args - validated arguments
   * @param {{owner: string, repo: string, issueNumber: number}} ctx - bound context
   * @param {{request: Function}} github - GitHub client
   * @param {{allowed?: string, blocked?: string, max?: string}} [config] - scope-widening flags
   * @returns {Promise<string>} human-readable summary
   */
  async apply(args, ctx, github, config = {}) {
    // Optional allow-list (glob patterns): reject anything outside it.
    const allowed = parseList(config.allowed);
    if (allowed.length) {
      const disallowed = args.labels.filter((l) => !allowed.some((p) => matchesGlob(l, p)));
      if (disallowed.length) {
        throw new Error(
          `These labels are not permitted by this workflow: ${disallowed.map((l) => `'${l}'`).join(", ")}. ` +
            `Allowed: ${allowed.map((l) => `'${l}'`).join(", ")}.`
        );
      }
    }

    // Optional block-list (glob patterns): reject anything matching it.
    const blocked = parseList(config.blocked);
    if (blocked.length) {
      const hit = args.labels.filter((l) => blocked.some((p) => matchesGlob(l, p)));
      if (hit.length) {
        throw new Error(
          `These labels are blocked by this workflow: ${hit.map((l) => `'${l}'`).join(", ")}.`
        );
      }
    }

    // `max` also caps labels per call (matches gh-aw's dual use of max for add-labels).
    const max = resolveMax(config.max, this.defaultMax);
    if (max !== undefined && args.labels.length > max) {
      throw new Error(
        `Too many labels: ${args.labels.length} requested but this workflow allows at most ${max} per call.`
      );
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
