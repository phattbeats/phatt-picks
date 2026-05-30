import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCommittedLayout } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { UserDirectory, type DirRow } from "@/components/heat/UserDirectory";

const EVENT_ID = 26;

export const metadata = { title: "Directory · HOTLINE" };

export default async function DirectoryPage() {
  const layout = getCommittedLayout();
  const session = await getSession();
  await refreshOutcomesOnRead(EVENT_ID); // live driver (PHA-866) — shared 30s claim

  const [players, allPicks, outcomes] = await Promise.all([
    prisma.player.findMany(),
    prisma.pick.findMany({
      where: { eventId: EVENT_ID },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } }),
  ]);

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
    .map((p) => ({
      playerId: p.id,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      isLocal: p.isLocal,
      synced: p.synced,
      coinTier: visibleCoinTier(p),
      score: scorePlayer(layout, pickMap[p.id] ?? {}, outcomeMap).total,
      isSelf: session?.playerId === p.id,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <span className="eyebrow-mono">[ ROSTER ]</span>
          <Link href="/leaderboard" style={{
            fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em",
            textTransform: "uppercase", color: "var(--ink-mid)", textDecoration: "none",
          }}>
            Podium →
          </Link>
        </div>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          Directory
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: 0 }}>
          {rows.length} player{rows.length !== 1 ? "s" : ""} · tap anyone to view picks & compare
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="panel brk" style={{ textAlign: "center", padding: "40px 24px" }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            No players yet. <Link href="/login" style={{ color: "var(--heat)" }}>Be the first.</Link>
          </p>
        </div>
      ) : (
        <UserDirectory rows={rows} signedIn={!!session} />
      )}
    </>
  );
}
