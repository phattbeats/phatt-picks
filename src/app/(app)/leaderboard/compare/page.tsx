/**
 * Pick comparison — head-to-head, redesigned (PHA-900).
 *
 * The hook: when a stage is revealed AND results have landed, the picks YOU
 * called right that your opponent whiffed ("THE STEAL") get top billing —
 * that's the good stuff. Below it, every stage is a logo grid: all of your
 * picks lined up against all of theirs, hit/miss ringed once a result exists.
 *
 * Reveal rule is unchanged (PHA-862 / PHA-898): a group's team choices stay
 * hidden for EVERYONE until its stage locks (either Valve flips picks_allowed,
 * the published lock time passes, or a result lands). Scores are always public.
 * Section-qualified pick maps prevent a revealed stage from leaking a still-open
 * stage's secret pick across a reused groupid.
 */

import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap, type TeamDef } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { arePicksRevealed, groupOutcomeKey } from "@/lib/reveal-core";
import { getSession } from "@/lib/session";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { isLockTimePassed } from "@/lib/lock-schedule-core";
import { resolveLogoTiers } from "@/lib/logos";
import { TeamLogo } from "@/components/ui/TeamLogo";
import {
  bucketSwissSlots,
  isSwissSection,
  resolveBucketWinners,
  bucketPickState,
} from "@/lib/swiss-bucket-core";
import { isBucketImpossibleByRecord } from "@/lib/swiss-standings-core";
import { getSwissRecords } from "@/lib/swiss-results";

const EVENT_ID = 26;

export const dynamic = "force-dynamic";

type PlayerLite = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isLocal: boolean;
  synced: boolean;
};

function toPlayerPickMap(picks: { sectionId: number; groupId: number; slotIndex: number; pickId: number }[]): PlayerPickMap[string] {
  const m: PlayerPickMap[string] = {};
  for (const p of picks) {
    m[p.sectionId] ??= {};
    m[p.sectionId][p.groupId] ??= {};
    m[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  return m;
}

function provenance(p: PlayerLite): string {
  return p.isLocal ? "Local" : p.synced ? "Synced" : "Steam";
}

/** Round avatar / monogram, matching the player-profile hero. */
function Avatar({ player, size }: { player: PlayerLite; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: "var(--bg3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 700,
        fontSize: size * 0.34,
        color: "var(--text-mid)",
        flexShrink: 0,
      }}
      aria-hidden
    >
      {player.avatarUrl ? (
        <Image src={player.avatarUrl} alt="" width={size} height={size} unoptimized style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      ) : (
        player.displayName.slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

type TileState = "hit" | "miss" | "pending" | "empty";

/** One team chip in a comparison row — logo + name, ringed by outcome. */
function PickTile({
  team,
  state,
  align,
  steal,
}: {
  team: TeamDef | undefined;
  state: TileState;
  align: "left" | "right";
  steal: boolean;
}) {
  const name = team?.name ?? "—";
  const isHit = state === "hit";
  const isMiss = state === "miss";
  const reverse = align === "right";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: reverse ? "row-reverse" : "row",
        alignItems: "center",
        gap: 8,
        padding: "6px 9px",
        border: isHit ? "1px solid var(--correct)" : "1px solid var(--bg3)",
        background: isHit ? "rgba(155,210,60,0.09)" : "var(--bg2)",
        borderRadius: "var(--radius-md)",
        minWidth: 0,
        opacity: isMiss ? 0.6 : 1,
        boxShadow: steal ? "0 0 0 1px var(--correct), 0 0 14px rgba(155,210,60,0.28)" : undefined,
      }}
    >
      {team ? (
        <TeamLogo tiers={resolveLogoTiers(team)} teamName={name} size={26} />
      ) : (
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--bg3)", flexShrink: 0 }} />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 13,
          fontWeight: 600,
          color: isHit ? "var(--text-hi)" : "var(--text-mid)",
          textAlign: reverse ? "right" : "left",
          textDecoration: isMiss ? "line-through" : undefined,
        }}
      >
        {name}
      </span>
      {(isHit || isMiss) && (
        <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 800, fontSize: 13, color: isHit ? "var(--correct)" : "var(--text-low)", flexShrink: 0 }}>
          {isHit ? "✓" : "✗"}
        </span>
      )}
    </div>
  );
}

