/**
 * verify-source-state-claim — PHA-922 health-pass regression guard.
 *
 * The SourceState refresh-slot claim is done with a raw `INSERT OR IGNORE`.
 * `SourceState.id` (@default(cuid())) and `updatedAt` (@updatedAt) are NOT NULL
 * with only CLIENT-side Prisma defaults — a raw insert that omits them inserts
 * ZERO rows (OR IGNORE silently swallows the NOT NULL violation), which
 * permanently wedges the on-read refresh driver on a fresh DB (live scoring
 * never resolves). This proves the bug AND guards the fix two ways:
 *
 *   1. STATIC: every raw `INSERT ... INTO "SourceState"` in src/ names both the
 *      "id" and "updatedAt" columns.
 *   2. RUNTIME: replicate the exact DDL + the fixed insert against an in-memory
 *      SQLite and assert the row is actually created (and a racing re-insert is
 *      still ignored — the floor/race semantics the claim depends on).
 *
 * Run: node --experimental-strip-types --experimental-sqlite --no-warnings \
 *        scripts/verify-source-state-claim.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, "src", "lib");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

console.log("\nsource-state-claim - STATIC: every raw SourceState insert supplies id + updatedAt");

const insertRe =
  /INSERT\s+OR\s+IGNORE\s+INTO\s+"SourceState"\s*\(([^)]*)\)/gi;
let foundInserts = 0;
for (const file of readdirSync(LIB).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(join(LIB, file), "utf8");
  let m: RegExpExecArray | null;
  while ((m = insertRe.exec(src)) !== null) {
    foundInserts++;
    const cols = m[1];
    check(
      `${file}: insert names "id"`,
      /"id"/.test(cols),
    );
    check(
      `${file}: insert names "updatedAt"`,
      /"updatedAt"/.test(cols),
    );
  }
}
check("found at least one SourceState raw insert to check", foundInserts > 0);

console.log("\nsource-state-claim - RUNTIME: fixed insert creates the row, re-insert stays ignored");

const db = new DatabaseSync(":memory:");
// Exact DDL `prisma db push` generates for SourceState.
db.exec(
  `CREATE TABLE "SourceState" ("id" TEXT NOT NULL PRIMARY KEY, "source" TEXT NOT NULL, "lastCallAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL);
   CREATE UNIQUE INDEX "SourceState_source_key" ON "SourceState"("source");`,
);
const now = new Date().toISOString();
const stmt = db.prepare(
  `INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt") VALUES (lower(hex(randomblob(16))), ?, ?, ?)`,
);
const first = stmt.run("outcomes-refresh", now, now);
check("first claim inserts the row (changes === 1 → claim wins)", first.changes === 1);
const second = stmt.run("outcomes-refresh", now, now);
check("racing re-insert is ignored (changes === 0 → backs off)", second.changes === 0);
const rows = db.prepare(`SELECT COUNT(*) AS c FROM "SourceState"`).get() as { c: number };
check("exactly one row exists", rows.c === 1);

// Counter-proof: the OLD (buggy) insert that omits id/updatedAt inserts nothing.
const buggy = db
  .prepare(`INSERT OR IGNORE INTO "SourceState" ("source", "lastCallAt") VALUES (?, ?)`)
  .run("layout-refresh", now);
check("counter-proof: omitting id/updatedAt inserts 0 rows (the original bug)", buggy.changes === 0);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
