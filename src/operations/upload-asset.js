// Safe output: upload-asset.
//
// Uploads a file the agent produced (an image, chart, generated report, ...) to a
// dedicated assets branch and returns a raw URL the agent can embed in issue/PR/discussion
// markdown. Class C — the guest→host data path: the agent supplies the file BYTES
// (base64) as ordinary tool input (via `--stdin` for large files), and this host-side
// server (where the token lives) commits them as ONE signed commit (GraphQL
// createCommitOnBranch) onto the assets branch, creating that ORPHAN branch on first use.
//
// The branch (default `assets/<workflow>`), the stored file name (a content hash), and the
// repo are all bound host-side — the agent never chooses them (principle #2). The agent's
// `filename` is used ONLY to derive/validate the extension; the stored name is `<sha256><ext>`.

import { applyChangeset } from "../changeset.js";
import { parseList } from "../glob.js";
import {
  defaultAssetsBranch,
  ensureAssetsBranch,
  assetTargetName,
  assetUrl,
  resolveMaxSizeKb,
  resolveAllowedExts,
  fileExt,
} from "../assets.js";

export default {
  id: "upload-asset",
  name: "upload_asset",
  targetKind: "create",
  defaultMax: 10,
  description:
    "Upload a file you generated (e.g. an image, chart, or report) and get back a URL you can embed " +
    "in issue, pull request, or discussion markdown. Provide the file's full bytes base64-encoded as " +
    "`contents` and its original name as `filename` (used only to determine the file type). The file is " +
    "committed host-side to the repository's assets branch and stored under a content hash; the branch " +
    "and stored name are fixed host-side. Allowed file types and size are set by the workflow.",
  inputSchema: {
    type: "object",
    required: ["filename", "contents"],
    additionalProperties: false,
    properties: {
      filename: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        description:
          "The file's original name, e.g. chart.png. Used only to derive and validate the file extension; " +
          "the stored name is a content hash, not this.",
      },
      contents: {
        type: "string",
        minLength: 1,
        description: "The file's full binary contents, base64-encoded.",
      },
    },
  },

  async apply(args, ctx, github, config = {}) {
    // Decode the bytes and enforce the size cap.
    const buffer = Buffer.from(String(args.contents), "base64");
    if (buffer.length === 0) {
      throw new Error("The uploaded file is empty (contents decoded to zero bytes).");
    }
    const maxSizeKb = resolveMaxSizeKb(config);
    const sizeKb = Math.ceil(buffer.length / 1024);
    if (sizeKb > maxSizeKb) {
      throw new Error(`File size ${sizeKb} KB exceeds the maximum allowed size of ${maxSizeKb} KB.`);
    }

    // Enforce the extension allow-list (default png/jpg/jpeg).
    const ext = fileExt(args.filename);
    if (!ext) {
      throw new Error(`Could not determine a file extension from '${args.filename}'.`);
    }
    const allowed = resolveAllowedExts(config, parseList);
    if (!allowed.includes(ext)) {
      throw new Error(`File extension '${ext}' is not allowed. Allowed extensions: ${allowed.join(", ")}.`);
    }

    // Content-addressed stored name; branch bound host-side (author-overridable).
    const targetName = assetTargetName(buffer, ext);
    const branch = config.assetsBranch ? String(config.assetsBranch) : defaultAssetsBranch();

    // Ensure the assets branch (orphan-create on first use) and commit the file as one
    // signed commit. Re-uploading identical bytes yields the same stored name (idempotent URL).
    const headOid = await ensureAssetsBranch(github, ctx.owner, ctx.repo, branch);
    await applyChangeset(github, {
      owner: ctx.owner,
      repo: ctx.repo,
      branch,
      expectedHeadOid: headOid,
      additions: [{ path: targetName, contents: buffer.toString("base64") }],
      message: `Add asset ${targetName}`,
    });

    const url = assetUrl(process.env.GITHUB_SERVER_URL, ctx.owner, ctx.repo, branch, targetName);
    return `Uploaded asset: ${url}`;
  },
};
