/**
 * announcement-pushes — one-shot push per new broadcast announcement (PHA-1239).
 *
 * Compares currently-active announcements against an in-process `fired` Set
 * keyed by announcement id. Each newly-active announcement triggers a fan-out
 * to players with `announce.push` enabled. Fires at most once per announcement
 * per process lifetime — a restart re-arms the set; at worst one duplicate,
 * which the notification `tag` collapses client-side.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import { buildAnnouncementPayload } from "@/lib/notify-core";
import { parseNotifPrefs } from "@/lib/notifications-core";
import { activeAnnouncements } from "@/lib/announcements-core";

/** Announcement ids pushed this process lifetime. */
const fired = new Set<string>();

export async function runAnnouncementPushes(now: number = Date.now()): Promise<void> {
  const pending = activeAnnouncements(now).filter((a) => !fired.has(a.id));
  if (pending.length === 0) return;

  const subbed = await prisma.pushSubscription.findMany({
    select: { playerId: true },
    distinct: ["playerId"],
  });

  // Mark all fired before the fan-out so DB errors on individual players don't
  // cause re-delivery on the next tick.
  for (const a of pending) fired.add(a.id);

  if (subbed.length === 0) return;

  const playerPrefs = await prisma.player.findMany({
    where: { id: { in: subbed.map((s) => s.playerId) } },
    select: { id: true, notifPrefs: true },
  });
  const prefsById = new Map(playerPrefs.map((p) => [p.id, parseNotifPrefs(p.notifPrefs)]));

  for (const ann of pending) {
    const payload = buildAnnouncementPayload({ title: ann.title, body: ann.body, href: ann.href, id: ann.id });
    let sent = 0;
    for (const { playerId } of subbed) {
      if (!prefsById.get(playerId)?.announce.push) continue;
      const outcome = await sendPushToPlayer(playerId, payload);
      sent += outcome.sent;
    }
    console.log(`[announce-push] "${ann.id}": ${sent} push(es)`);
  }
}
