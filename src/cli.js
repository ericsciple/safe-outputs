#!/usr/bin/env node
// safe-outputs <operation>
//
// Starts an MCP (stdio) server for a single safe output. Each safe output is an
// ordinary MCP server; a workflow adds it to its MCP config like any other:
//
//   { "mcpServers": { "labeler": { "command": "safe-outputs", "args": ["add-labels"] } } }
//
// The server runs host-side (never in the sandbox), reads GITHUB_EVENT_PATH to
// bind the triggering issue/PR, and applies exactly one narrow write with the
// job token when the agent calls the tool.

import { getOperation, operationIds } from "./operations/index.js";
import { createMcpServer } from "./mcp.js";
import { serve } from "./serve.js";
import { loadContext, requireIssueContext } from "./context.js";
import { createGitHubClient } from "./github.js";
import { parseConfig } from "./config.js";

function usage(stream) {
  stream.write(
    `Usage: safe-outputs <operation>\n\n` +
      `Runs an MCP (stdio) server for one safe output.\n\n` +
      `Operations:\n` +
      operationIds()
        .map((id) => `  ${id}`)
        .join("\n") +
      `\n`
  );
}

function main(argv = process.argv) {
  const opId = argv[2];

  if (!opId || opId === "--help" || opId === "-h") {
    usage(process.stderr);
    process.exit(opId ? 0 : 1);
  }

  const operation = getOperation(opId);
  if (!operation) {
    process.stderr.write(`Unknown operation: ${opId}\n\n`);
    usage(process.stderr);
    process.exit(1);
  }

  // Scope-widening flags (e.g. --allowed-labels, --max) come after the operation
  // id. The harness places them on the command line; the agent never sees them.
  let config;
  try {
    config = parseConfig(argv.slice(3));
  } catch (e) {
    process.stderr.write(`${e.message}\n\n`);
    usage(process.stderr);
    process.exit(1);
  }

  // Bind context + GitHub client lazily, at call time, so the server can start
  // (and advertise its schema) even before an event/token is needed, and so a
  // missing-context error surfaces as an actionable tool error to the model.
  // Each operation picks how much context it requires (an issue vs. a PR branch).
  const requireContext = operation.requireContext || requireIssueContext;
  async function apply(args) {
    const ctx = requireContext(loadContext());
    const github = createGitHubClient();
    return operation.apply(args, ctx, github, config);
  }

  const server = createMcpServer({
    operation,
    apply,
    log: (msg) => process.stderr.write(`[safe-outputs/${operation.id}] ${msg}\n`),
  });

  serve(server);
}

main();
