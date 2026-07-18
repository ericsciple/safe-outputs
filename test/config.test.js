import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";

test("parses --key value pairs", () => {
  assert.deepEqual(parseConfig(["--max", "3"]), { max: "3" });
});

test("parses --key=value pairs", () => {
  assert.deepEqual(parseConfig(["--allowed-labels=bug,triage"]), { allowedLabels: "bug,triage" });
});

test("kebab-case keys become camelCase", () => {
  assert.deepEqual(parseConfig(["--allowed-labels", "bug"]), { allowedLabels: "bug" });
});

test("a bare flag (followed by another flag) is boolean true", () => {
  assert.deepEqual(parseConfig(["--draft", "--max", "2"]), { draft: true, max: "2" });
});

test("a trailing bare flag is boolean true", () => {
  assert.deepEqual(parseConfig(["--verbose"]), { verbose: true });
});

test("empty args produce an empty config", () => {
  assert.deepEqual(parseConfig([]), {});
});

test("a non-flag argument is rejected", () => {
  assert.throws(() => parseConfig(["oops"]), /Unexpected argument/);
});

test("a bare -- is rejected", () => {
  assert.throws(() => parseConfig(["--"]), /Empty flag/);
});
