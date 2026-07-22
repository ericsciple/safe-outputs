// Helpers for the `upload-asset` safe output.
//
// Assets (images, charts, generated reports) are committed to a dedicated, long-lived
// "assets" branch and referenced by a raw URL the agent can embed in issue/PR/discussion
// markdown. This mirrors gh-aw's upload_asset: an ORPHAN branch (default
// `assets/<workflow>`), files named by content hash (`<sha256><ext>`), served via a raw
// URL. The branch, the stored name, and the repo are all bound host-side — the agent only
// supplies the bytes + a filename (used solely to derive the extension), per principle #2.

import { createHash } from "node:crypto";

// git's well-known empty tree object — present in every repository. A parentless commit
// pointing at it is a valid ORPHAN root (no source history), which we then append the
// asset onto via createCommitOnBranch (one signed commit, like our other Class C ops).
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const DEFAULT_ALLOWED_EXTS = [".png", ".jpg", ".jpeg"];
const DEFAULT_MAX_SIZE_KB = 10240; // 10 MB, matching gh-aw's default.

/**
 * Default assets branch: `assets/<workflow-slug>` (gh-aw's `assets/${{ github.workflow }}`).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function defaultAssetsBranch(env = process.env) {
  const wf =
    String(env.GITHUB_WORKFLOW || "agent")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "agent";
  return `assets/${wf}`;
}

/**
 * The file's lowercased extension including the dot (e.g. `.png`), or "" if none.
 * Leading-dot names (`.env`) are treated as having no extension.
 */
export function fileExt(filename) {
  const base = String(filename).split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** Content-addressed stored name: `<sha256(bytes)><ext>`, lowercased. */
export function assetTargetName(buffer, ext) {
  const sha = createHash("sha256").update(buffer).digest("hex");
  return `${sha}${ext}`.toLowerCase();
}

/** Resolve the effective max size (KB). `--max-size-kb` overrides the 10 MB default. */
export function resolveMaxSizeKb(config = {}) {
  if (config.maxSizeKb === undefined) return DEFAULT_MAX_SIZE_KB;
  const n = Number.parseInt(config.maxSizeKb, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SIZE_KB;
}

/**
 * Resolve the allowed-extensions allow-list (lowercased, dot-prefixed). `--allowed-extensions`
 * (comma-separated) overrides the default png/jpg/jpeg set.
 * @param {(raw: string) => string[]} parseList
 */
export function resolveAllowedExts(config = {}, parseList) {
  const raw = parseList ? parseList(config.allowedExtensions) : [];
  if (!raw.length) return [...DEFAULT_ALLOWED_EXTS];
  return raw.map((e) => {
    const s = String(e).toLowerCase().trim();
    return s.startsWith(".") ? s : `.${s}`;
  });
}

/**
 * Build the raw URL for a stored asset. github.com uses the `/blob/<branch>/<name>?raw=true`
 * form; GitHub Enterprise Server serves raw content from `<server>/<repo>/raw/<branch>/<name>`.
 */
export function assetUrl(serverUrl, owner, repo, branch, targetName) {
  const server = serverUrl || "https://github.com";
  const repoPath = `${owner}/${repo}`;
  let host;
  try {
    host = new URL(server).hostname;
  } catch {
    host = "github.com";
  }
  if (host === "github.com") {
    return `https://github.com/${repoPath}/blob/${branch}/${targetName}?raw=true`;
  }
  return `${server.replace(/\/$/, "")}/${repoPath}/raw/${branch}/${targetName}`;
}

/**
 * Resolve the assets branch's current head SHA, creating it as an ORPHAN branch if it
 * doesn't exist yet. Auto-creation is restricted to `assets/`-prefixed names (matching
 * gh-aw) so a misconfigured branch can never orphan/append onto a real source branch.
 * @param {{request: Function}} github
 * @returns {Promise<string>} the branch head OID to commit onto
 */
export async function ensureAssetsBranch(github, owner, repo, branch) {
  const refPath = `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const readHead = async () => {
    try {
      const ref = await github.request("GET", refPath);
      return (ref && ref.object && ref.object.sha) || undefined;
    } catch {
      return undefined; // a missing ref throws (404) — treat as "does not exist yet"
    }
  };

  const existing = await readHead();
  if (existing) return existing;

  if (!branch.startsWith("assets/")) {
    throw new Error(
      `Refusing to auto-create branch '${branch}': asset branches must start with 'assets/'. ` +
        `Create the branch manually first, or configure an 'assets/'-prefixed name.`
    );
  }

  // Orphan root: a parentless commit on the empty tree.
  const root = await github.request("POST", `/repos/${owner}/${repo}/git/commits`, {
    message: "Initialize assets branch",
    tree: EMPTY_TREE_SHA,
    parents: [],
  });
  try {
    await github.request("POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: root.sha,
    });
    return root.sha;
  } catch (e) {
    // Lost a create race — the branch now exists; commit onto its current head.
    const head = await readHead();
    if (head) return head;
    throw e;
  }
}
