// Registry of safe-output operations, keyed by the CLI operation id
// (the value passed as `safe-outputs <id>`).

import addLabels from "./add-labels.js";
import addComment from "./add-comment.js";
import updateIssue from "./update-issue.js";
import createPullRequest from "./create-pull-request.js";

export const operations = {
  [addLabels.id]: addLabels,
  [addComment.id]: addComment,
  [updateIssue.id]: updateIssue,
  [createPullRequest.id]: createPullRequest,
};

export function getOperation(id) {
  return operations[id];
}

export function operationIds() {
  return Object.keys(operations);
}
