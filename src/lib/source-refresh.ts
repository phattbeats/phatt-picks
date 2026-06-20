/**
 * Shared on-read refresh primitives (PHA-863/866). Every external-source driver
 * (news wire, outcomes, Swiss standings, team stats, spotlight odds, live
 * layout) gates its self-refresh the same way: ONE atomic compare-and-set on
 * `SourceState` claims the slot against a per-source floor, then the slow work
 * is DEFERRED past the response so it never adds page latency. These three
 * helpers are that pattern, factored out of the six modules that used to carry
 * byte-identical copies (only the source name + floor differed).
 *
 * Server-only: imports prisma + next/server. Importing from a client component
 * is a build error by design.
 */
import { after } from "next/server";
import { prisma } from "./db";

/**
 * Atomically claim a source's refresh slot against `minIntervalMs`. Returns true
 * iff the floor has elapsed (or no row exists yet) AND this caller won the race;
 * under concurrency exactly one caller wins. A single `updateMany` guarded by
 * `lastCallAt < floor` is serialized by SQLite, so only one flips the stamp; a
 * count of 0 is disambiguated by an atomic INSERT OR IGNORE that succeeds only on
 * the first-ever call. Best-effort: any DB error resolves to "allowed" so a
 * storage hiccup never permanently blocks the driver.
 */
export async function claimRefreshSlot(
  source: string,
  minIntervalMs: number,
): Promise<boolean> {
  const now = new Date();
  const floor = new Date(now.getTime() - minIntervalMs);
  try {
    const res = await prisma.sourceState.updateMany({
      where: { source, lastCallAt: { lt: floor } },
      data: { lastCallAt: now },
    });
    if (res.count > 0) return true; // won the slot: floor had elapsed
    // INSERT OR IGNORE is atomic — succeeds only when no row exists, silently
    // skips otherwise. Avoids the P2002 that `create` throws (and Prisma logs)
    // when multiple workers race at startup before the row exists.
    // id + updatedAt are NOT NULL with only client-side Prisma defaults, so a raw
    // insert MUST supply them or OR IGNORE silently swallows the NOT NULL violation
    // and the row never inserts (permanent wedge on a fresh DB). Generate the id in
    // SQL and stamp updatedAt = now.
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "SourceState" ("id", "source", "lastCallAt", "updatedAt")
      VALUES (lower(hex(randomblob(16))), ${source}, ${now}, ${now})
    `;
    return inserted > 0; // 1 = first-ever pull; 0 = within floor or lost the race
  } catch {
    return true; // DB hiccup — don't let storage block the driver
  }
}

/**
 * Unconditionally stamp a source's refresh slot (an owner-forced ingest backs the
 * read path off afterward). Best-effort — a failed stamp just means the next read
 * may re-pull early.
 */
export async function stampRefreshSlot(source: string): Promise<void> {
  const now = new Date();
  try {
    await prisma.sourceState.upsert({
      where: { source },
      update: { lastCallAt: now },
      create: { source, lastCallAt: now },
    });
  } catch {
    // best-effort — a failed stamp just means the next read may re-pull early
  }
}

/**
 * Run a best-effort background task without blocking (or coupling latency to) the
 * current render. Prefers Next's `after`; falls back to a floating promise
 * outside a request scope. Task errors are swallowed — the driver is best-effort
 * — but logged under `[label]` when one is given so a module keeps its own
 * diagnostic breadcrumb.
 */
export function runDeferred(task: () => Promise<unknown>, label?: string): void {
  const run = () => {
    void task().catch((e) => {
      if (label) {
        console.error(`[${label}] deferred refresh failed (non-fatal):`, e);
      }
    });
  };
  try {
    after(run);
  } catch {
    run();
  }
}
