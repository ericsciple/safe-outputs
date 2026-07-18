import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeText, sanitizeTitle, countLinks } from "../src/sanitize.js";

test("strips control characters but keeps tab and newline", () => {
  const out = sanitizeText("a\u0000b\u0007c\td\ne");
  assert.equal(out, "abc\td\ne");
});

test("normalizes CRLF to LF", () => {
  assert.equal(sanitizeText("a\r\nb\rc"), "a\nb\nc");
});

test("neutralizes @mentions by wrapping them in backticks", () => {
  assert.equal(sanitizeText("ping @octocat please"), "ping `@octocat` please");
});

test("neutralizes @org/team mentions", () => {
  assert.equal(sanitizeText("cc @github/security"), "cc `@github/security`");
});

test("leaves @mentions already inside a code span alone", () => {
  assert.equal(sanitizeText("use `@octocat` here"), "use `@octocat` here");
});

test("does not treat an email address as a mention", () => {
  assert.equal(sanitizeText("mail me@example.com"), "mail me@example.com");
});

test("mention neutralization can be disabled", () => {
  assert.equal(sanitizeText("hi @octocat", { neutralizeMentions: false }), "hi @octocat");
});

test("caps length at maxLength", () => {
  assert.equal(sanitizeText("abcdef", { maxLength: 3 }), "abc");
});

test("sanitizeTitle collapses whitespace and drops newlines", () => {
  assert.equal(sanitizeTitle("  a\n\tb   c  "), "a b c");
});

test("sanitizeTitle caps length", () => {
  assert.equal(sanitizeTitle("abcdef", { maxLength: 3 }), "abc");
});

test("countLinks counts http and https urls", () => {
  assert.equal(countLinks("see https://a.com and http://b.com/x and https://c.io"), 3);
});

test("countLinks returns 0 when there are none", () => {
  assert.equal(countLinks("no links here"), 0);
});
