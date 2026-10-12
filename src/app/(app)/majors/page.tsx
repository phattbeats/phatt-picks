/**
 * "Your Majors" — the headline of multi-major workstream B (#949):
 * "historic scores, so you can look back at your picks throughout every Major."
 *
 * Every Major the signed-in player has played (a distinct eventId in their Pick
 * rows that the registry knows about), newest first, with their score, their
 * finish among the field, the coin it minted, and links into that event's
 * read-only profile view and its final standings. The live Major leads as an
 * "in play" card.
 *
 * Data is already persisted per eventId, so this is a read view — no schema, no
 * crawl. Scoring reuses the leaderboard's exact maths (scorePlayer + the score-
 * desc / name tiebreak) so a Major's "finish" here matches its leaderboard rank.
 *
 * Per-event layout: only a Major whose layout fixture is loadable scores; rows
 * whose layout can't be loaded degrade honestly to an unscored entry (— / no
 * finish) rather than mis-scoring against the wrong fixture.
 */

import Link from "next/link";
import { getSession } from "@/lib/session";
import { currentEvent, stageOneStartFor } from "@/lib/events-core";
import { resolveEffectiveStatus } from "@/lib/event-lifecycle-core";
import { isEventArchived } from "@/lib/majors-core";
import { getPlayerChallengeCoins } from "@/lib/challenge-coins";
import { InspectableCoin } from "@/components/heat/CoinInspector";
import type { ChallengeCoin } from "@/lib/challenge-coin-core";
import {
  dayMonth,
  majorPhoto,
  majorShortName,
  monthYear,
  ordSuffix,
  playerMajorsHistory,
} from "@/components/sg/people/people-data";

export default async function MajorsPage() {
  const session = await getSession();
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const live = currentEvent(nowMs);
  const liveStatus = resolveEffectiveStatus(live, nowMs);
  const liveName = majorShortName(live);

  const hero = (eyebrow: React.ReactNode) => (
    <section className="bleed short">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wrapped/cologne-arena.jpg" alt="" />
      <span className="credit">Photo · Wikimedia Commons</span>
      <div className="in">
        <span className="eyebrow rise">{eyebrow}</span>
        <h1 className="display rise d1">Your Majors</h1>
      </div>
    </section>
  );

  if (!session) {
    return (
      <div className="pp-page">
        {hero(<>Your record · <b>every Major</b></>)}
        <section className="chap">
          <div className="chap-h">
            <h2>Sign in to look back</h2>
            <p>
              Your Majors history follows your account.{" "}
              <Link href="/login" prefetch={false}>Sign in</Link> or{" "}
              <Link href="/login/local" prefetch={false}>play locally</Link>.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const history = await playerMajorsHistory(session.playerId, nowMs);

  // Challenge coins (#1278) the signed-in player has earned, indexed by event
  // so each concluded Major's row can show its inspectable, drag-to-rotate coin.
  const coins = await getPlayerChallengeCoins(session.playerId, nowMs);
  const coinByEvent = new Map<number, ChallengeCoin>(coins.map((c) => [c.eventId, c]));

  const selfHref = `/players/${encodeURIComponent(session.playerId)}`;
  const liveRow = history.find((h) => h.eventId === live.eventId) ?? null;
  const showLive = !isEventArchived(liveStatus);
  const rows = showLive ? history.filter((h) => h.eventId !== live.eventId) : history;
  const stageOne = stageOneStartFor(live);
  const livePhoto = majorPhoto(live.slug);

  return (
    <div className="pp-page">
      {hero(
        <>
          Your record · <b>{history.length} Major{history.length !== 1 ? "s" : ""}</b>
        </>,
      )}

      {showLive && (
        <section className="chap">
          <div className="chap-h">
            <h2>In play now</h2>
          </div>
          <Link className="pp-livecard" href={liveRow ? selfHref : "/picks"} prefetch={false}>
            <span className="pp-livecard-ph">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={livePhoto.src} alt="" loading="lazy" />
            </span>
            <span className="pp-livecard-b">
              {liveStatus === "live" ? (
                <span className="live">Live</span>
              ) : (
                <span className="eyebrow">
                  Up next{stageOne ? <> · Stage I <b>{dayMonth(stageOne, live.slug.includes("singapore") ? "Asia/Singapore" : undefined)}</b></> : null}
                </span>
              )}
              <span className="pp-livecard-nm">{liveName}</span>
              <span className="cells" style={{ ["--n" as string]: 3 } as React.CSSProperties}>
                <span>
                  <span className="k">Finish</span>
                  <span className="v">{liveRow?.finish != null ? String(liveRow.finish).padStart(2, "0") : "—"}</span>
                </span>
                <span>
                  <span className="k">Points</span>
                  <span className="v">{liveRow?.scored ? liveRow.score : "—"}</span>
                </span>
                <span>
                  <span className="k">Picks</span>
                  <span className="v">{liveRow?.pickCount ?? 0}</span>
                </span>
              </span>
              <span className="eyebrow">{liveRow ? "Your profile →" : "Make your picks →"}</span>
            </span>
          </Link>
        </section>
      )}

      <section className="chap">
        <div className="chap-h">
          <h2>{rows.length === 0 ? "No Majors yet" : "Finished"}</h2>
          {rows.length === 0 ? (
            <p>
              Make your <Link href="/picks" prefetch={false}>picks</Link> for {liveName} and it lands here
              once the Grand Final is played.
            </p>
          ) : (
            <p>
              Each one minted a coin. <b>Where you finished decided the metal.</b>
            </p>
          )}
        </div>

        {rows.length > 0 && (
          <div className="pp-arc">
            {rows.map((row, i) => {
              const coin = coinByEvent.get(row.eventId);
              const photo = majorPhoto(row.slug);
              const archived = isEventArchived(row.status);
              const majorQ = `?major=${encodeURIComponent(row.slug)}`;
              return (
                <div key={row.eventId} className="pp-mj">
                  <Link
                    className="pp-mj-main"
                    href={`${selfHref}${majorQ}`}
                    prefetch={false}
                  >
                    <span className="pp-mj-ph">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.src} alt="" loading="lazy" />
                    </span>
                    <span className="pp-mj-txt">
                      <span className="eyebrow">
                        {monthYear(row.start)} · {archived ? "Final" : row.status === "live" ? <b>Live</b> : "Upcoming"}
                      </span>
                      <span className="pp-mj-nm">{majorShortName(row)}</span>
                      <span className="pp-mj-f">
                        {/* #1046: when the layout fixture isn't loadable the score is
                            not a genuine 0 — say so explicitly rather than imply a result. */}
                        {!row.scored
                          ? "Score unavailable"
                          : row.finish !== null
                            ? `${row.finish}${ordSuffix(row.finish)} of ${row.fieldSize}`
                            : "Not scored"}
                        {row.scored && ` · ${row.score} pts`}
                        {row.pickCount > 0 && ` · ${row.pickCount} picks`}
                      </span>
                    </span>
                  </Link>
                  {coin && (
                    <div className="pp-mj-coin">
                      <InspectableCoin coin={coin} size={88} delay={i * 1.1} />
                      <span className={`coin-collectible-tier ${coin.tier}`}>{coin.tier}</span>
                    </div>
                  )}
                  <div className="pp-mj-links">
                    <Link className="eyebrow" href={`${selfHref}${majorQ}`} prefetch={false}>Your picks →</Link>
                    {archived && (
                      <Link className="eyebrow" href={`/leaderboard${majorQ}`} prefetch={false}>Final standings →</Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
