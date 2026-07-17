import { test } from "node:test";
import assert from "node:assert/strict";
import addLabels from "../src/operations/add-labels.js";
import addComment from "../src/operations/add-comment.js";

const ctx = { owner: "octo", repo: "repo", issueNumber: 42 };

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
  const summary = await addComment.apply({ body: "hello" }, ctx, gh);
  assert.deepEqual(gh.calls[0], {
    method: "POST",
    path: "/repos/octo/repo/issues/42/comments",
    body: { body: "hello" },
  });
  assert.match(summary, /issuecomment-1/);
});
