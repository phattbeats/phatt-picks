/**
 * Safe JSON handling for 17+ digit bigints (Steam IDs, item IDs).
 *
 * JSON.parse silently corrupts numbers with >15 significant digits —
 * trailing digits become zeros. We intercept them with a regex reviver
 * that converts large integers to strings before JS ever touches them.
 *
 * Rule: itemids and steamIds are ALWAYS strings in this codebase.
 * Never cast them to Number. Never pass them to JSON.parse without this helper.
 */

const LARGE_INT_RE = /:\s*(\d{16,})/g;

/** Parse JSON that may contain 17+ digit integers, preserving them as strings. */
export function parseSafeJson(raw: string): unknown {
  // Replace bare large integers with quoted strings before parsing
  const patched = raw.replace(LARGE_INT_RE, (_, n) => `: "${n}"`);
  return JSON.parse(patched);
}

/** Serialize a value to JSON, emitting BigInt as plain unquoted integers. */
export function stringifySafeJson(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  );
}

/** Assert a value is a non-empty string suitable for use as a bigint id. */
export function assertBigIntString(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`${field} must be a digit string, got: ${JSON.stringify(v)}`);
  }
  return v;
}
