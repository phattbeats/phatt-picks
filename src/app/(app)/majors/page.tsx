/**
 * "Your Majors" — the headline of multi-major workstream B (PHA-949):
 * "historic scores, so you can look back at your picks throughout every Major."
 *
 * Every Major the signed-in player has played (a distinct eventId in their Pick
 * rows that the registry knows about), newest first, with their score, their
 * finish among the field, and a link into that event's full profile.
 *
 * Data is already persisted per eventId, so this is a read view — no schema, no
 * crawl. Scoring reuses the leaderboard's exact maths (scorePlayer + the score-
 * desc / name tiebreak) so a Major's "finish" here matches its leaderboard rank.
 *
 * Per-event layout: today only the live event's layout fixture is loadable
 * (getCommittedLayout), and every persisted pick belongs to it, so every row
 * scores correctly. When the cutover lands per-event layout fixtures, swap the
 * `layoutFor` lookup; rows whose layout can't be loaded degrade honestly to an
 * unscored entry (— / no finish) rather than mis-scoring against the wrong
 * fixture.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getCommittedLayout, type Layout } from "@/lib/layout";
import { scorePlayer, type OutcomeMap, type PlayerPickMap } from "@/lib/scoring";
import { getEventConfig } from "@/lib/events-core";
import {
  buildMajorsHistory,
  computeFinish,
  isEventArchived,
  type MajorHistoryRow,
} from "@/lib/majors-core";

function ordSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function statusChip(status: MajorHistoryRow["status"]) {
  const map = {
    live: { label: "Live", color: "var(--heat)", bg: "rgba(240,163,0,0.12)" },
    archived: { label: "Final", color: "var(--ink-mid)", bg: "var(--surf-2)" },
    upcoming: { label: "Upcoming", color: "var(--ink-mid)", bg: "var(--surf-2)" },
  } as const;
  const s = map[status];
  return (
    <span style={{
      padding: "2px 8px",
      background: s.bg,
      border: "1px solid var(--hair-2)",
      fontFamily: "var(--font-mono)",
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

export default async function MajorsPage() {
  const session = await getSession();

  if (!session) {
    return (
      <>
        <span className="eyebrow-mono">YOUR MAJORS</span>
        <div className="panel brk" style={{ textAlign: "center", padding: "48px 24px", marginTop: 12 }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <p className="font-display" style={{ fontWeight: 700, fontSize: 22, color: "var(--ink-hi)", textTransform: "uppercase", margin: "0 0 6px" }}>
            Sign in to look back
          </p>
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            Your Majors history follows your account —{" "}
            <Link href="/login/auth" style={{ color: "var(--heat)" }}>sign in</Link>{" "}
            or{" "}
            <Link href="/login/local" style={{ color: "var(--ink-mid)" }}>play locally</Link>.
          </p>
        </div>
      </>
    );
  }

  // Which Majors has this player played? (distinct events in their picks.)
  const playedRows = await prisma.pick.findMany({
    where: { playerId: session.playerId },
    distinct: ["eventId"],
    select: { eventId: true },
  });
  const eventIds = playedRows.map((r) => r.eventId);

  const committed = getCommittedLayout();
  /** The layout fixture that describes a given event, or null if not loadable. */
  const layoutFor = (eventId: number): Layout | null =>
    committed.event === eventId ? committed : null;

  const rows: MajorHistoryRow[] = [];
  for (const eventId of eventIds) {
    const cfg = getEventConfig(eventId);
    if (!cfg) continue; // an event the registry doesn't know — no name/status to show

    const layout = layoutFor(eventId);

    // The whole field for this event: score everyone, rank, then read off finish.
    const allPicks = await prisma.pick.findMany({
      where: { eventId },
      include: { player: { select: { displayName: true } } },
    });
    const outcomes = await prisma.stageOutcome.findMany({ where: { eventId } });

    const outcomeMap: OutcomeMap = {};
    for (const o of outcomes) {
      outcomeMap[o.sectionId] ??= {};
      outcomeMap[o.sectionId][o.groupId] ??= {};
      outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    }

    const pickMap: PlayerPickMap = {};
    const nameById: Record<string, string> = {};
    let myPickCount = 0;
    for (const p of allPicks) {
      pickMap[p.playerId] ??= {};
      pickMap[p.playerId][p.sectionId] ??= {};
      pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
      pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
      nameById[p.playerId] = p.player.displayName;
      if (p.playerId === session.playerId && p.pickId !== 0) myPickCount++;
    }

    const playerIds = Object.keys(pickMap);
    const scoreById: Record<string, number> = {};
    for (const pid of playerIds) {
      scoreById[pid] = layout ? scorePlayer(layout, pickMap[pid], outcomeMap).total : 0;
    }
    // Same ordering as the leaderboard: score desc, then displayName asc.
    const ranked = [...playerIds].sort(
      (a, b) => scoreById[b] - scoreById[a] || (nameById[a] ?? "").localeCompare(nameById[b] ?? ""),
    );

    rows.push({
      eventId,
      slug: cfg.slug,
      name: cfg.name,
      status: cfg.status,
      start: cfg.dates.start,
      scored: layout != null,
      score: layout ? scoreById[session.playerId] ?? 0 : 0,
      finish: layout ? computeFinish(session.playerId, ranked) : null,
      fieldSize: playerIds.length,
      pickCount: myPickCount,
    });
  }

  const history = buildMajorsHistory(rows);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">YOUR MAJORS</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
          margin: 0,
        }}>
          Look back at your picks
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 13, margin: 0 }}>
          {history.length === 0
            ? "Every Major you play shows up here."
            : `${history.length} Major${history.length !== 1 ? "s" : ""} played · your score and finish in each.`}
        </p>
      </div>

      {history.length === 0 ? (
        <div className="panel brk" style={{ textAlign: "center", padding: "48px 24px", marginTop: 12 }}>
          <span className="br-tr" />
          <span className="br-bl" />
          <p className="font-display" style={{ fontWeight: 700, fontSize: 20, color: "var(--ink-hi)", textTransform: "uppercase", margin: "0 0 6px" }}>
            No Majors yet
          </p>
          <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: 0 }}>
            Make your{" "}
            <Link href="/picks" style={{ color: "var(--heat)" }}>picks</Link>{" "}
            for the live Major and they&apos;ll land here.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {history.map((row) => (
            <Link
              key={row.eventId}
              href={`/players/${encodeURIComponent(session.playerId)}?event=${row.eventId}`}
              className={isEventArchived(row.status) ? "" : "brk"}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "16px",
                background: "var(--surf-1)",
                border: "1px solid var(--hair)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-hi)" }}>
                    {row.name}
                  </span>
                  {statusChip(row.status)}
                </div>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  color: "var(--ink-mid)",
                }}>
                  {/* PHA-1046: when the layout fixture isn't loadable the score is
                      not a genuine 0 — say so explicitly rather than imply a result. */}
                  {!row.scored
                    ? "Score unavailable"
                    : row.finish !== null
                      ? `${row.finish}${ordSuffix(row.finish)} of ${row.fieldSize}`
                      : "Not scored"}
                  {row.pickCount > 0 && ` · ${row.pickCount} picks`}
                </span>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  fontSize: 24,
                  color: row.scored && row.score > 0 ? "var(--ink-hi)" : "var(--ink-low)",
                  lineHeight: 1,
                }}>
                  {row.scored ? row.score : "—"}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--ink-low)",
                }}>
                  {row.scored ? "pts" : "n/a"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
