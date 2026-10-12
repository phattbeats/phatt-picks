import Image from "next/image";
import Link from "next/link";
import { LastUpdated } from "@/components/LastUpdated";
import { getCommittedLayout } from "@/lib/layout";
import { getSession } from "@/lib/session";
import { rankMapForSection, snapshotSectionIds } from "@/lib/rank-snapshot";
import { baselineSectionId, latestSectionId, rankDelta, type RankDelta } from "@/lib/rank-snapshot-core";
import { refreshOutcomesOnRead } from "@/lib/outcomes";
import { currentEvent, previousMajor, type EventConfig } from "@/lib/events-core";
import {
  buildLeaderboard,
  eventShortName,
  layoutForEvent,
  resolveArchiveEvent,
  type LeaderboardRow,
} from "@/lib/leaderboard";
import { Podium } from "@/components/sg/ranks/Podium";
import { LeaderRows } from "@/components/sg/ranks/LeaderRows";

/** Rank-delta arrows: current rank vs the snapshot frozen at the previous resolved stage. */
async function rankDeltas(eventId: number, rows: LeaderboardRow[]) {
  const resolvedSections = await snapshotSectionIds(eventId);
  const baseSection = baselineSectionId(resolvedSections);
  const baselineRanks = await rankMapForSection(eventId, baseSection);
  const deltas = new Map<string, RankDelta>();
  rows.forEach((row, idx) => deltas.set(row.playerId, rankDelta(idx + 1, baselineRanks.get(row.playerId))));
  // Before two stages have resolved there's nothing to diff, so no arrows render
  // (honest — we never invent movement).
  return { deltas, showDeltas: baseSection !== null, latestSection: latestSectionId(resolvedSections) };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Server-clock check, outside render so the purity lint stays quiet. */
function isFuture(iso: string | null): iso is string {
  return !!iso && Date.parse(iso) > Date.now();
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function Footer({ latestResolvedAt, final }: { latestResolvedAt: Date | null; final: boolean }) {
  return (
    <footer className="rk-foot">
      <p>
        {latestResolvedAt ? (
          <>
            {final && "Final · "}
            <LastUpdated iso={latestResolvedAt.toISOString()} />
          </>
        ) : (
          "Scores update from official results as each stage completes."
        )}
      </p>
      <p>
        Results:{" "}
        <a href="https://liquipedia.net" target="_blank" rel="noopener noreferrer">
          Liquipedia
        </a>{" "}
        (CC-BY-SA 3.0)
      </p>
    </footer>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ major?: string | string[] }>;
}) {
  const params = await searchParams;
  const slug = Array.isArray(params.major) ? params.major[0] : params.major;
  const archive = resolveArchiveEvent(slug);
  if (archive) return <FinalBoard event={archive} />;
  return <LiveBoard />;
}

/* ── Live board (current event) ───────────────────────────────────────── */

async function LiveBoard() {
  // Per-request active event (#1046) — follows the clock across Majors, no redeploy.
  const event = currentEvent();
  const EVENT_ID = event.eventId;
  const eventName = eventShortName(event);
  const last = previousMajor();
  const session = await getSession();

  // Live driver (#866): atomic 30s claim → deferred background ingest, so the
  // board never sits frozen mid-event. No cron, no added latency (the slow ingest
  // runs past the response via `after`).
  await refreshOutcomesOnRead(EVENT_ID);

  const { rows, latestResolvedAt } = await buildLeaderboard({
    eventId: EVENT_ID,
    layout: getCommittedLayout(),
    sessionPlayerId: session?.playerId,
  });
  const { deltas, showDeltas, latestSection } = await rankDeltas(EVENT_ID, rows);

  const preEvent = rows.every((r) => r.score === 0);
  const showPodium = !preEvent && rows.length >= 3;
  const selfIdx = rows.findIndex((r) => r.isSelf);
  const self = selfIdx >= 0 ? rows[selfIdx] : null;
  const leaderGap = self ? rows[0].score - self.score : 0;
  const profileHref = (r: LeaderboardRow) => `/players/${encodeURIComponent(r.playerId)}`;

  return (
    <div className="rk-page">
      <section className="bleed short">
        <Image src="/wrapped/major-thanks.jpg" alt="" fill priority sizes="100vw" />
        <span className="credit">Photo · IEM Cologne Major 2026 · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">
            Leaderboard · <b>{eventName}</b> · {rows.length} player{rows.length !== 1 ? "s" : ""}
          </span>
          <h1 className="display rise d1">The board</h1>
        </div>
      </section>

      {last && (
        <Link href={`/leaderboard?major=${encodeURIComponent(last.slug)}`} prefetch={false} className="rk-archive">
          <span className="eyebrow">Last Major</span>
          <span className="rk-archive-t">
            Final standings · {eventShortName(last)} <span aria-hidden>→</span>
          </span>
        </Link>
      )}

      {preEvent && (
        <p className="rk-note">
          {isFuture(event.dates.start) ? (
            <>
              {eventName} scoring starts when Stage I locks — <b>{dayLabel(event.dates.start)}</b>. Until then everyone
              sits level on zero.
            </>
          ) : (
            <>
              {eventName} scores land as the first <b>Stage I</b> results resolve.
            </>
          )}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="chap">
          <div className="chap-h">
            <h2>No players yet</h2>
            <p>
              Be the first — <Link href="/login">sign in</Link> or <Link href="/login/local">play locally</Link>.
            </p>
          </div>
        </section>
      ) : (
        <>
          {showPodium && (
            <section className="chap">
              <div className="chap-h">
                <h2>Top three</h2>
                <p>
                  <b>{rows[0].displayName}</b> leads on {rows[0].score} pts.
                </p>
              </div>
              <Podium rows={rows} hrefFor={profileHref} />
            </section>
          )}

          {self && !preEvent && (
            <section className="rk-me">
              <span className="bignum">{String(selfIdx + 1).padStart(2, "0")}</span>
              <span className="rk-me-t">
                <b>You&apos;re {ordinal(selfIdx + 1)}</b>
                {leaderGap > 0 ? `, ${leaderGap} pt${leaderGap !== 1 ? "s" : ""} off the lead.` : " — top of the board."}
              </span>
              <Link href="/leaderboard/compare" prefetch={false} className="btn-solid">
                Compare picks
              </Link>
            </section>
          )}

          <section className="chap">
            <div className="chap-h row2">
              <div>
                <h2>The field</h2>
              </div>
              <nav className="rk-links" aria-label="Leaderboard links">
                {rows.length >= 2 && (
                  <Link href="/leaderboard/compare" prefetch={false}>
                    Compare picks →
                  </Link>
                )}
                {latestSection !== null && (
                  <Link href={`/reveal/${latestSection}`} prefetch={false}>
                    Latest Stage Reveal →
                  </Link>
                )}
                <Link href="/players" prefetch={false}>
                  Directory →
                </Link>
                <Link href="/majors" prefetch={false}>
                  Your Majors →
                </Link>
              </nav>
            </div>
            <LeaderRows
              rows={showPodium ? rows.slice(3) : rows}
              startRank={showPodium ? 4 : 1}
              deltas={deltas}
              showDelta={showDeltas}
              hrefFor={profileHref}
            />
          </section>
        </>
      )}

      <Footer latestResolvedAt={latestResolvedAt} final={false} />
    </div>
  );
}

/* ── Final standings (a past registered event, read-only) ─────────────── */

async function FinalBoard({ event }: { event: EventConfig }) {
  const eventName = eventShortName(event);
  const live = currentEvent();
  const liveName = eventShortName(live);
  const layout = layoutForEvent(event.eventId);
  const session = await getSession();
  const slugQ = encodeURIComponent(event.slug);

  const backLink = (
    <Link href="/leaderboard" prefetch={false} className="rk-archive">
      <span className="eyebrow">Live board</span>
      <span className="rk-archive-t">
        <span aria-hidden>←</span> {liveName}
      </span>
    </Link>
  );

  const hero = (count: number | null) => (
    <section className="bleed short">
      <Image src="/wrapped/major-champion.jpg" alt="" fill priority sizes="100vw" />
      <span className="credit">Photo · IEM Cologne Major 2026 · HLTV</span>
      <div className="in">
        <span className="eyebrow rise">
          Final standings · <b>{eventName}</b>
          {count !== null && ` · ${count} player${count !== 1 ? "s" : ""}`}
        </span>
        <h1 className="display rise d1">Final standings</h1>
      </div>
    </section>
  );

  // This build can only load the committed layout fixture; any other event's
  // picks can't be scored here, so say so rather than show a board of zeros.
  if (!layout) {
    return (
      <div className="rk-page">
        {hero(null)}
        {backLink}
        <p className="rk-note">
          Final scores for <b>{eventName}</b> aren&apos;t available on this build. Every pick is stored — the board
          returns when its layout is restored.
        </p>
      </div>
    );
  }

  // Read-only: no refreshOutcomesOnRead — the event is history.
  const { rows, latestResolvedAt } = await buildLeaderboard({
    eventId: event.eventId,
    layout,
    sessionPlayerId: session?.playerId,
    entrantsOnly: true,
  });
  const { deltas, showDeltas } = await rankDeltas(event.eventId, rows);
  const compareHref = (r: LeaderboardRow) => `/leaderboard/compare?major=${slugQ}&b=${encodeURIComponent(r.playerId)}`;
  const champ = rows[0];
  const showPodium = rows.length >= 3 && champ.score > 0;
  const selfIdx = rows.findIndex((r) => r.isSelf);

  return (
    <div className="rk-page">
      {hero(rows.length)}
      {backLink}

      {rows.length === 0 ? (
        <p className="rk-note">Nobody locked picks for {eventName}.</p>
      ) : (
        <>
          <section className="chap">
            <div className="chap-h">
              <h2>{champ.score > 0 ? `${champ.displayName} takes it` : "No points scored"}</h2>
              <p>
                {champ.score > 0 ? (
                  <>
                    <b>{champ.score} pts</b> won {eventName}
                    {rows[1] ? `, ${champ.score - rows[1].score} clear of ${rows[1].displayName}` : ""}.
                  </>
                ) : (
                  <>No pick scored at {eventName}.</>
                )}
                {selfIdx >= 0 && (
                  <>
                    {" "}
                    You finished <b>{ordinal(selfIdx + 1)}</b>.
                  </>
                )}
              </p>
            </div>
            {showPodium && <Podium rows={rows} final hrefFor={compareHref} />}
          </section>

          <section className="chap">
            <div className="chap-h row2">
              <div>
                <h2>The final table</h2>
              </div>
              <nav className="rk-links" aria-label="Final standings links">
                {rows.length >= 2 && (
                  <Link href={`/leaderboard/compare?major=${slugQ}`} prefetch={false}>
                    Compare picks →
                  </Link>
                )}
                <Link href="/majors" prefetch={false}>
                  Your Majors →
                </Link>
              </nav>
            </div>
            <LeaderRows
              rows={showPodium ? rows.slice(3) : rows}
              startRank={showPodium ? 4 : 1}
              deltas={deltas}
              showDelta={showDeltas}
              hrefFor={compareHref}
            />
          </section>
        </>
      )}

      <Footer latestResolvedAt={latestResolvedAt} final />
    </div>
  );
}
