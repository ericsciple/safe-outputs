import { test } from "node:test";
import assert from "node:assert/strict";

import createIssue from "../src/operations/create-issue.js";
import removeLabels from "../src/operations/remove-labels.js";
import closeIssue from "../src/operations/close-issue.js";
import createDiscussion from "../src/operations/create-discussion.js";

const NOF = { noFooter: true };
const issueCtx = { owner: "octo", repo: "repo", issueNumber: 42 };
const createCtx = { owner: "octo", repo: "repo" };

function fakeGitHub(responses = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async request(method, path, body) {
      calls.push({ kind: "rest", method, path, body });
      return responses[i++] || {};
    },
  };
}

// --- create-issue ---

test("create-issue: posts title+body, prefixes title, merges author labels", async () => {
  const gh = fakeGitHub([{ html_url: "https://github.com/octo/repo/issues/5" }]);
  const summary = await createIssue.apply(
    { title: "Bug", body: "details", labels: ["bug"] },
    createCtx,
    gh,
    { noFooter: true, titlePrefix: "[auto] ", labels: "triage" }
  );
  const call = gh.calls[0];
  assert.equal(call.path, "/repos/octo/repo/issues");
  assert.equal(call.body.title, "[auto] Bug");
  assert.equal(call.body.body, "details");
  assert.deepEqual(call.body.labels.sort(), ["bug", "triage"]);
  assert.match(summary, /issues\/5/);
});

test("create-issue: rejects agent labels outside --allowed-labels", async () => {
  const gh = fakeGitHub([{}]);
  await assert.rejects(
    () => createIssue.apply({ title: "x", body: "y", labels: ["wontfix"] }, createCtx, gh, { ...NOF, allowedLabels: "bug,triage" }),
    /not permitted/
  );
  assert.equal(gh.calls.length, 0);
});

// --- remove-labels ---

test("remove-labels: DELETEs each label; 404 is a no-op", async () => {
  const gh = {
    calls: [],
    async request(method, path) {
      this.calls.push({ method, path });
      if (path.endsWith("/gone")) throw new Error("GitHub API DELETE ... failed: 404 Not Found");
      return {};
    },
  };
  const summary = await removeLabels.apply({ labels: ["bug", "gone"] }, issueCtx, gh);
  assert.equal(gh.calls.length, 2);
  assert.equal(gh.calls[0].method, "DELETE");
  assert.match(gh.calls[0].path, /\/labels\/bug$/);
  assert.match(summary, /Removed/);
});

// --- close-issue ---

test("close-issue: optional comment then close with state_reason", async () => {
  const gh = fakeGitHub([{}, {}]);
  await closeIssue.apply({ body: "resolved", state_reason: "completed" }, issueCtx, gh, NOF);
  assert.equal(gh.calls[0].path, "/repos/octo/repo/issues/42/comments");
  assert.equal(gh.calls[0].body.body, "resolved");
  assert.equal(gh.calls[1].method, "PATCH");
  assert.equal(gh.calls[1].body.state, "closed");
  assert.equal(gh.calls[1].body.state_reason, "completed");
});

test("close-issue: --allow-body=false discards the comment", async () => {
  const gh = fakeGitHub([{}]);
  await closeIssue.apply({ body: "ignored" }, issueCtx, gh, { ...NOF, allowBody: "false" });
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].method, "PATCH");
});

// --- create-discussion (GraphQL) ---

test("create-discussion: looks up repo+category then runs the mutation", async () => {
  const calls = [];
  const gh = {
    async graphql(query, vars) {
      calls.push({ query, vars });
      if (/repository\(/.test(query)) {
        return {
          repository: {
            id: "REPO1",
            hasDiscussionsEnabled: true,
            discussionCategories: { nodes: [{ id: "CAT1", name: "General", slug: "general" }] },
          },
        };
      }
      return { createDiscussion: { discussion: { url: "https://github.com/octo/repo/discussions/1", number: 1 } } };
    },
  };
  const summary = await createDiscussion.apply(
    { title: "Hi", body: "there", category: "general" },
    createCtx,
    gh,
    NOF
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].vars.repositoryId, "REPO1");
  assert.equal(calls[1].vars.categoryId, "CAT1");
  assert.match(summary, /discussions\/1/);
});

test("create-discussion: unknown category is rejected", async () => {
  const gh = {
    async graphql() {
      return {
        repository: {
          id: "R",
          hasDiscussionsEnabled: true,
          discussionCategories: { nodes: [{ id: "C", name: "General", slug: "general" }] },
        },
      };
    },
  };
  await assert.rejects(
    () => createDiscussion.apply({ title: "t", body: "b", category: "nope" }, createCtx, gh, NOF),
    /not found/
  );
});
