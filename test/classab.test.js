import { test } from "node:test";
import assert from "node:assert/strict";

import mergePR from "../src/operations/merge-pull-request.js";
import closePR from "../src/operations/close-pull-request.js";
import updatePR from "../src/operations/update-pull-request.js";
import assignUser from "../src/operations/assign-to-user.js";
import unassignUser from "../src/operations/unassign-from-user.js";
import requestReviewers from "../src/operations/request-reviewers.js";
import replaceLabels from "../src/operations/replace-labels.js";
import assignMilestone from "../src/operations/assign-milestone.js";
import dispatchWorkflow from "../src/operations/dispatch-workflow.js";
import dispatchRepository from "../src/operations/dispatch-repository.js";
import submitReview from "../src/operations/submit-pull-request-review.js";
import reviewComment from "../src/operations/create-pull-request-review-comment.js";
import hideComment from "../src/operations/hide-comment.js";
import markReady from "../src/operations/mark-pull-request-ready-for-review.js";
import resolveThread from "../src/operations/resolve-pull-request-review-thread.js";
import updateDiscussion from "../src/operations/update-discussion.js";
import closeDiscussion from "../src/operations/close-discussion.js";

const NOF = { noFooter: true };
const prCtx = { owner: "octo", repo: "repo", issueNumber: 7 };
const repoCtx = { owner: "octo", repo: "repo" };

function restStub(handlers = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      const key = `${method} ${path.split("?")[0]}`;
      for (const [pat, fn] of Object.entries(handlers)) {
        if (key.startsWith(pat) || path.includes(pat)) return typeof fn === "function" ? fn({ method, path, body }) : fn;
      }
      return {};
    },
  };
}

function gqlStub(fn) {
  const calls = [];
  return {
    calls,
    async graphql(query, vars) {
      calls.push({ query, vars });
      return fn(query, vars);
    },
  };
}

// ---- merge-pull-request ----
test("merge-pull-request PUTs the merge with the chosen method", async () => {
  const gh = restStub({ "PUT ": () => ({ merged: true }) });
  const out = await mergePR.apply({ merge_method: "squash" }, prCtx, gh);
  assert.equal(gh.calls[0].method, "PUT");
  assert.match(gh.calls[0].path, /\/pulls\/7\/merge$/);
  assert.equal(gh.calls[0].body.merge_method, "squash");
  assert.match(out, /Merged/);
});

test("merge-pull-request: author --merge-method overrides the agent", async () => {
  const gh = restStub({ "PUT ": () => ({ merged: true }) });
  await mergePR.apply({ merge_method: "rebase" }, prCtx, gh, { mergeMethod: "squash" });
  assert.equal(gh.calls[0].body.merge_method, "squash");
});

// ---- close-pull-request ----
test("close-pull-request comments then PATCHes state closed", async () => {
  const gh = restStub();
  await closePR.apply({ body: "superseded" }, prCtx, gh, NOF);
  assert.equal(gh.calls[0].path, "/repos/octo/repo/issues/7/comments");
  assert.equal(gh.calls[1].method, "PATCH");
  assert.match(gh.calls[1].path, /\/pulls\/7$/);
  assert.equal(gh.calls[1].body.state, "closed");
});

// ---- update-pull-request ----
test("update-pull-request PATCHes /pulls with supplied fields", async () => {
  const gh = restStub();
  await updatePR.apply({ title: "New", state: "open" }, prCtx, gh, NOF);
  assert.match(gh.calls[0].path, /\/pulls\/7$/);
  assert.equal(gh.calls[0].body.title, "New");
  assert.equal(gh.calls[0].body.state, "open");
});

test("update-pull-request rejects an empty patch", async () => {
  const gh = restStub();
  await assert.rejects(() => updatePR.apply({}, prCtx, gh, NOF), /at least one/);
});

// ---- assign / unassign ----
test("assign-to-user POSTs assignees; --allowed gates them", async () => {
  const gh = restStub();
  await assignUser.apply({ assignees: ["alice"] }, prCtx, gh, { allowed: "alice,bob" });
  assert.match(gh.calls[0].path, /\/issues\/7\/assignees$/);
  assert.deepEqual(gh.calls[0].body.assignees, ["alice"]);
  await assert.rejects(
    () => assignUser.apply({ assignees: ["mallory"] }, prCtx, restStub(), { allowed: "alice,bob" }),
    /not permitted/
  );
});

test("unassign-from-user DELETEs assignees", async () => {
  const gh = restStub();
  await unassignUser.apply({ assignees: ["alice"] }, prCtx, gh);
  assert.equal(gh.calls[0].method, "DELETE");
  assert.deepEqual(gh.calls[0].body.assignees, ["alice"]);
});

