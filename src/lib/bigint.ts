/**
 * Safe JSON handling for 17+ digit bigints (Steam IDs, item IDs).
 *
 * JSON.parse silently corrupts numbers with >15 significant digits —
 * trailing digits become zeros. We intercept them with a regex pre-pass
 * that quotes large integers before JSON.parse ever touches them.
 *
 * Protects: 17+ digit unquoted integers in JSON number position —
 *   - object values:  {"itemid": 1729...}
 *   - array elements: {"ids":[1729..., 1729...]}
 * Match requires a `:`, `,`, or `[` lead (optionally with whitespace) AND
 * a `,`, `]`, or `}` terminator. The terminator check keeps the rewrite
 * off bigint-looking substrings inside string literals, which end at `"`.
 *
 * Caveat: not a real JSON tokenizer. A string literal whose contents
 * themselves look like JSON number position (e.g. `"foo,17293...899385,bar"`)
 * could still match. Don't pass attacker-controlled JSON-in-JSON through
 * this without revisiting.
 *
 * Rule: itemids and steamIds are ALWAYS strings in this codebase.
 * Never cast them to Number. Never pass them to JSON.parse without this helper.
 */

// Lead delimiter (`:`, `,`, or `[`) → optional WS → bigint → JSON terminator lookahead.
const LARGE_INT_RE = /([:,[])(\s*)(\d{16,})(?=\s*[,\]}])/g;

/** Parse JSON that may contain 17+ digit integers, preserving them as strings. */
export function parseSafeJson(raw: string): unknown {
  const patched = raw.replace(LARGE_INT_RE, (_, lead, ws, n) => `${lead}${ws}"${n}"`);
  return JSON.parse(patched);
}

/** Assert a value is a non-empty string suitable for use as a bigint id. */
export function assertBigIntString(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`${field} must be a digit string, got: ${JSON.stringify(v)}`);
  }
  return v;
}
