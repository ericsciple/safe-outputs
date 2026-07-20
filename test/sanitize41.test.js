import { test } from "node:test";
import assert from "node:assert/strict";

import { sanitizeText } from "../src/sanitize.js";
import { checkAllowedDomains } from "../src/domains.js";
import { validate } from "../src/validate.js";

// --- transforms (applied everywhere: NFC, zero-width, control) ---

test("sanitize: removes zero-width chars", () => {
  assert.equal(sanitizeText("a\u200Bb\uFEFFc", { neutralizeMentions: false }), "abc");
});

test("sanitize: NFC-normalizes", () => {
  // "e" + combining acute -> single "é"
  const out = sanitizeText("e\u0301", { neutralizeMentions: false });
  assert.equal(out, "\u00e9");
});

// --- HTML stripping (prose only) ---

test("sanitize: strips <script>/<iframe> and on* handlers in prose", () => {
  const out = sanitizeText('hi <script>alert(1)</script> <img onerror="x"> bye', { neutralizeMentions: false });
  assert.ok(!/<script>/.test(out));
  assert.ok(!/onerror=/.test(out));
  assert.ok(out.includes("hi ") && out.includes(" bye"));
});

// --- code-region preservation ---

test("sanitize: preserves @mentions and HTML inside fenced code", () => {
  const src = "ping @octocat\n```\n@team <script>x</script>\n```\n";
  const out = sanitizeText(src);
  assert.ok(out.includes("`@octocat`")); // prose mention neutralized
  assert.ok(out.includes("@team <script>x</script>")); // fenced code untouched
});

test("sanitize: preserves inline code spans", () => {
  const out = sanitizeText("run `@here` please ping @here");
  assert.ok(out.includes("`@here`")); // inline code kept verbatim
  assert.ok(out.includes("ping `@here`")); // prose mention neutralized
});

// --- oversize -> validation reject (maxLength) ---

test("validate: enforces maxLength (oversize body is rejected, not truncated)", () => {
  const schema = { type: "object", properties: { body: { type: "string", maxLength: 5 } } };
  const errors = validate(schema, { body: "toolong" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /at most 5 character/);
});

// --- domain allow-list (opt-in reject) ---

test("checkAllowedDomains: no-op when unset; rejects unlisted; allows wildcard", () => {
  assert.doesNotThrow(() => checkAllowedDomains("see https://evil.com", []));
  assert.throws(
    () => checkAllowedDomains("see https://evil.com/x", ["github.com"]),
    /not permitted/
  );
  assert.doesNotThrow(() => checkAllowedDomains("see https://docs.github.com/x", ["*.github.com"]));
  assert.doesNotThrow(() => checkAllowedDomains("see https://github.com/x", ["github.com"]));
});