/** A "you called it" trophy chip in THE STEAL reel. */
function StealChip({ team, label }: { team: TeamDef; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px 8px 9px",
        background: "rgba(155,210,60,0.10)",
        border: "1px solid var(--correct)",
        borderRadius: "var(--radius-md)",
        flexShrink: 0,
      }}
    >
      <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={34} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)", whiteSpace: "nowrap" }}>{team.name}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mid)", whiteSpace: "nowrap" }}>{label}</div>
      </div>
    </div>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const session = await getSession();
  await refreshOutcomesOnRead(EVENT_ID); // live driver (PHA-866) — shared 30s claim

  // Live partial W-L per Swiss section (PHA-951): a 3:0/0:3 pick reads red in the
  // grid the moment the team's record rules its bucket out, before the answer key
  // resolves it. Reads the cached HLTV standings (no crawl); empty when cold.
  const matchTeams = layout.teams.map((t) => ({ pickid: t.pickid, name: t.name }));
  const recordsBySection = new Map<number, Map<number, { wins: number; losses: number }>>();
  await Promise.all(
    layout.sections
      .filter((s) => isSwissSection(s.sectionid))
      .map(async (s) => {
        recordsBySection.set(s.sectionid, await getSwissRecords(EVENT_ID, s.sectionid, matchTeams));
      }),
  );

  // Per-request server clock for the published lock schedule (PHA-898): a stage
  // that has begun reveals its picks for comparison even before Valve flips
  // picks_allowed or a result lands. Dynamic RSC, so reading the time is intended.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const players: PlayerLite[] = await prisma.player.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, avatarUrl: true, isLocal: true, synced: true },
  });

  // Need at least two players to compare.
  if (players.length < 2) {
    return (
      <div className="panel brk" style={{ padding: 32, textAlign: "center" }}>
        <span className="br-tr" />
        <span className="br-bl" />
        <span className="eyebrow-mono">[ COMPARE ]</span>
        <h1 className="font-display" style={{ fontWeight: 800, fontSize: 28, textTransform: "uppercase", color: "var(--ink-hi)", margin: "8px 0" }}>
          Two players minimum
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, margin: "0 0 16px" }}>
          You need at least two players on the board before you can compare picks.
        </p>
        <Link href="/leaderboard" className="btn-ghost">← Leaderboard</Link>
      </div>
    );
  }

  // Load every pick + outcome for the event once.
  const allPicks = await prisma.pick.findMany({ where: { eventId: EVENT_ID } });
  const outcomes = await prisma.stageOutcome.findMany({ where: { eventId: EVENT_ID } });

  const outcomeMap: OutcomeMap = {};
  const groupHasOutcome = new Set<string>(); // `${sectionId}:${groupId}` with ≥1 resolved slot
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    groupHasOutcome.add(groupOutcomeKey(o.sectionId, o.groupId));
  }

  const picksByPlayer = new Map<string, typeof allPicks>();
  for (const p of allPicks) {
    const arr = picksByPlayer.get(p.playerId) ?? [];
    arr.push(p);
    picksByPlayer.set(p.playerId, arr);
  }

  // Rank players to pick sensible defaults (self vs top opponent).
  const ranked = players
    .map((p) => ({
      player: p,
      score: scorePlayer(layout, toPlayerPickMap(picksByPlayer.get(p.id) ?? []), outcomeMap).total,
    }))
    .sort((x, y) => y.score - x.score || x.player.displayName.localeCompare(y.player.displayName));

  const defaultA = (session && ranked.find((r) => r.player.id === session.playerId)?.player.id) || ranked[0].player.id;
  const aId = params.a && players.some((p) => p.id === params.a) ? params.a : defaultA;
  const defaultB = ranked.find((r) => r.player.id !== aId)!.player.id;
  const bId = params.b && params.b !== aId && players.some((p) => p.id === params.b) ? params.b : defaultB;

  const a = players.find((p) => p.id === aId)!;
  const b = players.find((p) => p.id === bId)!;
  const aIsYou = session?.playerId === aId;
  const bIsYou = session?.playerId === bId;

  // Section-qualified pick maps (sectionId → groupId → slotIndex → pickId).
  // Must NOT be keyed by groupId alone (see PHA-862): a groupId-only map collides
  // if Valve reuses a groupid across sections, leaking a still-open section's
  // secret pick. Reuse toPlayerPickMap, which scoring also uses.
  const aPicksMap = toPlayerPickMap(picksByPlayer.get(aId) ?? []);
  const bPicksMap = toPlayerPickMap(picksByPlayer.get(bId) ?? []);

  const aScore = scorePlayer(layout, aPicksMap, outcomeMap).total;
  const bScore = scorePlayer(layout, bPicksMap, outcomeMap).total;
  const lead = aScore - bScore;

  const team = (pickId: number | undefined): TeamDef | undefined =>
    pickId && pickId !== 0 ? teamMap.get(pickId) : undefined;

  // Walk every revealed + resolved slot once: compute THE STEAL (picks one
  // player nailed that the other whiffed) and the head-to-head record.
  // Only revealed groups are inspected, so this never leaks a hidden pick.
  const aSteals: { team: TeamDef; label: string }[] = [];
  const bSteals: { team: TeamDef; label: string }[] = [];
  let bothRight = 0;
  // sectionId:groupid → revealed?  (computed once, reused by the grid below)
  const revealedByGroup = new Map<string, boolean>();

  for (const section of layout.sections) {
    const stageLabel = section.name.split(" | ")[0];
    for (const group of section.groups) {
      const gKey = `${section.sectionid}:${group.groupid}`;
      const revealed = arePicksRevealed(
        group,
        groupHasOutcome.has(groupOutcomeKey(section.sectionid, group.groupid)),
        isLockTimePassed(section.sectionid, nowMs),
      );
      revealedByGroup.set(gKey, revealed);
      if (!revealed) continue;

      const aGroup = aPicksMap[section.sectionid]?.[group.groupid] ?? {};
      const bGroup = bPicksMap[section.sectionid]?.[group.groupid] ?? {};
      const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};

      // Judge picks at BUCKET grain for Swiss (PHA-946): within a 3:0 / advance /
      // 0:3 bucket the slots are interchangeable, so a team that landed in the
      // bucket counts no matter which slot row its winner occupies — same grain
      // scoring.ts uses. Playoffs collapse to one single-slot bucket per match
      // (a match's winner is strict per slot). The bucket also tags the steal's
      // label ("Stage I · 3:0") — the bucket is the story, not slot N of 10.
      const isSwiss = isSwissSection(section.sectionid);
      const buckets = isSwiss
        ? bucketSwissSlots(group.picks.length)
        : group.picks.map((p) => ({ label: "", slotIndexes: [p.index] }));

      for (const bucket of buckets) {
        const { winners } = resolveBucketWinners(bucket.slotIndexes, groupOutcomes);
        if (winners.size === 0) continue; // nothing resolved in this bucket yet
        const aPicked = new Set(bucket.slotIndexes.map((i) => aGroup[i]).filter((x) => x && x !== 0));
        const bPicked = new Set(bucket.slotIndexes.map((i) => bGroup[i]).filter((x) => x && x !== 0));
        const label = isSwiss ? `${stageLabel} · ${bucket.label.split(" ")[0]}` : stageLabel;
        for (const winner of winners) {
          const winTeam = team(winner);
          if (!winTeam) continue;
          const aRight = aPicked.has(winner);
          const bRight = bPicked.has(winner);
          if (aRight && bRight) bothRight++;
          else if (aRight) aSteals.push({ team: winTeam, label });
          else if (bRight) bSteals.push({ team: winTeam, label });
        }
      }
    }
  }

  const head = (p: PlayerLite, score: number, you: boolean, side: "left" | "right") => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: side === "left" ? "flex-start" : "flex-end", gap: 6, minWidth: 0 }}>
      <Avatar player={p} size={52} />
      <div
        style={{
          fontWeight: 700,
          fontSize: 15,
          color: "var(--text-hi)",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: side,
        }}
      >
        {p.displayName}
        {you && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--heat)", marginLeft: 6 }}>· YOU</span>}
      </div>
      <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 800, fontSize: 40, lineHeight: 0.9, color: score > 0 ? "var(--correct)" : "var(--text-low)" }}>
        {score}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-low)" }}>
        {provenance(p)}
      </div>
    </div>
  );

  const resolvedAny = aSteals.length + bSteals.length + bothRight > 0;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link href="/leaderboard" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mid)", textDecoration: "none" }}>
          ← Leaderboard
        </Link>
        <span className="eyebrow-mono">[ HEAD_TO_HEAD ]</span>
        <h1 className="font-display" style={{ fontWeight: 800, fontSize: "clamp(28px, 5vw, 40px)", textTransform: "uppercase", lineHeight: 0.95 }}>
          Compare
        </h1>
      </div>

      {/* Hero scoreboard */}
      <section
        className="brk"
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: "var(--space-3)",
          margin: "var(--space-4) 0",
          padding: "var(--space-4) var(--space-3)",
          background: "linear-gradient(135deg, var(--surf-2), var(--surf-1))",
          border: "1px solid var(--bg3)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <span className="br-tr" />
        <span className="br-bl" />
        {head(a, aScore, aIsYou, "left")}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 800, fontSize: 18, color: "var(--text-low)" }}>VS</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: lead === 0 ? "var(--text-low)" : "var(--heat)",
              whiteSpace: "nowrap",
            }}
          >
            {lead === 0 ? "TIED" : lead > 0 ? `+${lead} ←` : `→ +${-lead}`}
          </span>
        </div>
        {head(b, bScore, bIsYou, "right")}
      </section>

      {/* THE STEAL — picks called right that the other whiffed */}
      <section style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
          <span className="eyebrow-mono" style={{ color: "var(--correct)" }}>[ THE_STEAL ]</span>
          {resolvedAny && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", color: "var(--text-low)" }}>
              {aSteals.length}–{bSteals.length} · {bothRight} SHARED
            </span>
          )}
        </div>

        {!resolvedAny ? (
          <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--text-low)", fontSize: 13, background: "var(--bg1)", border: "1px dashed var(--bg3)", borderRadius: "var(--radius-md)" }}>
            No results in yet. The moment matches resolve, the picks you nailed that {bIsYou ? "they" : b.displayName} missed land right here.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-mid)", marginBottom: 6 }}>
                {aIsYou ? "You" : a.displayName} called it · {b.displayName} didn&apos;t — {aSteals.length}
              </div>
              {aSteals.length ? (
                <div style={{ display: "flex", gap: "var(--space-2)", overflowX: "auto", paddingBottom: 4 }}>
                  {aSteals.map((s, i) => <StealChip key={`a${i}`} team={s.team} label={s.label} />)}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-low)" }}>Nothing yet.</div>
              )}
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-mid)", marginBottom: 6 }}>
                {b.displayName} called it · {aIsYou ? "you" : a.displayName} didn&apos;t — {bSteals.length}
              </div>
              {bSteals.length ? (
                <div style={{ display: "flex", gap: "var(--space-2)", overflowX: "auto", paddingBottom: 4 }}>
                  {bSteals.map((s, i) => <StealChip key={`b${i}`} team={s.team} label={s.label} />)}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-low)" }}>Nothing yet.</div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Opponent switcher */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-low)", marginBottom: 6 }}>
          Compare against
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {players
            .filter((p) => p.id !== aId)
            .map((p) => {
              const active = p.id === bId;
              return (
                <a
                  key={p.id}
                  href={`/leaderboard/compare?a=${aId}&b=${p.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "5px 12px 5px 6px",
                    borderRadius: "var(--radius-md)",
                    background: active ? "var(--accent)" : "var(--bg2)",
                    color: active ? "#1c1812" : "var(--text-mid)",
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    minHeight: 36,
                    border: active ? "1px solid var(--accent)" : "1px solid var(--bg3)",
                  }}
                >
                  <Avatar player={p} size={24} />
                  {p.displayName}
                </a>
              );
            })}
        </div>
      </div>

      {/* Per-stage logo grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {layout.sections.map((section) => {
          const stageLabel = section.name.split(" | ")[0];
          const isSwiss = isSwissSection(section.sectionid);
          return (
            <div key={section.sectionid}>
              <h2 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-mid)", margin: "0 0 var(--space-2)" }}>
                {stageLabel}
              </h2>

              {section.groups.map((group) => {
                const revealed = revealedByGroup.get(`${section.sectionid}:${group.groupid}`) ?? false;
                const aGroup = aPicksMap[section.sectionid]?.[group.groupid] ?? {};
                const bGroup = bPicksMap[section.sectionid]?.[group.groupid] ?? {};
                const groupOutcomes = outcomeMap[section.sectionid]?.[group.groupid] ?? {};

                return (
                  <div
                    key={group.groupid}
                    style={{ background: "var(--bg1)", border: "1px solid var(--bg3)", borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: "var(--space-2)" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "var(--space-2) var(--space-3)",
                        borderBottom: revealed ? "1px solid var(--bg3)" : "none",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--text-mid)", fontWeight: 700 }}>
                        {group.name.split(" | ").slice(-1)[0]}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--accent)", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}>
                        {group.points_per_pick} PT{group.points_per_pick !== 1 ? "S" : ""}/PICK
                      </span>
                    </div>

                    {!revealed ? (
                      <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--text-low)", fontSize: 13 }}>
                        🔒 Both players&apos; picks unlock when this stage starts
                      </div>
                    ) : (
                      <div style={{ padding: "var(--space-2) var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                        {/* Swiss stages split into the 2 / 6 / 2 buckets (3:0 advance,
                            advancing, 0:3 out) — the real structure, not a flat 1-10.
                            Reuses the same convention as the picks board (PHA-853). */}
                        {(isSwiss
                          ? bucketSwissSlots(group.picks.length)
                          : [{ label: group.name.split(" | ").slice(-1)[0], slotIndexes: group.picks.map((p) => p.index) }]
                        ).map((bucket) => {
                          // Swiss → judge the whole bucket as a set (PHA-946);
                          // playoffs → each slot is its own match, resolved per row.
                          const swissRes = isSwiss ? resolveBucketWinners(bucket.slotIndexes, groupOutcomes) : null;
                          const aBucketPicked = isSwiss
                            ? new Set(bucket.slotIndexes.map((i) => aGroup[i]).filter((x) => x && x !== 0))
                            : null;
                          const bBucketPicked = isSwiss
                            ? new Set(bucket.slotIndexes.map((i) => bGroup[i]).filter((x) => x && x !== 0))
                            : null;
                          return (
                          <div key={bucket.label}>
                            {isSwiss && (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-mid)", fontWeight: 700 }}>
                                  {bucket.label}
                                </span>
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-low)" }}>
                                  {bucket.slotIndexes.length} PICK{bucket.slotIndexes.length !== 1 ? "S" : ""}
                                </span>
                              </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {bucket.slotIndexes.map((slotIndex) => {
                                const aPick = aGroup[slotIndex];
                                const bPick = bGroup[slotIndex];
                                const res = swissRes ?? resolveBucketWinners([slotIndex], groupOutcomes);
                                const aScope = aBucketPicked ?? new Set([aPick].filter((x) => x && x !== 0));
                                const bScope = bBucketPicked ?? new Set([bPick].filter((x) => x && x !== 0));
                                // Early-red (PHA-951): a 3:0/0:3 pick whose team's
                                // partial record already rules its bucket out is a
                                // miss now, before the answer key resolves it. Swiss
                                // only — playoff matches resolve strictly per slot.
                                const recs = isSwiss ? recordsBySection.get(section.sectionid) : undefined;
                                const aImpossible = !!aPick && isBucketImpossibleByRecord(bucket.label, recs?.get(aPick));
                                const bImpossible = !!bPick && isBucketImpossibleByRecord(bucket.label, recs?.get(bPick));
                                const aState = bucketPickState(aPick, res, aImpossible);
                                const bState = bucketPickState(bPick, res, bImpossible);
                                // Steal = you hit a team your opponent never picked (in scope).
                                const aSteal = aState === "hit" && aPick !== undefined && !bScope.has(aPick);
                                const bSteal = bState === "hit" && bPick !== undefined && !aScope.has(bPick);
                                return (
                                  <div
                                    key={slotIndex}
                                    style={{ display: "grid", gridTemplateColumns: "1fr 22px 1fr", alignItems: "center", gap: "var(--space-2)" }}
                                  >
                                    <PickTile team={team(aPick)} state={aState} align="left" steal={aSteal} />
                                    <span style={{ textAlign: "center", color: "var(--text-low)", fontFamily: "var(--font-mono)", fontSize: 10 }}>·</span>
                                    <PickTile team={team(bPick)} state={bState} align="right" steal={bSteal} />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
