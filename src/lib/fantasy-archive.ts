/**
 * Past Majors' fantasy matches (PHA-5454). A finished Major's HLTV match pages
 * never change, so its parsed stat lines are committed once
 * (fixtures/fantasy-archive.json, built by scripts/build-fantasy-archive.mjs
 * from a full read of the Major) and copied into the FantasyMatch table at
 * boot. The past board then reads the table like the live one does, and a
 * fresh database gets the same archive with no crawl.
 */

import archive from "@/fixtures/fantasy-archive.json";
import { prisma } from "./db";
import type { FantasyMatchData } from "./fantasy-core";

interface ArchiveRow {
  stageId: number;
  data: FantasyMatchData;
}

const ARCHIVE = archive as unknown as Record<string, ArchiveRow[]>;

/** Insert any committed archive match the table is missing. Idempotent; never throws. */
export async function seedFantasyArchive(): Promise<{ events: number; inserted: number }> {
  let inserted = 0;
  let events = 0;
  for (const [key, rows] of Object.entries(ARCHIVE)) {
    const eventId = Number(key);
    if (!Number.isInteger(eventId) || rows.length === 0) continue;
    events++;
    try {
      const have = new Set(
        (await prisma.fantasyMatch.findMany({ where: { eventId }, select: { hltvMatchId: true } })).map((r) => r.hltvMatchId),
      );
      for (const row of rows) {
        if (have.has(row.data.hltvMatchId)) continue;
        await prisma.fantasyMatch.upsert({
          where: { hltvMatchId: row.data.hltvMatchId },
          update: {},
          create: {
            eventId,
            stageId: row.stageId,
            hltvMatchId: row.data.hltvMatchId,
            startAt: new Date(row.data.startMs),
            data: JSON.stringify(row.data),
            refreshed: true,
          },
        });
        inserted++;
      }
    } catch (e) {
      console.error(`[fantasy-archive] event ${eventId} seed failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { events, inserted };
}
