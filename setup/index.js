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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const setupDir = path.dirname(fileURLToPath(import.meta.url)); // .../setup
const repoRoot = path.resolve(setupDir, ".."); // the safe-outputs repo root
const cli = path.join(repoRoot, "src", "cli.js");
const node = process.execPath; // the runner's node (externals), present all job

if (!fs.existsSync(cli)) {
  console.error(`safe-outputs setup: CLI not found at ${cli}`);
  process.exit(1);
}

const binDir = path.join(process.env.RUNNER_TEMP || "/tmp", "safe-outputs-bin");
fs.mkdirSync(binDir, { recursive: true });

// A minimal /bin/sh wrapper (sh is always present on Linux runners) that execs the
// runner's node against the CLI. Absolute paths — no PATH lookups for node or the CLI.
const wrapper = path.join(binDir, "safe-outputs");
fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${shq(node)} ${shq(cli)} "$@"\n`);
fs.chmodSync(wrapper, 0o755);

// Job-scoped add-path (the runner applies $GITHUB_PATH to subsequent steps only).
if (process.env.GITHUB_PATH) {
  fs.appendFileSync(process.env.GITHUB_PATH, binDir + "\n");
}

console.log(`safe-outputs on PATH at ${binDir}`);
console.log(`  wrapper -> ${node} ${cli}`);

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
