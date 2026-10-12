import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCommittedLayout } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { UserDirectory, type DirRow } from "@/components/heat/UserDirectory";
import { currentEvent, previousMajor } from "@/lib/events-core";
import { majorFinishesAndCoins, majorShortName, ordSuffix } from "@/components/sg/people/people-data";

export const metadata = { title: "Directory · HOTLINE" };

export default async function DirectoryPage() {
  // Per-request active event (#1046) — follows the clock across Majors, no redeploy.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const event = currentEvent(nowMs);
  const EVENT_ID = event.eventId;
  const layout = getCommittedLayout();
  const session = await getSession();
  await refreshOutcomesOnRead(EVENT_ID); // live driver (#866) — shared 30s claim

  const [players, allPicks, outcomes] = await Promise.all([
    prisma.player.findMany(),
    prisma.pick.findMany({
      where: { eventId: EVENT_ID },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } }),
  ]);

  // The last concluded Major (Cologne): each player's finish there and the
  // challenge coin it minted — read-only, same maths as the profile shelf.
  const prev = previousMajor(nowMs);
  const prevField = prev ? await majorFinishesAndCoins(prev, nowMs) : null;
  const prevName = prev ? majorShortName(prev).replace(/^IEM\s+/, "").replace(/\s+\d{4}$/, "") : "";

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const pickMap: PlayerPickMap = {};
  for (const p of allPicks) {
    pickMap[p.playerId] ??= {};
    pickMap[p.playerId][p.sectionId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }

  const rows: DirRow[] = players
    .map((p) => {
      const finish = prevField?.finishById.get(p.id) ?? null;
      const coin = prevField?.coinById.get(p.id) ?? null;
      return {
        playerId: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isLocal: p.isLocal,
        synced: p.synced,
        coinTier: visibleCoinTier(p),
        score: scorePlayer(layout, pickMap[p.id] ?? {}, outcomeMap).total,
        isSelf: session?.playerId === p.id,
        rank: 0,
        lastMajor: finish != null ? `${prevName} ${finish}${ordSuffix(finish)}` : null,
        // Coin thumbnails only on Steam-synced players (never local ones).
        challengeCoin: coin && p.synced && !p.isLocal ? coin : null,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const synced = rows.filter((r) => r.synced && !r.isLocal).length;

  return (
    <div className="pp-page">
      <section className="bleed short">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wrapped/major-thanks.jpg" alt="" />
        <span className="credit">Photo · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">
            {majorShortName(event)} · <b>{rows.length} player{rows.length !== 1 ? "s" : ""}</b>
          </span>
          <h1 className="display rise d1">The room</h1>
          <p className="rise d2">
            Everyone calling this Major. <b>{synced} Steam-synced.</b> Tap anyone to see their picks.
          </p>
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="chap">
          <div className="chap-h">
            <h2>Nobody here yet</h2>
            <p>
              The room fills as players join. <Link href="/login" prefetch={false}>Be the first.</Link>
            </p>
          </div>
        </section>
      ) : (
        <section className="chap">
          <div className="chap-h row2">
            <div>
              <h2>Every player</h2>
            </div>
            <Link href="/leaderboard" prefetch={false} className="eyebrow">Leaderboard →</Link>
          </div>
          <UserDirectory rows={rows} signedIn={!!session} />
        </section>
      )}
    </div>
  );
}
