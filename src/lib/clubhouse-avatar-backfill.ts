/**
 * One-time, idempotent backfill (PHA-5341): every local player with no avatar
 * gets a random Clubhouse avatar. Runs at boot from instrumentation.ts, the one
 * place a job reliably runs in the standalone image. After the first run it
 * finds nobody, so later boots are a single cheap query.
 *
 * The update re-checks `avatarUrl` in its WHERE, so a photo uploaded between the
 * read and the write is never replaced.
 */

import { prisma } from "@/lib/db";
import { planClubhouseAvatarBackfill } from "@/lib/clubhouse-avatars";

export async function backfillClubhouseAvatars(opts: { dryRun?: boolean } = {}): Promise<{ candidates: number; updated: number }> {
  const rows = await prisma.player.findMany({
    where: { isLocal: true, steamId: null, OR: [{ avatarUrl: null }, { avatarUrl: "" }] },
    select: { id: true, isLocal: true, steamId: true, avatarUrl: true },
  });
  const plan = planClubhouseAvatarBackfill(rows);
  if (opts.dryRun) return { candidates: plan.length, updated: 0 };

  let updated = 0;
  for (const u of plan) {
    const r = await prisma.player.updateMany({
      where: { id: u.id, isLocal: true, steamId: null, OR: [{ avatarUrl: null }, { avatarUrl: "" }] },
      data: { avatarUrl: u.avatarUrl },
    });
    updated += r.count;
  }
  return { candidates: plan.length, updated };
}
