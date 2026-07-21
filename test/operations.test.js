import { test } from "node:test";
import assert from "node:assert/strict";
import addLabels from "../src/operations/add-labels.js";
import addComment from "../src/operations/add-comment.js";
import updateIssue from "../src/operations/update-issue.js";
import createPullRequest from "../src/operations/create-pull-request.js";

const ctx = { owner: "octo", repo: "repo", issueNumber: 42 };
const prCtx = { owner: "octo", repo: "repo", headBranch: "agent/work", baseBranch: "main" };

function fakeGitHub(response = {}) {
  const calls = [];
  return {
    calls,
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return response;
    },
  };
}

test("add-labels: schema exposes labels only, never the target", () => {
  const props = Object.keys(addLabels.inputSchema.properties);
  assert.deepEqual(props, ["labels"]);
  assert.equal(addLabels.inputSchema.additionalProperties, false);
  assert.ok(!props.includes("issue_number"));
  assert.ok(!props.includes("repo"));
});

test("add-labels: applies to the bound issue", async () => {
  const gh = fakeGitHub();
  const summary = await addLabels.apply({ labels: ["bug", "triage"] }, ctx, gh);
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(gh.calls[0], {
    method: "POST",
    path: "/repos/octo/repo/issues/42/labels",
    body: { labels: ["bug", "triage"] },
  });
  assert.match(summary, /octo\/repo#42/);
});

test("add-comment: schema exposes body only", () => {
  const props = Object.keys(addComment.inputSchema.properties);
  assert.deepEqual(props, ["body"]);
  assert.equal(addComment.inputSchema.additionalProperties, false);
});

test("add-comment: applies to the bound issue and returns the url", async () => {
  const gh = fakeGitHub({ html_url: "https://github.com/octo/repo/issues/42#issuecomment-1" });
  const summary = await addComment.apply({ body: "hello" }, ctx, gh, { noFooter: true });
  assert.deepEqual(gh.calls[0], {
    method: "POST",
    path: "/repos/octo/repo/issues/42/comments",
    body: { body: "hello" },
  });
  assert.match(summary, /issuecomment-1/);
});

test("add-comment: sanitizes the body before posting (neutralizes @mentions)", async () => {
  const gh = fakeGitHub({});
  await addComment.apply({ body: "ping @octocat" }, ctx, gh, { noFooter: true });
  assert.equal(gh.calls[0].body.body, "ping `@octocat`");
});

test("add-comment: --max-links rejects a body with too many links", async () => {
  const gh = fakeGitHub({});
  await assert.rejects(
    () =>
      addComment.apply(
        { body: "https://a.com https://b.com https://c.com" },
        ctx,
        gh,
        { maxLinks: "2" }
      ),
    /Too many links/
  );
  assert.equal(gh.calls.length, 0);
});

test("add-labels: --allowed rejects labels outside the allow-list", async () => {
  const gh = fakeGitHub();
  await assert.rejects(
    () => addLabels.apply({ labels: ["bug", "wontfix"] }, ctx, gh, { allowed: "bug,triage" }),
    /not permitted/
  );
  assert.equal(gh.calls.length, 0);
});

test("add-labels: --allowed permits labels inside the allow-list", async () => {
  const gh = fakeGitHub();
  await addLabels.apply({ labels: ["bug"] }, ctx, gh, { allowed: "bug,triage" });
  assert.equal(gh.calls.length, 1);
});

test("add-labels: --max caps the number of labels per call", async () => {
  const gh = fakeGitHub();
  await assert.rejects(
    () => addLabels.apply({ labels: ["a", "b", "c"] }, ctx, gh, { max: "2" }),
    /Too many labels/
  );
  assert.equal(gh.calls.length, 0);
});

test("update-issue: schema exposes intent only and requires at least one field", () => {
  const props = Object.keys(updateIssue.inputSchema.properties);
  assert.deepEqual(props.sort(), ["body", "state", "title"]);
  assert.equal(updateIssue.inputSchema.additionalProperties, false);
  assert.equal(updateIssue.inputSchema.minProperties, 1);
  assert.ok(!props.includes("issue_number"));
});

test("update-issue: PATCHes the bound issue with sanitized, changed fields only", async () => {
  const gh = fakeGitHub();
  const summary = await updateIssue.apply({ title: "New\ntitle", state: "closed" }, ctx, gh);
  assert.deepEqual(gh.calls[0], {
    method: "PATCH",
    path: "/repos/octo/repo/issues/42",
    body: { title: "New title", state: "closed" },
  });
  assert.ok(!("body" in gh.calls[0].body));
  assert.match(summary, /octo\/repo#42/);
});

test("create-pull-request: schema exposes title/body/draft + the change set, never the branch", () => {
  const props = Object.keys(createPullRequest.inputSchema.properties);
  assert.deepEqual(props.sort(), ["additions", "base_sha", "body", "deletions", "draft", "title"]);
  assert.equal(createPullRequest.inputSchema.additionalProperties, false);
  assert.ok(!props.includes("head"));
  assert.ok(!props.includes("base"));
  assert.ok(!props.includes("repo"));
});

test("create-pull-request: creates branch@base_sha, commits via GraphQL, opens the PR to the default branch", async () => {
  const gql = [];
  const gh = {
    calls: [],
    async request(method, path, body) {
      this.calls.push({ method, path, body });
      if (method === "GET" && path === "/repos/octo/repo") return { default_branch: "main" };
      if (path === "/repos/octo/repo/pulls") return { number: 7, html_url: "https://github.com/octo/repo/pull/7" };
      return {};
    },
    async graphql(query, vars) {
      gql.push({ query, vars });
      return { createCommitOnBranch: { commit: { oid: "deadbeef", url: "u" } } };
    },
  };
  const summary = await createPullRequest.apply(
    {
      title: "Fix it",
      body: "Details ping @octocat",
      base_sha: "abc1234",
      additions: [{ path: "a.txt", contents: "aGk=" }],
    },
    { owner: "octo", repo: "repo" },
    gh,
    { noFooter: true }
  );

  // A branch ref was created at base_sha.
  const ref = gh.calls.find((c) => c.path === "/repos/octo/repo/git/refs");
  assert.ok(ref, "created a branch ref");
  assert.match(ref.body.ref, /^refs\/heads\//);
  assert.equal(ref.body.sha, "abc1234");

  // The commit went through createCommitOnBranch with the base_sha as expectedHeadOid.
  assert.equal(gql.length, 1);
  assert.match(gql[0].query, /createCommitOnBranch/);
  assert.equal(gql[0].vars.input.expectedHeadOid, "abc1234");
  assert.deepEqual(gql[0].vars.input.fileChanges.additions, [{ path: "a.txt", contents: "aGk=" }]);
  // The branch name in the ref and the commit match.
  assert.equal(gql[0].vars.input.branch.branchName, ref.body.ref.replace("refs/heads/", ""));

  // The PR opened against the resolved default branch, drafting by default.
  const pr = gh.calls.find((c) => c.path === "/repos/octo/repo/pulls");
  assert.equal(pr.body.base, "main");
  assert.equal(pr.body.head, ref.body.ref.replace("refs/heads/", ""));
  assert.equal(pr.body.draft, true);
  assert.equal(pr.body.body, "Details ping `@octocat`"); // sanitized
  assert.match(summary, /pull\/7/);
});

test("create-pull-request: honors --base-branch and explicit draft:false", async () => {
  const gh = {
    calls: [],
    async request(method, path, body) {
      this.calls.push({ method, path, body });
      if (path === "/repos/octo/repo/pulls") return { number: 8, html_url: "https://x/pull/8" };
      return {};
    },
    async graphql() {
      return { createCommitOnBranch: { commit: { oid: "c" } } };
    },
  };
  await createPullRequest.apply(
    { title: "Fix", body: "b", base_sha: "abc1234", draft: false, additions: [{ path: "f", contents: "eA==" }] },
    { owner: "octo", repo: "repo" },
    gh,
    { noFooter: true, baseBranch: "develop" }
  );
  const pr = gh.calls.find((c) => c.path === "/repos/octo/repo/pulls");
  assert.equal(pr.body.base, "develop");
  assert.equal(pr.body.draft, false);
  // With --base-branch set, we do NOT GET the repo default branch.
  assert.ok(!gh.calls.some((c) => c.method === "GET" && c.path === "/repos/octo/repo"));
});

test("create-pull-request: rejects an empty change set", async () => {
  const gh = { async request() {}, async graphql() {} };
  await assert.rejects(
    () => createPullRequest.apply({ title: "t", body: "b", base_sha: "abc1234" }, { owner: "o", repo: "r" }, gh, {}),
    /nothing to commit/
  );
});
