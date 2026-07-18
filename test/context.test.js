import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContext, requireIssueContext, requirePullRequestContext } from "../src/context.js";

function fakeReader(map) {
  return (path) => {
    if (!(path in map)) throw new Error(`ENOENT: ${path}`);
    return map[path];
  };
}

test("binds issue number and repo from event payload", () => {
  const env = { GITHUB_EVENT_PATH: "/event.json", GITHUB_REPOSITORY: "octo/repo" };
  const read = fakeReader({ "/event.json": JSON.stringify({ issue: { number: 42 } }) });
  const ctx = loadContext(env, read);
  assert.equal(ctx.owner, "octo");
  assert.equal(ctx.repo, "repo");
  assert.equal(ctx.issueNumber, 42);
});

test("falls back to pull_request number", () => {
  const env = { GITHUB_EVENT_PATH: "/event.json", GITHUB_REPOSITORY: "octo/repo" };
  const read = fakeReader({ "/event.json": JSON.stringify({ pull_request: { number: 7 } }) });
  const ctx = loadContext(env, read);
  assert.equal(ctx.issueNumber, 7);
});

test("derives owner/repo from payload when GITHUB_REPOSITORY missing", () => {
  const env = { GITHUB_EVENT_PATH: "/event.json" };
  const read = fakeReader({
    "/event.json": JSON.stringify({
      issue: { number: 3 },
      repository: { name: "repo", owner: { login: "octo" } },
    }),
  });
  const ctx = loadContext(env, read);
  assert.equal(ctx.owner, "octo");
  assert.equal(ctx.repo, "repo");
  assert.equal(ctx.issueNumber, 3);
});

test("requireIssueContext throws without a repo", () => {
  assert.throws(() => requireIssueContext({ issueNumber: 1 }), /determine the repository/);
});

test("requireIssueContext throws without an issue number", () => {
  assert.throws(
    () => requireIssueContext({ owner: "o", repo: "r" }),
    /no issue\/PR number/
  );
});

test("malformed event payload throws an actionable error", () => {
  const env = { GITHUB_EVENT_PATH: "/event.json" };
  const read = fakeReader({ "/event.json": "{ not json" });
  assert.throws(() => loadContext(env, read), /Failed to read event payload/);
});

test("binds head/base branches from the environment", () => {
  const env = {
    GITHUB_REPOSITORY: "octo/repo",
    GITHUB_HEAD_BRANCH: "agent/work",
    GITHUB_BASE_BRANCH: "main",
  };
  const ctx = loadContext(env, () => "{}");
  assert.equal(ctx.headBranch, "agent/work");
  assert.equal(ctx.baseBranch, "main");
});

test("requirePullRequestContext throws without a head branch", () => {
  assert.throws(
    () => requirePullRequestContext({ owner: "o", repo: "r", baseBranch: "main" }),
    /source branch/
  );
});

test("requirePullRequestContext throws without a base branch", () => {
  assert.throws(
    () => requirePullRequestContext({ owner: "o", repo: "r", headBranch: "agent/work" }),
    /base branch/
  );
});

test("requirePullRequestContext passes when owner/repo/head/base are present", () => {
  const ctx = { owner: "o", repo: "r", headBranch: "agent/work", baseBranch: "main" };
  assert.equal(requirePullRequestContext(ctx), ctx);
});
