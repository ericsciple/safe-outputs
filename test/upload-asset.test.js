import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import uploadAsset from "../src/operations/upload-asset.js";
import { getOperation } from "../src/operations/index.js";
import {
  defaultAssetsBranch,
  fileExt,
  assetTargetName,
  assetUrl,
  resolveMaxSizeKb,
  resolveAllowedExts,
  ensureAssetsBranch,
} from "../src/assets.js";
import { parseList } from "../src/glob.js";

const b64 = (s) => Buffer.from(s).toString("base64");

// ---- helper units ----

test("defaultAssetsBranch slugs the workflow name under assets/", () => {
  assert.equal(defaultAssetsBranch({ GITHUB_WORKFLOW: "My Cool Workflow!" }), "assets/my-cool-workflow");
  assert.equal(defaultAssetsBranch({}), "assets/agent");
});

test("fileExt takes the lowercased trailing extension, ignoring dotfiles", () => {
  assert.equal(fileExt("chart.PNG"), ".png");
  assert.equal(fileExt("a/b/report.tar.gz"), ".gz");
  assert.equal(fileExt(".env"), "");
  assert.equal(fileExt("noext"), "");
});

test("assetTargetName is the sha256 of the bytes plus the extension", () => {
  const buf = Buffer.from("hello");
  const sha = createHash("sha256").update(buf).digest("hex");
  assert.equal(assetTargetName(buf, ".png"), `${sha}.png`);
});

test("assetUrl uses the blob?raw=true form on github.com and /raw/ on GHES", () => {
  assert.equal(
    assetUrl(undefined, "octo", "repo", "assets/wf", "abc.png"),
    "https://github.com/octo/repo/blob/assets/wf/abc.png?raw=true"
  );
  assert.equal(
    assetUrl("https://ghe.example.com", "octo", "repo", "assets/wf", "abc.png"),
    "https://ghe.example.com/octo/repo/raw/assets/wf/abc.png"
  );
});

test("resolveMaxSizeKb defaults to 10240 and honors an override", () => {
  assert.equal(resolveMaxSizeKb({}), 10240);
  assert.equal(resolveMaxSizeKb({ maxSizeKb: "512" }), 512);
  assert.equal(resolveMaxSizeKb({ maxSizeKb: "-1" }), 10240); // invalid -> default
});

test("resolveAllowedExts defaults to png/jpg/jpeg and normalizes overrides", () => {
  assert.deepEqual(resolveAllowedExts({}, parseList), [".png", ".jpg", ".jpeg"]);
  assert.deepEqual(resolveAllowedExts({ allowedExtensions: "PDF, .SVG" }, parseList), [".pdf", ".svg"]);
});

// ---- schema / registration ----

test("upload-asset: registered and exposes only intent (bytes + filename), never target", () => {
  assert.equal(getOperation("upload-asset"), uploadAsset);
  assert.equal(uploadAsset.name, "upload_asset");
  assert.equal(uploadAsset.targetKind, "create");
  const props = Object.keys(uploadAsset.inputSchema.properties).sort();
  assert.deepEqual(props, ["contents", "filename"]);
  assert.equal(uploadAsset.inputSchema.additionalProperties, false);
  for (const forbidden of ["branch", "repo", "path", "url"]) {
    assert.ok(!props.includes(forbidden), `schema must not expose '${forbidden}'`);
  }
});

// ---- apply: existing branch (common path) ----

function fakeGithub({ headSha = "head1", refExists = true } = {}) {
  const calls = [];
  const gql = [];
  return {
    calls,
    gql,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === "GET" && /\/git\/ref\/heads\//.test(path)) {
        if (!refExists) throw new Error("GitHub API GET ... failed: 404 Not Found");
        return { object: { sha: headSha } };
      }
      if (method === "POST" && path.endsWith("/git/commits")) return { sha: "orphanroot1" };
      if (method === "POST" && path.endsWith("/git/refs")) return { ref: body.ref };
      return {};
    },
    async graphql(query, vars) {
      gql.push({ query, vars });
      return { createCommitOnBranch: { commit: { oid: "commit1", url: "u" } } };
    },
  };
}

