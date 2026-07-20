// Registry of safe-output operations, keyed by the CLI operation id
// (the value passed as `safe-outputs <id>`).

import addLabels from "./add-labels.js";
import removeLabels from "./remove-labels.js";
import addComment from "./add-comment.js";
import updateIssue from "./update-issue.js";
import closeIssue from "./close-issue.js";
import createIssue from "./create-issue.js";
import createDiscussion from "./create-discussion.js";
import createPullRequest from "./create-pull-request.js";

export const operations = {
  [addLabels.id]: addLabels,
  [removeLabels.id]: removeLabels,
  [addComment.id]: addComment,
  [updateIssue.id]: updateIssue,
  [closeIssue.id]: closeIssue,
  [createIssue.id]: createIssue,
  [createDiscussion.id]: createDiscussion,
  [createPullRequest.id]: createPullRequest,
};

export function getOperation(id) {
  return operations[id];
}

export function operationIds() {
  return Object.keys(operations);
}
