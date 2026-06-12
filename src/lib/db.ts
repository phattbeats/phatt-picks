import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Build the singleton PrismaClient and put SQLite into WAL mode (PHA-863).
 *
 * Default (rollback-journal) SQLite takes an exclusive lock for the whole of
 * every write, so the read-path upserts (news self-refresh, mirror-on-read)
 * contend with `POST /api/picks` for the single write lock and risk
 * `SQLITE_BUSY` under a lock-time burst. WAL lets readers run concurrently with
 * a writer and is the standard low-cost fix; `busy_timeout` makes the rare
 * writer-vs-writer collision wait-and-retry instead of failing immediately, and
 * `synchronous=NORMAL` is the safe, WAL-recommended durability setting.
 *
 * `journal_mode=WAL` is persisted in the database header (set once, sticks
 * across connections); the per-connection pragmas are reissued on each new
 * client. Best-effort and fire-once at startup — a non-SQLite datasource or a
 * pragma failure must not crash the app.
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  // `$queryRawUnsafe` (not `$executeRaw`) because `journal_mode=WAL` returns a
  // result row, which `$executeRaw` rejects ("Execute returned results").
  void client
    .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
    .then(() => client.$queryRawUnsafe("PRAGMA busy_timeout=5000;"))
    .then(() => client.$queryRawUnsafe("PRAGMA synchronous=NORMAL;"))
    .catch(() => {
      // Non-SQLite datasource or pragma hiccup — fall back to defaults silently.
    });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