test("upload-asset: commits the bytes to the existing assets branch and returns the raw URL", async () => {
  const gh = fakeGithub({ headSha: "head1", refExists: true });
  const buf = Buffer.from("PNGDATA");
  const sha = createHash("sha256").update(buf).digest("hex");

  const summary = await uploadAsset.apply(
    { filename: "chart.png", contents: buf.toString("base64") },
    { owner: "octo", repo: "repo" },
    gh,
    { assetsBranch: "assets/wf" }
  );

  // No orphan creation when the branch already exists.
  assert.ok(!gh.calls.some((c) => c.path.endsWith("/git/commits")), "did not create an orphan root");
  assert.ok(!gh.calls.some((c) => c.path.endsWith("/git/refs")), "did not create a ref");

  // Committed via createCommitOnBranch onto the current head, content-addressed name.
  assert.equal(gh.gql.length, 1);
  assert.match(gh.gql[0].query, /createCommitOnBranch/);
  assert.equal(gh.gql[0].vars.input.expectedHeadOid, "head1");
  assert.equal(gh.gql[0].vars.input.branch.branchName, "assets/wf");
  const additions = gh.gql[0].vars.input.fileChanges.additions;
  assert.deepEqual(additions, [{ path: `${sha}.png`, contents: buf.toString("base64") }]);

  assert.equal(summary, `Uploaded asset: https://github.com/octo/repo/blob/assets/wf/${sha}.png?raw=true`);
});

// ---- apply: missing branch -> orphan create ----

test("upload-asset: creates the orphan branch on first use, then commits", async () => {
  const gh = fakeGithub({ refExists: false });
  const buf = Buffer.from("hi");

  await uploadAsset.apply(
    { filename: "a.png", contents: buf.toString("base64") },
    { owner: "octo", repo: "repo" },
    gh,
    { assetsBranch: "assets/wf" }
  );

  // Orphan root: a parentless commit on the empty tree, then the ref.
  const root = gh.calls.find((c) => c.method === "POST" && c.path.endsWith("/git/commits"));
  assert.ok(root, "created an orphan root commit");
  assert.deepEqual(root.body.parents, []);
  assert.equal(root.body.tree, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  const ref = gh.calls.find((c) => c.method === "POST" && c.path.endsWith("/git/refs"));
  assert.equal(ref.body.ref, "refs/heads/assets/wf");
  assert.equal(ref.body.sha, "orphanroot1");

  // The asset commit uses the orphan root as expectedHeadOid.
  assert.equal(gh.gql[0].vars.input.expectedHeadOid, "orphanroot1");
});

test("ensureAssetsBranch refuses to auto-create a non-assets/ branch", async () => {
  const gh = fakeGithub({ refExists: false });
  await assert.rejects(
    () => ensureAssetsBranch(gh, "octo", "repo", "main"),
    /must start with 'assets\/'/
  );
});

// ---- apply: validation ----

test("upload-asset: rejects a disallowed extension without any write", async () => {
  const gh = fakeGithub();
  await assert.rejects(
    () =>
      uploadAsset.apply(
        { filename: "evil.exe", contents: b64("x") },
        { owner: "octo", repo: "repo" },
        gh,
        {}
      ),
    /extension '\.exe' is not allowed/
  );
  assert.equal(gh.gql.length, 0, "no commit on a rejected extension");
});

test("upload-asset: rejects a file over the size cap", async () => {
  const gh = fakeGithub();
  const big = Buffer.alloc(3 * 1024).toString("base64"); // 3 KB
  await assert.rejects(
    () =>
      uploadAsset.apply(
        { filename: "big.png", contents: big },
        { owner: "octo", repo: "repo" },
        gh,
        { maxSizeKb: "2" }
      ),
    /exceeds the maximum allowed size/
  );
  assert.equal(gh.gql.length, 0, "no commit on an oversize file");
});

test("upload-asset: rejects empty contents", async () => {
  const gh = fakeGithub();
  await assert.rejects(
    () =>
      uploadAsset.apply(
        { filename: "empty.png", contents: "" },
        { owner: "octo", repo: "repo" },
        gh,
        {}
      ),
    /empty|minLength|zero bytes/i
  );
});
