import Image from "next/image";
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GameTime } from "@/components/heat/GameTime";
import { LastUpdated } from "@/components/LastUpdated";
import { RankAvatar } from "@/components/sg/ranks/RankAvatar";
import { FantasyDraft } from "@/components/fantasy/FantasyDraft";
import { PlayerFace } from "@/components/fantasy/PlayerFace";
import { getSession } from "@/lib/session";
import { EVENTS, currentEvent, getEventConfig, type EventConfig } from "@/lib/events-core";
import { eventShortName, resolveArchiveEvent } from "@/lib/leaderboard";
import { PHOTOS } from "@/lib/photos";
import { getSwissBracket } from "@/lib/swiss-results";
import {
  actionFor,
  buildFantasyBoard,
  fantasyArchiveEvents,
  hasFantasy,
  refreshFantasyOnRead,
  teamStanding,
  type FantasyBoard,
  type ManagerRow,
  type StageView,
} from "@/lib/fantasy";
import {
  CAPTAIN_MULTIPLIER,
  GLUE_MIN_KAST,
  HITTER_MIN_ADR,
  MAX_PER_TEAM,
  PLACEMENT_POINTS,
  ROLES,
  ROLE_BONUS,
  ROLE_INFO,
  SWISS_PERFECT_BONUS,
  TIERS,
  TIER_LABEL,
  WIN_POINTS,
  playerStageTable,
  scoreMatch,
  type FantasyMatchData,
  type FantasyPlayer,
  type ScoredLineup,
} from "@/lib/fantasy-core";

export const dynamic = "force-dynamic";

const VIEWS = ["team", "league", "players", "matches", "rules"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  team: "My team",
  league: "League",
  players: "Players",
  matches: "Matches",
  rules: "Rules",
};

