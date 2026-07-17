// Registry of safe-output operations, keyed by the CLI operation id
// (the value passed as `safe-outputs <id>`).

import addLabels from "./add-labels.js";
import addComment from "./add-comment.js";

export const operations = {
  [addLabels.id]: addLabels,
  [addComment.id]: addComment,
};

export function getOperation(id) {
  return operations[id];
}

export function operationIds() {
  return Object.keys(operations);
}
