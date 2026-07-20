// safe-outputs setup — a Node.js action.
//
// Puts the `safe-outputs` CLI on the runner PATH in a job-scoped way, with NO global
// `npm install -g` (that leaks across jobs on self-hosted runners) and NO assumption
// that `node` is on PATH.
//
// Because this is a node20 action, `process.execPath` is the runner's own Node (from
// externals) that's guaranteed present for the whole job. We bake that absolute path
// into a tiny wrapper so the CLI runs under it regardless of whether the workflow used
// setup-node. safe-outputs is zero-dependency, so there's nothing to install — the
// wrapper just runs the already-checked-out src/cli.js.
//
// Bundled with ncc (setup/dist/index.js); @actions/core is a devDependency compiled
// into that bundle, so the published MCP server package (src/, files allowlist) stays
// free of runtime dependencies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";

try {
  const here = path.dirname(fileURLToPath(import.meta.url)); // setup/dist (bundled) or setup (src)
  // Resolve src/cli.js relative to either the bundled dist dir or the source dir.
  const cli = [
    path.resolve(here, "..", "..", "src", "cli.js"), // setup/dist -> repo root
    path.resolve(here, "..", "src", "cli.js"), // setup -> repo root
  ].find((c) => fs.existsSync(c));

  if (!cli) {
    core.setFailed("safe-outputs setup: CLI (src/cli.js) not found relative to the action.");
  } else {
    const node = process.execPath; // the runner's node (externals), present all job

    const binDir = path.join(process.env.RUNNER_TEMP || "/tmp", "safe-outputs-bin");
    fs.mkdirSync(binDir, { recursive: true });

    // A minimal /bin/sh wrapper (sh is always present on Linux runners) that execs the
    // runner's node against the CLI. Absolute paths — no PATH lookups for node/CLI.
    const wrapper = path.join(binDir, "safe-outputs");
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${shq(node)} ${shq(cli)} "$@"\n`);
    fs.chmodSync(wrapper, 0o755);

    // Job-scoped: core.addPath appends to $GITHUB_PATH (applied to later steps) and
    // updates this process's PATH.
    core.addPath(binDir);

    core.info(`safe-outputs on PATH at ${binDir}`);
    core.info(`  wrapper -> ${node} ${cli}`);
  }
} catch (err) {
  core.setFailed(`safe-outputs setup failed: ${err.message}`);
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
