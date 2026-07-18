// Sanitize agent-supplied text before it becomes a durable GitHub artifact
// (a comment body, an issue body). Schema validation guarantees shape; this
// guarantees the *content* can't be used to abuse the write we perform on the
// agent's behalf.
//
// Zero dependencies, and intentionally conservative — it should never change the
// meaning of legitimate Markdown, only defang the few things a sandboxed agent
// could weaponize through a trusted host-side writer:
//
//   - Control characters (except tab/newline) are stripped.
//   - CRLF is normalized to LF.
//   - @mentions are neutralized (wrapped in backticks) so the agent can't make a
//     privileged token mass-notify people or ping teams. The text stays visible.
//   - The result is capped at a maximum length.

const DEFAULT_MAX_LENGTH = 65536;

// Control chars to drop: C0 controls and DEL, but keep \t (\u0009) and \n (\u000A).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// A GitHub @mention or @org/team reference, only when not already inside a code
// span (i.e. not immediately preceded by a backtick) and not part of an email or
// longer word (must follow start/whitespace/punctuation).
const MENTION = /(^|[\s([{<>,:;!?"'*_~-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?)/g;

// http/https links, for counting (not rewriting).
const LINK = /\bhttps?:\/\/[^\s)<>\]]+/gi;

/**
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.maxLength=65536]
 * @param {boolean} [opts.neutralizeMentions=true]
 * @returns {string}
 */
export function sanitizeText(text, { maxLength = DEFAULT_MAX_LENGTH, neutralizeMentions = true } = {}) {
  let out = String(text);
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  out = out.replace(CONTROL_CHARS, "");
  if (neutralizeMentions) {
    out = out.replace(MENTION, (_, pre, handle) => `${pre}\`@${handle}\``);
  }
  if (out.length > maxLength) {
    out = out.slice(0, maxLength);
  }
  return out;
}

/**
 * Sanitize a single-line title: strip control chars (including newlines),
 * collapse whitespace, and cap length. Mentions are left intact — an @name in a
 * title does not create a notification.
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.maxLength=256]
 * @returns {string}
 */
export function sanitizeTitle(text, { maxLength = 256 } = {}) {
  let out = String(text).replace(/[\u0000-\u001F\u007F]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > maxLength) {
    out = out.slice(0, maxLength).trim();
  }
  return out;
}

/**
 * Count http/https links in text (used to enforce an optional `--max-links` cap).
 * @param {string} text
 * @returns {number}
 */
export function countLinks(text) {
  const matches = String(text).match(LINK);
  return matches ? matches.length : 0;
}
