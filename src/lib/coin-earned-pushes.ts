/**
 * coin-earned-pushes — fan-out push when a player earns a challenge coin
 * (PHA-1278, "challenge coin notification as well when it pings").
 *
 * Runs on every scheduler tick (instrumentation.ts). A challenge coin mints the
 * moment a Major becomes effectively archived (its Grand Final resolved + the
 * 48h grace, or the dates.end backstop) — see eventArchivedAtMs. On the first
 * tick after that instant we ping everyone who took part.
 *
 * Dedup is an in-process `fired` Set keyed by eventId (same pattern as
 * recap/announce pushes); a restart re-arms it, so a RECENCY GUARD bounds the
 * blast radius — we only ping for an event archived within the last 7 days, and
 * the notification `tag` (coin:<eventId>) collapses any duplicate client-side.
 *
 * Tier-agnostic push (buildCoinPayload) so we don't score the whole field in the
 * push path; the in-app feed entry and the shelf carry the actual tier.
 *
 * Only sends to players who took part (≥1 real pick that event) AND have a push
 * subscription AND have `coin.push` enabled in their notification preferences.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import { buildCoinPayload } from "@/lib/notify-core";
import { parseNotifPrefs } from "@/lib/notifications-core";
import { EVENTS, getEventConfig } from "@/lib/events-core";
import { coinMintAtMs } from "@/lib/event-freeze";

/** Only ping for a Major archived within this window (bounds restart re-pings). */
const RECENCY_MS = 7 * 24 * 60 * 60_000;

/** eventIds whose coin push has already fired this process lifetime. */
const fired = new Set<number>();

export async function runCoinEarnedPushes(now: number = Date.now()): Promise<void> {
  for (const eventId of Object.keys(EVENTS).map(Number)) {
    if (fired.has(eventId)) continue;

    const archivedAtMs = await coinMintAtMs(eventId, now);
    if (archivedAtMs === null) continue; // still live/upcoming
    if (now - archivedAtMs > RECENCY_MS) {
      // Archived too long ago to ping now (e.g. fresh process, old Major) — mark
      // fired so we don't re-check it every tick.
      fired.add(eventId);
      continue;
    }

    // Everyone who took part in this Major (≥1 real, non-cleared pick).
    const participants = await prisma.pick.findMany({
      where: { eventId, pickId: { not: 0 } },
      select: { playerId: true },
      distinct: ["playerId"],
    });

    // Mark fired before fan-out so a mid-batch DB error doesn't re-ping everyone
    // next tick.
    fired.add(eventId);
    if (participants.length === 0) continue;

    const ids = participants.map((p) => p.playerId);
    const [subbed, players] = await Promise.all([
      prisma.pushSubscription.findMany({
        where: { playerId: { in: ids } },
        select: { playerId: true },
        distinct: ["playerId"],
      }),
      prisma.player.findMany({
        where: { id: { in: ids } },
        select: { id: true, notifPrefs: true },
      }),
    ]);
    const hasSub = new Set(subbed.map((s) => s.playerId));
    const prefsById = new Map(players.map((p) => [p.id, parseNotifPrefs(p.notifPrefs)]));

    const cfg = getEventConfig(eventId);
    const payload = buildCoinPayload({ eventName: cfg?.name ?? "Major", eventId });

    let sent = 0;
    for (const playerId of ids) {
      if (!hasSub.has(playerId)) continue;
      if (!prefsById.get(playerId)?.coin.push) continue;
      const outcome = await sendPushToPlayer(playerId, payload);
      sent += outcome.sent;
    }
    console.log(`[coin-push] event ${eventId} (${cfg?.name ?? "?"}): ${sent} push(es)`);
  }
}