// ---- request-reviewers ----
test("request-reviewers POSTs users + teams; requires at least one", async () => {
  const gh = restStub();
  await requestReviewers.apply({ reviewers: ["alice"], team_reviewers: ["core"] }, prCtx, gh);
  assert.match(gh.calls[0].path, /\/pulls\/7\/requested_reviewers$/);
  assert.deepEqual(gh.calls[0].body.reviewers, ["alice"]);
  assert.deepEqual(gh.calls[0].body.team_reviewers, ["core"]);
  await assert.rejects(() => requestReviewers.apply({}, prCtx, restStub()), /at least one/);
});

// ---- replace-labels ----
test("replace-labels PUTs the exact set; empty clears", async () => {
  const gh = restStub();
  await replaceLabels.apply({ labels: ["bug", "p1"] }, prCtx, gh);
  assert.equal(gh.calls[0].method, "PUT");
  assert.match(gh.calls[0].path, /\/issues\/7\/labels$/);
  assert.deepEqual(gh.calls[0].body.labels, ["bug", "p1"]);
  const gh2 = restStub();
  const out = await replaceLabels.apply({ labels: [] }, prCtx, gh2);
  assert.deepEqual(gh2.calls[0].body.labels, []);
  assert.match(out, /Cleared/);
});

test("replace-labels honors --allowed policy", async () => {
  await assert.rejects(
    () => replaceLabels.apply({ labels: ["wontfix"] }, prCtx, restStub(), { allowed: "bug,p1" }),
    /not permitted|not allowed/i
  );
});

// ---- assign-milestone ----
test("assign-milestone accepts a number directly", async () => {
  const gh = restStub();
  await assignMilestone.apply({ milestone: "4" }, prCtx, gh);
  assert.match(gh.calls[0].path, /\/issues\/7$/);
  assert.equal(gh.calls[0].body.milestone, 4);
});

test("assign-milestone resolves a title to its number", async () => {
  const gh = restStub({
    "/milestones": ({ path }) => (path.includes("open") ? [{ title: "v2", number: 9 }] : []),
  });
  await assignMilestone.apply({ milestone: "v2" }, prCtx, gh);
  const patch = gh.calls.find((c) => c.method === "PATCH");
  assert.equal(patch.body.milestone, 9);
});

test("assign-milestone rejects an unknown title", async () => {
  const gh = restStub({ "/milestones": () => [] });
  await assert.rejects(() => assignMilestone.apply({ milestone: "nope" }, prCtx, gh), /not found/);
});

// ---- dispatch-workflow ----
test("dispatch-workflow requires an allow-list and enforces it", async () => {
  await assert.rejects(
    () => dispatchWorkflow.apply({ workflow: "ci.yml" }, repoCtx, restStub()),
    /allow-list/
  );
  const gh = restStub();
  await dispatchWorkflow.apply({ workflow: "ci.yml", ref: "dev" }, repoCtx, gh, { allowedWorkflows: "ci.yml" });
  assert.match(gh.calls[0].path, /workflows\/ci\.yml\/dispatches$/);
  assert.equal(gh.calls[0].body.ref, "dev");
  await assert.rejects(
    () => dispatchWorkflow.apply({ workflow: "deploy.yml" }, repoCtx, restStub(), { allowedWorkflows: "ci.yml" }),
    /not permitted/
  );
});

// ---- dispatch-repository ----
test("dispatch-repository requires an allow-list and enforces it", async () => {
  await assert.rejects(
    () => dispatchRepository.apply({ event_type: "rebuild" }, repoCtx, restStub()),
    /allow-list/
  );
  const gh = restStub();
  await dispatchRepository.apply({ event_type: "rebuild", client_payload: { a: 1 } }, repoCtx, gh, {
    allowedEventTypes: "rebuild",
  });
  assert.equal(gh.calls[0].path, "/repos/octo/repo/dispatches");
  assert.equal(gh.calls[0].body.event_type, "rebuild");
  assert.deepEqual(gh.calls[0].body.client_payload, { a: 1 });
});

// ---- submit-pull-request-review ----
test("submit-pull-request-review: COMMENT allowed by default, APPROVE gated", async () => {
  const gh = restStub();
  await submitReview.apply({ event: "COMMENT", body: "looks fine" }, prCtx, gh, NOF);
  assert.match(gh.calls[0].path, /\/pulls\/7\/reviews$/);
  assert.equal(gh.calls[0].body.event, "COMMENT");
  await assert.rejects(
    () => submitReview.apply({ event: "APPROVE" }, prCtx, restStub(), NOF),
    /not permitted/
  );
  const gh2 = restStub();
  await submitReview.apply({ event: "APPROVE" }, prCtx, gh2, { ...NOF, allowedEvents: "approve,comment" });
  assert.equal(gh2.calls[0].body.event, "APPROVE");
});

