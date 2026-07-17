import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/mcp.js";
import addLabels from "../src/operations/add-labels.js";

function makeServer(applyImpl) {
  const applied = [];
  const apply =
    applyImpl ||
    (async (args) => {
      applied.push(args);
      return "applied";
    });
  const server = createMcpServer({ operation: addLabels, apply });
  return { server, applied };
}

test("initialize advertises tools capability", async () => {
  const { server } = makeServer();
  const res = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(res.result.protocolVersion, "2024-11-05");
  assert.ok(res.result.capabilities.tools);
});

test("notifications (no id) produce no response", async () => {
  const { server } = makeServer();
  const res = await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res, null);
});

test("tools/list returns the single tool with its schema", async () => {
  const { server } = makeServer();
  const res = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(res.result.tools.length, 1);
  assert.equal(res.result.tools[0].name, "add_labels");
  assert.ok(res.result.tools[0].inputSchema.properties.labels);
});

test("tools/call with valid args invokes apply", async () => {
  const { server, applied } = makeServer();
  const res = await server.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "add_labels", arguments: { labels: ["bug"] } },
  });
  assert.deepEqual(applied, [{ labels: ["bug"] }]);
  assert.equal(res.result.isError, undefined);
  assert.match(res.result.content[0].text, /applied/);
});

test("tools/call with invalid args returns an actionable tool error, not a crash", async () => {
  const { server, applied } = makeServer();
  const res = await server.handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "add_labels", arguments: { labels: [] } },
  });
  assert.equal(applied.length, 0);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Invalid arguments/);
});

test("tools/call for the wrong tool name is a protocol error", async () => {
  const { server } = makeServer();
  const res = await server.handle({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "delete_repo", arguments: {} },
  });
  assert.ok(res.error);
  assert.match(res.error.message, /Unknown tool: delete_repo/);
});

test("apply throwing becomes a tool error the model can read", async () => {
  const { server } = makeServer(async () => {
    throw new Error("GitHub API POST failed: 403 Forbidden");
  });
  const res = await server.handle({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "add_labels", arguments: { labels: ["bug"] } },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /403 Forbidden/);
});

test("unknown method returns method-not-found", async () => {
  const { server } = makeServer();
  const res = await server.handle({ jsonrpc: "2.0", id: 7, method: "resources/list" });
  assert.equal(res.error.code, -32601);
});