const PHASE_TAG: Record<StageView["phase"], { label: string; cls: string }> = {
  waiting: { label: "Not set", cls: "" },
  open: { label: "Open", cls: "warn" },
  live: { label: "Live", cls: "crit" },
  final: { label: "Final", cls: "ok" },
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** A /fantasy link. Carries `major` only for a Major that is not the current one. */
function href(eventId: number, stageId: number, view: View, manager?: string, scope?: "all"): string {
  const q = new URLSearchParams({ stage: String(stageId), view });
  if (eventId !== currentEvent().eventId) q.set("major", EVENTS[eventId]?.slug ?? String(eventId));
  if (manager) q.set("manager", manager);
  if (scope) q.set("scope", scope);
  return `/fantasy?${q.toString()}`;
}

/** Tabs of a past Major's board: nothing to draft, so no "My team" and no rules. */
const ARCHIVE_VIEWS: readonly View[] = ["players", "matches", "league"];

export default async function FantasyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Outside production (or with FANTASY_PREVIEW=1), `?event=<valve id>` shows
  // another Major's board, so a finished stage replayed through the pipeline
  // can be looked at.
  const preview = process.env.NODE_ENV !== "production" || process.env.FANTASY_PREVIEW === "1";
  const debugEvent = preview ? getEventConfig(Number(first(params.event))) : null;
  // `?major=<slug>` opens a past Major's board, like /leaderboard?major=.
  const pastEvent = resolveArchiveEvent(first(params.major));
  const event = debugEvent ?? (pastEvent && hasFantasy(pastEvent.eventId) ? pastEvent : currentEvent());
  const archive = event.eventId !== currentEvent().eventId;
  const session = await getSession();
  const board = await buildFantasyBoard(event.eventId, session?.playerId ?? null);

  if (!board) {
    return (
      <div className="fx-page">
        <header className="page-head">
          <span className="eyebrow">Fantasy</span>
          <h1 className="display">Fantasy</h1>
          <p className="muted">Fantasy opens with the next Major.</p>
        </header>
      </div>
    );
  }

  if (archive) return <ArchivePage board={board} event={event} params={params} selfId={session?.playerId ?? null} />;

  refreshFantasyOnRead(event.eventId);
  const past = await fantasyArchiveEvents();

  const { ctx } = board;
  const stageParam = Number(first(params.stage));
  const view: StageView = ctx.stages.find((v) => v.stage.id === stageParam) ?? ctx.stages.find((v) => v.stage.id === ctx.currentStageId)!;
  const viewParam = first(params.view) as View | undefined;
  const tab: View = viewParam && VIEWS.includes(viewParam) ? viewParam : "team";
  const managerParam = first(params.manager);
  const selfId = session?.playerId ?? null;
  const anyLive = ctx.stages.some((v) => v.phase === "live");

  return (
    <div className="fx-page">
      {anyLive && <AutoRefresh intervalMs={120_000} />}
      <section className="bleed short">
        <Image src={PHOTOS.playersHero} alt="" fill priority sizes="100vw" />
        <span className="credit">Photo · IEM Cologne Major 2026 · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">
            <b>Fantasy</b> · {eventShortName(event)}
          </span>
          <h1 className="display rise d1">Your five</h1>
          <p className="rise d2">
            Draft five players for each stage. They score from <b>every match they play</b>.
          </p>
        </div>
      </section>

      {past.map((e) => (
        <Link key={e.eventId} href={`/fantasy?major=${encodeURIComponent(e.slug)}`} prefetch={false} className="rk-archive fx-archive">
          <span className="eyebrow">Past Major</span>
          <span className="rk-archive-t">
            Fantasy board · {eventShortName(e)} <span aria-hidden>→</span>
          </span>
        </Link>
      ))}

      <nav className="fx-rail" aria-label="Stages">
        {ctx.stages.map((v, i) => {
          const mine = selfId ? board.scored.get(`${selfId}:${v.stage.id}`) : undefined;
          const tag = PHASE_TAG[v.phase];
          return (
            <Link
              key={v.stage.id}
              href={href(event.eventId, v.stage.id, tab === "rules" ? "team" : tab)}
              prefetch={false}
              className={`fx-rail-step ${v.phase}${v.stage.id === view.stage.id ? " on" : ""}`}
              aria-current={v.stage.id === view.stage.id ? "step" : undefined}
            >
              <span className="fx-rail-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="fx-rail-name">{v.stage.short}</span>
              <span className={`tag ${tag.cls}`}>{tag.label}</span>
              <span className="fx-rail-pts mono">{mine ? `${mine.score.total} pts` : v.phase === "waiting" ? "" : "No team"}</span>
            </Link>
          );
        })}
      </nav>

      <div className="tabs fx-tabs" role="tablist">
        {VIEWS.map((v) => (
          <Link key={v} href={href(event.eventId, view.stage.id, v)} prefetch={false} className={v === tab && !managerParam ? "on" : undefined} role="tab" aria-selected={v === tab}>
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </div>

      {managerParam ? (
        <ManagerView board={board} view={view} managerId={managerParam} selfId={selfId} />
      ) : tab === "team" ? (
        <TeamView board={board} view={view} selfId={selfId} eventId={event.eventId} />
      ) : tab === "league" ? (
        <LeagueView board={board} view={view} />
      ) : tab === "players" ? (
        <PlayersView board={board} view={view} selfId={selfId} />
      ) : tab === "matches" ? (
        <MatchesView board={board} view={view} selfId={selfId} />
      ) : (
        <RulesView />
      )}
    </div>
  );
}

/* ── A past Major ─────────────────────────────────────────────────────── */

/**
 * A finished Major's fantasy board, read-only: who scored what in each stage
 * and over the whole Major, every match, and the league as it ended. Built
 * from the stored matches alone, so it does not depend on today's rosters.
 */
function ArchivePage({
  board,
  event,
  params,
  selfId,
}: {
  board: FantasyBoard;
  event: EventConfig;
  params: Record<string, string | string[] | undefined>;
  selfId: string | null;
}) {
  const { ctx } = board;
  const live = currentEvent();
  const stageParam = Number(first(params.stage));
  const played = ctx.stages.filter((v) => v.matches.length > 0);
  const view: StageView = ctx.stages.find((v) => v.stage.id === stageParam) ?? played[played.length - 1] ?? ctx.stages[0];
  const viewParam = first(params.view) as View | undefined;
  const tab: View = viewParam && ARCHIVE_VIEWS.includes(viewParam) ? viewParam : "players";
  const managerParam = first(params.manager);
  const whole = first(params.scope) === "all";
  const allMatches = ctx.stages.flatMap((v) => v.matches);

  return (
    <div className="fx-page">
      <section className="bleed short">
        <Image src={PHOTOS.playersHero} alt="" fill priority sizes="100vw" />
        <span className="credit">Photo · IEM Cologne Major 2026 · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">
            <b>Fantasy</b> · {eventShortName(event)} · Final
          </span>
          <h1 className="display rise d1">The final board</h1>
          <p className="rise d2">
            How every player scored at {eventShortName(event)}, <b>stage by stage</b>.
          </p>
        </div>
      </section>

      <Link href="/fantasy" prefetch={false} className="rk-archive fx-archive">
        <span className="eyebrow">Live fantasy</span>
        <span className="rk-archive-t">
          <span aria-hidden>←</span> {eventShortName(live)}
        </span>
      </Link>

      <nav className="fx-rail" aria-label="Stages">
        {ctx.stages.map((v, i) => {
          const mine = selfId ? board.scored.get(`${selfId}:${v.stage.id}`) : undefined;
          const on = v.stage.id === view.stage.id && !(whole && tab === "players");
          return (
            <Link
              key={v.stage.id}
              href={href(event.eventId, v.stage.id, tab)}
              prefetch={false}
              className={`fx-rail-step ${v.matches.length > 0 ? "final" : "waiting"}${on ? " on" : ""}`}
              aria-current={on ? "step" : undefined}
            >
              <span className="fx-rail-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="fx-rail-name">{v.stage.short}</span>
              <span className={`tag${v.matches.length > 0 ? " ok" : ""}`}>{v.matches.length > 0 ? "Final" : "No data"}</span>
              <span className="fx-rail-pts mono">
                {mine ? `${mine.score.total} pts` : `${v.matches.length} match${v.matches.length === 1 ? "" : "es"}`}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="tabs fx-tabs" role="tablist">
        {ARCHIVE_VIEWS.map((v) => (
          <Link key={v} href={href(event.eventId, view.stage.id, v)} prefetch={false} className={v === tab && !managerParam ? "on" : undefined} role="tab" aria-selected={v === tab}>
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </div>

      {managerParam ? (
        <ManagerView board={board} view={view} managerId={managerParam} selfId={selfId} />
      ) : tab === "league" ? (
        board.overall.length > 0 ? (
          <LeagueView board={board} view={view} />
        ) : (
          <section className="chap">
            <p className="rk-note">
              <b>No fantasy teams were drafted for {eventShortName(event)}.</b> The player and match boards show how a draft would have scored.
            </p>
          </section>
        )
      ) : tab === "matches" ? (
        <MatchesView board={board} view={view} selfId={selfId} />
      ) : (
        <ArchivePlayersView
          eventId={event.eventId}
          view={view}
          matches={whole ? allMatches : view.matches}
          whole={whole}
          eventName={eventShortName(event)}
        />
      )}
    </div>
  );
}

function ArchivePlayersView({
  eventId,
  view,
  matches,
  whole,
  eventName,
}: {
  eventId: number;
  view: StageView;
  matches: FantasyMatchData[];
  whole: boolean;
  eventName: string;
}) {
  const table = playerStageTable(matches, null);
  // Each player's nick and team as HLTV printed them in his latest match.
  const who = new Map<number, { nick: string; team: string }>();
  for (const m of [...matches].sort((a, b) => a.startMs - b.startMs)) {
    for (const p of m.players) {
      who.set(p.id, { nick: p.nick, team: p.hltvTeamId === m.team1.hltvTeamId ? m.team1.name : m.team2.name });
    }
  }
  const photoOf = new Map(view.pool.map((p) => [p.id, p.photo]));
  const scope = whole ? eventName : view.stage.short;
  const top = table.slice(0, 3);
  return (
    <section className="chap">
      <div className="chap-h">
        <span className="n">{scope}</span>
        <h2>Top scorers</h2>
        <p>
          Placement and win points from {matches.length} match{matches.length === 1 ? "" : "es"}, before role cards and captain multipliers.
        </p>
      </div>
      <div className="tabs fx-scope" role="tablist" aria-label="Scope">
        <Link href={href(eventId, view.stage.id, "players")} prefetch={false} className={whole ? undefined : "on"} role="tab" aria-selected={!whole}>
          {view.stage.short}
        </Link>
        <Link href={href(eventId, view.stage.id, "players", undefined, "all")} prefetch={false} className={whole ? "on" : undefined} role="tab" aria-selected={whole}>
          Whole Major
        </Link>
      </div>
      {table.length === 0 ? (
        <p className="rk-note">No stored matches for {scope}.</p>
      ) : (
        <>
          <div className="cells fx-sum fx-top3" style={{ ["--n" as string]: top.length }}>
            {top.map((l, i) => (
              <div key={l.playerId}>
                <span className="k">#{i + 1}</span>
                <span className="v fx-sum-name">{who.get(l.playerId)?.nick ?? `Player ${l.playerId}`}</span>
                <span className="s">
                  {l.points} pts · {who.get(l.playerId)?.team} · {l.avgRating.toFixed(2)} avg
                </span>
              </div>
            ))}
          </div>
          <div className="fx-table-wrap">
            <table className="fx-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Pts</th>
                  <th>M</th>
                  <th>W-L</th>
                  <th>K-D</th>
                  <th>Avg</th>
                </tr>
              </thead>
              <tbody>
                {table.map((l, i) => {
                  const w = who.get(l.playerId);
                  return (
                    <tr key={l.playerId}>
                      <td className="mono">{String(i + 1).padStart(2, "0")}</td>
                      <td>
                        <span className="fx-mgr">
                          <PlayerFace src={photoOf.get(l.playerId) ?? null} name={w?.nick ?? "?"} size={30} />
                          <span>
                            <span className="fx-mgr-team">{w?.nick ?? `Player ${l.playerId}`}</span>
                            <span className="fx-mgr-name">{w?.team}</span>
                          </span>
                        </span>
                      </td>
                      <td className="mono fx-total">{l.points}</td>
                      <td className="mono">{l.matches}</td>
                      <td className="mono">
                        {l.wins}-{l.losses}
                      </td>
                      <td className="mono">
                        {l.kills}-{l.deaths}
                      </td>
                      <td className="mono">{l.avgRating.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <footer className="rk-foot">
        <p>
          Match stats:{" "}
          <a href="https://www.hltv.org" target="_blank" rel="noopener noreferrer">
            HLTV
          </a>
        </p>
      </footer>
    </section>
  );
}

/* ── My team ──────────────────────────────────────────────────────────── */

function StageNote({ view }: { view: StageView }) {
  const startIso = view.startMs ? new Date(view.startMs).toISOString() : null;
  const delayed = view.startMs != null && view.firstMatchMs != null && view.startMs > view.firstMatchMs;
  if (view.phase === "waiting") {
    return <p className="rk-note">{view.stage.short} opens for drafting as soon as its {view.stage.fieldSize} teams are known.</p>;
  }
  if (view.phase === "open") {
    return (
      <div className="rk-note fx-note">
        <span>
          <b>{view.stage.short} draft is open.</b> Change your five as often as you like until it starts
          {delayed ? ". Scoring starts on day two, so the opening day counts for nobody." : "."}
        </span>
        {startIso && (
          <span className="fx-note-time">
            Starts <GameTime iso={startIso} align="left" />
          </span>
        )}
      </div>
    );
  }
  if (view.phase === "live") {
    return (
      <p className="rk-note">
        <b>{view.stage.short} is live.</b> Lineups are locked and visible to everyone. No team yet? You can still enter once and score from the next match.
      </p>
    );
  }
  return (
    <p className="rk-note">
      <b>{view.stage.short} is final.</b>
    </p>
  );
}

async function TeamView({ board, view, selfId, eventId }: { board: FantasyBoard; view: StageView; selfId: string | null; eventId: number }) {
  if (!selfId) {
    return (
      <section className="chap">
        <StageNote view={view} />
        <p className="muted">
          <Link href="/login">Sign in</Link> to draft a team.
        </p>
      </section>
    );
  }
  const mine = board.scored.get(`${selfId}:${view.stage.id}`);
  const action = actionFor(view, mine != null);
  const teamName = board.teamNames.get(selfId) ?? "";

  return (
    <section className="chap">
      <StageNote view={view} />
      {action !== "none" && view.pool.length > 0 ? (
        <FantasyDraft
          key={`${view.stage.id}:${mine?.stored.lockedAtMs ?? 0}`}
          stageId={view.stage.id}
          stageName={view.stage.short}
          pool={view.pool}
          initial={mine?.stored.lineup ?? null}
          initialTeamName={teamName}
          mode={action === "join-late" ? "join-late" : "edit"}
        />
      ) : mine ? (
        <LineupBoard board={board} view={view} managerId={selfId} score={mine.score} lockedAtMs={mine.stored.lockedAtMs} eventId={eventId} own />
      ) : view.phase === "final" ? (
        <p className="muted">You didn&apos;t field a team in {view.stage.short}.</p>
      ) : null}
    </section>
  );
}

/* ── Lineup board (yours, or another manager's once revealed) ─────────── */

async function upcomingFor(eventId: number, view: StageView, teamPickids: Set<number>) {
  if (view.stage.kind !== "swiss" || view.phase === "final") return [];
  const teams = [...new Map(view.pool.map((p) => [p.teamPickid, { pickid: p.teamPickid, name: p.teamName }])).values()];
  const bracket = await getSwissBracket(eventId, view.stage.id, teams).catch(() => null);
  if (!bracket) return [];
  return bracket.rounds
    .flatMap((r) => r.matches.map((m) => ({ ...m, round: r.label })))
    .filter((m) => !m.played && m.team1.name && m.team2.name)
    .filter((m) => (m.team1.pickid != null && teamPickids.has(m.team1.pickid)) || (m.team2.pickid != null && teamPickids.has(m.team2.pickid)))
    .sort((a, b) => (a.startTimeMs ?? Infinity) - (b.startTimeMs ?? Infinity))
    .slice(0, 8);
}

async function LineupBoard({
  board,
  view,
  managerId,
  score,
  lockedAtMs,
  eventId,
  own,
}: {
  board: FantasyBoard;
  view: StageView;
  managerId: string;
  score: ScoredLineup;
  lockedAtMs: number;
  eventId: number;
  own: boolean;
}) {
  const byId = new Map(view.pool.map((p) => [p.id, p]));
  const standings = board.byStage.get(view.stage.id) ?? [];
  const row = standings.find((r) => r.managerId === managerId);
  const late = view.startMs != null && lockedAtMs > view.startMs;
  const players = score.players
    .map((sp) => ({ sp, p: byId.get(sp.playerId) }))
    .sort((a, b) => TIERS.indexOf(a.p?.tier ?? "bronze") - TIERS.indexOf(b.p?.tier ?? "bronze"));
  const myTeams = new Set(players.flatMap(({ p }) => (p ? [p.teamPickid] : [])));
  const upcoming = await upcomingFor(eventId, view, myTeams);
  const nameOfTeam = new Map(view.pool.map((p) => [p.teamPickid, p.teamName]));
  // A player who left the pool after the draft still has his match-page nick.
  const nickOf = new Map(view.matches.flatMap((m) => m.players.map((x) => [x.id, x.nick] as const)));

  return (
    <div className="fx-board">
      <div className="cells fx-sum" style={{ ["--n" as string]: 3 }}>
        <div>
          <span className="k">{view.stage.short} points</span>
          <span className="v">{score.total}</span>
          <span className="s">{score.matchesCounted} match{score.matchesCounted === 1 ? "" : "es"} counted</span>
        </div>
        <div>
          <span className="k">Stage rank</span>
          <span className="v">{row ? `#${row.rank}` : "–"}</span>
          <span className="s">of {standings.length} team{standings.length === 1 ? "" : "s"}</span>
        </div>
        <div>
          <span className="k">{own ? "Your team" : "Team"}</span>
          <span className="v fx-sum-name">{board.teamNames.get(managerId) ?? row?.displayName ?? "–"}</span>
          <span className="s">{late ? "Joined after the start: scores from then on" : "In from the first match"}</span>
        </div>
      </div>

      <ul className="fx-cards">
        {players.map(({ sp, p }) => {
          const standing = teamStanding(view, p?.hltvTeamId ?? null);
          return (
            <li key={sp.playerId} className={`fx-card${sp.captain ? " cap" : ""} ${standing.status}`}>
              <div className="fx-card-top">
                <PlayerFace src={p?.photo ?? null} name={p?.name ?? nickOf.get(sp.playerId) ?? "?"} size={64} />
                <div className="fx-card-who">
                  <span className="fx-card-name">
                    {p?.name ?? nickOf.get(sp.playerId) ?? `Player ${sp.playerId}`}
                    {sp.captain && <span className="fx-capbadge" title={`Captain ×${sp.multiplier.toFixed(1)}`}>C ×{sp.multiplier.toFixed(1)}</span>}
                  </span>
                  <span className="fx-card-team">
                    {p?.teamName ? `${p.teamName} · ` : ""}
                    <span className="mono">{standing.record}</span>
                    {standing.status === "advanced" && <span className="tag ok">Through</span>}
                    {standing.status === "eliminated" && <span className="tag">Out</span>}
                  </span>
                  <span className="fx-card-tags">
                    {sp.tier && <span className={`fx-tier ${sp.tier}`}>{TIER_LABEL[sp.tier]}</span>}
                    <span className="tag" title={ROLE_INFO[sp.role].rule}>{ROLE_INFO[sp.role].label}</span>
                  </span>
                </div>
                <div className="fx-card-pts">
                  <span className="v">{sp.total}</span>
                  <span className="k">pts</span>
                </div>
              </div>
              {sp.matches.length > 0 ? (
                <table className="fx-lines">
                  <thead>
                    <tr>
                      <th>vs</th>
                      <th>K-D</th>
                      <th>Rtg</th>
                      <th>Place</th>
                      <th>Role</th>
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sp.matches.map((m) => (
                      <tr key={m.hltvMatchId} className={m.counted ? undefined : "off"}>
                        <td>
                          <span className={`fx-wl ${m.won ? "w" : "l"}`}>{m.won ? "W" : "L"}</span> {m.opponent}
                        </td>
                        <td className="mono">
                          {m.kills}-{m.deaths}
                        </td>
                        <td className="mono">{m.rating.toFixed(2)}</td>
                        <td className="mono">#{m.placement}</td>
                        <td>{m.roleHit ? <span className="fx-hit">+{ROLE_BONUS}</span> : <span className="muted">–</span>}</td>
                        <td className="mono">{m.counted ? m.points : <span title="Started before this lineup was saved">n/a</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="fx-card-wait">{standing.status === "eliminated" ? "Out of the stage." : "No finished match yet."}</p>
              )}
              {(sp.perfectBonus > 0 || sp.captain) && sp.base > 0 && (
                <p className="fx-card-foot mono">
                  {sp.perfectBonus > 0 && <>3-0 bonus +{sp.perfectBonus} · </>}
                  {sp.captain ? `${sp.base} × ${sp.multiplier.toFixed(1)} = ${sp.total}` : `${sp.base}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {upcoming.length > 0 && (
        <div className="fx-next">
          <div className="sect-head">
            <span className="eyebrow">Next up for {own ? "your" : "their"} five</span>
          </div>
          <ul className="hair-list">
            {upcoming.map((m) => {
              const mine1 = m.team1.pickid != null && myTeams.has(m.team1.pickid);
              const mine2 = m.team2.pickid != null && myTeams.has(m.team2.pickid);
              const n1 = (m.team1.pickid != null && nameOfTeam.get(m.team1.pickid)) || m.team1.name;
              const n2 = (m.team2.pickid != null && nameOfTeam.get(m.team2.pickid)) || m.team2.name;
              return (
                <li key={m.matchId ?? `${n1}-${n2}`} className="fx-next-row">
                  <span>
                    <b className={mine1 ? "mine" : undefined}>{n1}</b> vs <b className={mine2 ? "mine" : undefined}>{n2}</b>
                  </span>
                  <span className="fx-next-meta">
                    <span className="tag">Bo{m.bestOf}</span>
                    <GameTime iso={m.startTimeMs ? new Date(m.startTimeMs).toISOString() : null} align="left" />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Footer view={view} />
    </div>
  );
}

function Footer({ view }: { view: StageView }) {
  return (
    <footer className="rk-foot">
      <p>
        {view.lastFetchedMs ? (
          <LastUpdated iso={new Date(view.lastFetchedMs).toISOString()} />
        ) : (
          "Points land a few minutes after each match ends."
        )}
      </p>
      <p>
        Match stats:{" "}
        <a href="https://www.hltv.org" target="_blank" rel="noopener noreferrer">
          HLTV
        </a>
      </p>
    </footer>
  );
}

/* ── Another manager ──────────────────────────────────────────────────── */

async function ManagerView({ board, view, managerId, selfId }: { board: FantasyBoard; view: StageView; managerId: string; selfId: string | null }) {
  const entry = board.scored.get(`${managerId}:${view.stage.id}`);
  const row = board.overall.find((r) => r.managerId === managerId);
  const revealed = view.phase === "live" || view.phase === "final" || managerId === selfId;
  return (
    <section className="chap">
      <div className="chap-h">
        <span className="n">
          <Link href={href(board.ctx.event.eventId, view.stage.id, "league")} prefetch={false}>
            ← League
          </Link>
        </span>
        <h2>{row?.teamName ?? row?.displayName ?? "Manager"}</h2>
        {row?.teamName && <p>Managed by {row.displayName}</p>}
      </div>
      {!entry ? (
        <p className="muted">No team in {view.stage.short}.</p>
      ) : !revealed ? (
        <p className="rk-note">Lineups stay hidden until {view.stage.short} starts.</p>
      ) : (
        <LineupBoard board={board} view={view} managerId={managerId} score={entry.score} lockedAtMs={entry.stored.lockedAtMs} eventId={board.ctx.event.eventId} own={managerId === selfId} />
      )}
    </section>
  );
}

/* ── League ───────────────────────────────────────────────────────────── */

function LeagueView({ board, view }: { board: FantasyBoard; view: StageView }) {
  const stages = board.ctx.stages;
  const rows: ManagerRow[] = board.overall;
  if (rows.length === 0) {
    return (
      <section className="chap">
        <p className="rk-note">No teams yet. Be the first: draft your five under <b>My team</b>.</p>
      </section>
    );
  }
  return (
    <section className="chap">
      <div className="chap-h">
        <span className="n">The league</span>
        <h2>Standings</h2>
        <p>
          {rows.length} manager{rows.length === 1 ? "" : "s"}. Points add up across all four stages. Tap a team to see its five for {view.stage.short}.
        </p>
      </div>
      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              {stages.map((v) => (
                <th key={v.stage.id} className={v.stage.id === view.stage.id ? "on" : undefined}>
                  {v.stage.kind === "playoff" ? "PO" : v.stage.short.replace("Stage ", "")}
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.managerId} className={r.isSelf ? "me" : undefined}>
                <td className="mono">{String(r.rank).padStart(2, "0")}</td>
                <td>
                  <Link href={href(board.ctx.event.eventId, view.stage.id, "league", r.managerId)} prefetch={false} className="fx-mgr">
                    <RankAvatar name={r.displayName} avatarUrl={r.avatarUrl} />
                    <span>
                      <span className="fx-mgr-team">{r.teamName ?? r.displayName}</span>
                      <span className="fx-mgr-name">
                        {r.teamName ? r.displayName : ""}
                        {r.isSelf && <span className="rk-you">you</span>}
                      </span>
                    </span>
                  </Link>
                </td>
                {stages.map((v) => (
                  <td key={v.stage.id} className={`mono${v.stage.id === view.stage.id ? " on" : ""}`}>
                    {v.stage.id in r.byStage ? r.byStage[v.stage.id] : <span className="muted">–</span>}
                  </td>
                ))}
                <td className="mono fx-total">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer view={view} />
    </section>
  );
}

/* ── Players ──────────────────────────────────────────────────────────── */

function PlayersView({ board, view, selfId }: { board: FantasyBoard; view: StageView; selfId: string | null }) {
  if (view.pool.length === 0) {
    return (
      <section className="chap">
        <StageNote view={view} />
      </section>
    );
  }
  const table = board.playerTables.get(view.stage.id) ?? [];
  const lineOf = new Map(table.map((l) => [l.playerId, l]));
  const own = board.ownership.get(view.stage.id);
  const showOwn = view.phase === "live" || view.phase === "final";
  const mine = new Set(selfId ? (board.scored.get(`${selfId}:${view.stage.id}`)?.stored.lineup.slots.map((s) => s.playerId) ?? []) : []);
  const played = table.length > 0;
  const rows: FantasyPlayer[] = [...view.pool].sort((a, b) => {
    const la = lineOf.get(a.id);
    const lb = lineOf.get(b.id);
    return (lb?.points ?? -1) - (la?.points ?? -1) || (b.rating ?? -1) - (a.rating ?? -1);
  });
  return (
    <section className="chap">
      <div className="chap-h">
        <span className="n">{view.stage.short}</span>
        <h2>{played ? "Top scorers" : "The pool"}</h2>
        <p>
          {played
            ? "Placement and win points from every scored match, before role cards and captain multipliers."
            : `${view.pool.length} players in five tiers, cut by HLTV rating. Points appear once matches finish.`}
        </p>
      </div>
      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Tier</th>
              <th>Rtg</th>
              {played && (
                <>
                  <th>M</th>
                  <th>K-D</th>
                  <th>Avg</th>
                </>
              )}
              {showOwn && <th>Own</th>}
              {played && <th>Pts</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const l = lineOf.get(p.id);
              const share = own?.get(p.id) ?? 0;
              return (
                <tr key={p.id} className={mine.has(p.id) ? "me" : undefined}>
                  <td className="mono">{String(i + 1).padStart(2, "0")}</td>
                  <td>
                    <span className="fx-mgr">
                      <PlayerFace src={p.photo} name={p.name} size={30} />
                      <span>
                        <span className="fx-mgr-team">{p.name}</span>
                        <span className="fx-mgr-name">{p.teamName}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`fx-tier ${p.tier}`}>{TIER_LABEL[p.tier]}</span>
                  </td>
                  <td className="mono">{p.rating != null ? p.rating.toFixed(2) : "–"}</td>
                  {played && (
                    <>
                      <td className="mono">{l?.matches ?? 0}</td>
                      <td className="mono">{l ? `${l.kills}-${l.deaths}` : "–"}</td>
                      <td className="mono">{l ? l.avgRating.toFixed(2) : "–"}</td>
                    </>
                  )}
                  {showOwn && <td className="mono">{share > 0 ? `${Math.round(share * 100)}%` : "–"}</td>}
                  {played && <td className="mono fx-total">{l?.points ?? 0}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Footer view={view} />
    </section>
  );
}

/* ── Matches ──────────────────────────────────────────────────────────── */

function MatchesView({ board, view, selfId }: { board: FantasyBoard; view: StageView; selfId: string | null }) {
  const mine = new Set(selfId ? (board.scored.get(`${selfId}:${view.stage.id}`)?.stored.lineup.slots.map((s) => s.playerId) ?? []) : []);
  const matches = [...view.matches].sort((a, b) => b.startMs - a.startMs);
  if (matches.length === 0) {
    return (
      <section className="chap">
        <p className="rk-note">No finished {view.stage.short} matches yet. Each one shows up here a few minutes after it ends.</p>
      </section>
    );
  }
  return (
    <section className="chap">
      <div className="chap-h">
        <span className="n">{view.stage.short}</span>
        <h2>Match by match</h2>
        <p>Every player&apos;s rank in the match and the points it paid. Your five are marked.</p>
      </div>
      <ul className="fx-matches">
        {matches.map((m) => {
          const scored = scoreMatch(m);
          const before = view.startMs != null && m.startMs < view.startMs;
          return (
            <li key={m.hltvMatchId} className="card fx-match">
              <details>
                <summary>
                  <span className="fx-match-score">
                    <b className={m.winnerHltvTeamId === m.team1.hltvTeamId ? "w" : undefined}>{m.team1.name}</b>
                    <span className="mono">
                      {m.team1.score}-{m.team2.score}
                    </span>
                    <b className={m.winnerHltvTeamId === m.team2.hltvTeamId ? "w" : undefined}>{m.team2.name}</b>
                  </span>
                  <span className="fx-match-meta">
                    <span className="tag">Bo{m.bestOf}</span>
                    {before && <span className="tag">Before scoring</span>}
                    <span className="fx-match-top">
                      {scored
                        .slice(0, 3)
                        .map((s) => m.players.find((p) => p.id === s.playerId)?.nick)
                        .join(" · ")}
                    </span>
                  </span>
                </summary>
                <table className="fx-lines">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>K-D</th>
                      <th>ADR</th>
                      <th>KAST</th>
                      <th>Rtg</th>
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scored.map((s) => (
                      <tr key={s.playerId} className={mine.has(s.playerId) ? "me" : undefined}>
                        <td className="mono">{s.placement}</td>
                        <td>
                          <span className={`fx-wl ${s.won ? "w" : "l"}`}>{s.won ? "W" : "L"}</span> {m.players.find((p) => p.id === s.playerId)?.nick}
                        </td>
                        <td className="mono">
                          {s.kills}-{s.deaths}
                        </td>
                        <td className="mono">{s.adr.toFixed(1)}</td>
                        <td className="mono">{s.kast.toFixed(0)}%</td>
                        <td className="mono">{s.rating.toFixed(2)}</td>
                        <td className="mono">{s.placementPoints + s.winPoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </li>
          );
        })}
      </ul>
      <Footer view={view} />
    </section>
  );
}

/* ── Rules ────────────────────────────────────────────────────────────── */

function RulesView() {
  return (
    <section className="chap fx-rules">
      <div className="chap-h">
        <span className="n">How it works</span>
        <h2>The rules</h2>
        <p>The same game as BLAST.tv fantasy, played among us.</p>
      </div>
      <div className="steps">
        <div>
          <span className="n">1</span>
          <div>
            <div className="t">Draft five</div>
            <p>
              One player from each tier: Diamond, Platinum, Gold, Silver, Bronze. Tiers are cut by HLTV rating. At most {MAX_PER_TEAM} players from the same team.
            </p>
          </div>
        </div>
        <div>
          <span className="n">2</span>
          <div>
            <div className="t">Score every match</div>
            <p>
              Each finished match ranks its ten players by HLTV rating. First gets {PLACEMENT_POINTS[0]}, second {PLACEMENT_POINTS[1]}, down to {PLACEMENT_POINTS[9]} for tenth. A win adds {WIN_POINTS}. A best-of-three counts as one match.
            </p>
          </div>
        </div>
        <div>
          <span className="n">3</span>
          <div>
            <div className="t">Go 3-0</div>
            <p>
              In a Swiss stage, a team that wins its first three matches earns each of its players {SWISS_PERFECT_BONUS} bonus points.
            </p>
          </div>
        </div>
        <div>
          <span className="n">4</span>
          <div>
            <div className="t">Crown a captain</div>
            <p>
              Your captain&apos;s points are multiplied. The lower his tier, the bigger the multiplier:{" "}
              {TIERS.map((t) => `${TIER_LABEL[t]} ×${CAPTAIN_MULTIPLIER[t].toFixed(1)}`).join(", ")}.
            </p>
          </div>
        </div>
        <div>
          <span className="n">5</span>
          <div>
            <div className="t">Deal the role cards</div>
            <p>Each of your five gets a different role. Every match he meets it pays +{ROLE_BONUS}.</p>
            <ul className="fx-roles">
              {ROLES.map((r) => (
                <li key={r}>
                  <b>{ROLE_INFO[r].label}</b>
                  <span>
                    {r === "hitter" ? `${HITTER_MIN_ADR} or more damage per round` : r === "glue" ? `KAST of ${GLUE_MIN_KAST}% or higher` : ROLE_INFO[r].rule}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <span className="n">6</span>
          <div>
            <div className="t">New five every stage</div>
            <p>
              Stage I, Stage II, Stage III, Playoffs. Each has its own pool and its own lineup, and your points add up across all four. A stage opens for drafting as soon as its teams are known.
            </p>
          </div>
        </div>
        <div>
          <span className="n">7</span>
          <div>
            <div className="t">Locks and late entries</div>
            <p>
              Change your five freely until the stage starts. Then lineups lock and everyone can see them. If you missed the start you can still enter once: that lineup can&apos;t be changed and scores only matches that start after you saved it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