test("submit-pull-request-review requires a body for COMMENT", async () => {
  await assert.rejects(() => submitReview.apply({ event: "COMMENT" }, prCtx, restStub(), NOF), /body is required/);
});

// ---- create-pull-request-review-comment ----
test("create-pull-request-review-comment binds the head SHA host-side", async () => {
  const gh = restStub({
    "GET /repos/octo/repo/pulls/7": () => ({ head: { sha: "abc123" } }),
    "POST /repos/octo/repo/pulls/7/comments": () => ({ html_url: "u" }),
  });
  await reviewComment.apply({ path: "a.js", line: 3, body: "nit" }, prCtx, gh, NOF);
  const post = gh.calls.find((c) => c.method === "POST");
  assert.equal(post.body.commit_id, "abc123");
  assert.equal(post.body.path, "a.js");
  assert.equal(post.body.line, 3);
  assert.equal(post.body.side, "RIGHT");
});

// ---- hide-comment (GraphQL) ----
test("hide-comment runs minimizeComment with the classifier", async () => {
  const gh = gqlStub(() => ({ minimizeComment: { minimizedComment: { isMinimized: true, minimizedReason: "OUTDATED" } } }));
  const out = await hideComment.apply({ comment_id: "NODE1" }, repoCtx, gh);
  assert.equal(gh.calls[0].vars.id, "NODE1");
  assert.equal(gh.calls[0].vars.classifier, "OUTDATED");
  assert.match(out, /Hid comment/);
});

// ---- mark-pull-request-ready-for-review (GraphQL) ----
test("mark-ready resolves the node id then runs the mutation when draft", async () => {
  let phase = 0;
  const gh = gqlStub((q) => {
    if (/pullRequest\(number/.test(q)) return { repository: { pullRequest: { id: "PR1", isDraft: true } } };
    phase++;
    return { markPullRequestReadyForReview: { pullRequest: { isDraft: false, number: 7 } } };
  });
  const out = await markReady.apply({}, prCtx, gh);
  assert.equal(gh.calls[1].vars.id, "PR1");
  assert.match(out, /ready for review/);
});

test("mark-ready is a no-op when the PR is already non-draft", async () => {
  const gh = gqlStub(() => ({ repository: { pullRequest: { id: "PR1", isDraft: false } } }));
  const out = await markReady.apply({}, prCtx, gh);
  assert.equal(gh.calls.length, 1); // only the lookup, no mutation
  assert.match(out, /already ready/);
});

// ---- resolve-pull-request-review-thread (GraphQL) ----
test("resolve-thread runs resolveReviewThread", async () => {
  const gh = gqlStub(() => ({ resolveReviewThread: { thread: { isResolved: true } } }));
  const out = await resolveThread.apply({ thread_id: "T1" }, repoCtx, gh);
  assert.equal(gh.calls[0].vars.id, "T1");
  assert.match(out, /Resolved/);
});

// ---- update-discussion / close-discussion (GraphQL) ----
test("update-discussion resolves the number to a node id then mutates", async () => {
  const gh = gqlStub((q) => {
    if (/discussion\(number/.test(q)) return { repository: { discussion: { id: "D1" } } };
    return { updateDiscussion: { discussion: { url: "https://x/discussions/3", number: 3 } } };
  });
  const out = await updateDiscussion.apply({ discussion_number: 3, body: "edited" }, repoCtx, gh, NOF);
  assert.equal(gh.calls[1].vars.id, "D1");
  assert.match(out, /discussions\/3/);
});

test("update-discussion rejects an empty patch", async () => {
  await assert.rejects(
    () => updateDiscussion.apply({ discussion_number: 3 }, repoCtx, gqlStub(() => ({})), NOF),
    /at least one/
  );
});

test("close-discussion resolves the number then closes with a reason", async () => {
  const gh = gqlStub((q) => {
    if (/discussion\(number/.test(q)) return { repository: { discussion: { id: "D1" } } };
    return { closeDiscussion: { discussion: { url: "https://x/discussions/3", number: 3 } } };
  });
  await closeDiscussion.apply({ discussion_number: 3, reason: "OUTDATED" }, repoCtx, gh);
  assert.equal(gh.calls[1].vars.id, "D1");
  assert.equal(gh.calls[1].vars.reason, "OUTDATED");
});
