import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContext, requireIssueContext } from "../src/context.js";

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
