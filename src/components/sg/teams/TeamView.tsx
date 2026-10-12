/**
 * /teams/[slug] presentation (prototype 05): team strip, portrait hero, a
 * statement chapter with the stat cells, roster, recent results and how the
 * HOTLINE room called them. Server component — all data arrives prepared from
 * team-data.ts.
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { resolveLogoTiers } from "@/lib/logos";
import { teamAccent } from "@/lib/playoff-spotlights";
import type { TeamDef } from "@/lib/layout";
import { teamCode, teamHref, teamPortrait } from "./team-assets";
import type { Finish, StageCall, SwissResult, TeamPageData } from "./team-data";

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function finishLabel(f: Finish): string {
  switch (f.kind) {
    case "champion":
      return "Champion";
    case "runner-up":
      return "Runner-up";
    case "final":
      return "Grand Final";
    case "semis":
      return f.out ? "3–4th" : "Semifinals";
    case "quarters":
      return f.out ? "5–8th" : "Playoffs";
    case "swiss-out":
      return `Out · ${f.stage}`;
    case "swiss-live":
      return f.stage;
    default:
      return "—";
  }
}

function statement(f: Finish, city: string): string {
  switch (f.kind) {
    case "champion":
      return `Crowned in ${city}.`;
    case "runner-up":
      return "Final reached. Trophy missed.";
    case "final":
      return "One series from the trophy.";
    case "semis":
      return f.out ? "Semifinal run. No final." : "Into the last four.";
    case "quarters":
      return f.out ? "Made the eight. Went no further." : "Into the last eight.";
    case "swiss-out":
      return `Out in ${f.stage}.`;
    case "swiss-live":
      return `Still alive in ${f.stage}.`;
    default:
      return "On the field.";
  }
}

const RESULT_LABEL: Record<Exclude<SwissResult, null>, string> = {
  "3-0": "went 3–0",
  adv: "advanced",
  "0-3": "went 0–3",
  out: "were eliminated",
};

/** The room's most common call on this team in its entry stage, as one line. */
function roomLine(stages: StageCall[]): ReactNode {
  const first = stages.find((s) => s.share);
  if (!first?.share) return "The room's calls reveal when each stage locks.";
  const { total, threeZero, advance, zeroThree, notPicked } = first.share;
  const options: Array<[number, string]> = [
    [threeZero, "to go 3–0"],
    [advance, "to advance"],
    [zeroThree, "to go 0–3"],
    [notPicked, "nowhere at all"],
  ];
  const [n, what] = options.sort((a, b) => b[0] - a[0])[0];
  return (
    <>
      <b>
        {pct(n, total)}% of HOTLINE players
      </b>{" "}
      had them {what} in {first.stage}
      {first.result ? `; they ${RESULT_LABEL[first.result]}` : ""}.
    </>
  );
}

export function TeamStrip({ field, active }: { field: TeamDef[]; active?: number }) {
  return (
    <nav className="sgt-strip" aria-label="Teams">
      {field.map((t) => (
        <Link
          key={t.pickid}
          href={teamHref(t)}
          prefetch={false}
          className={t.pickid === active ? "on" : undefined}
          aria-current={t.pickid === active ? "page" : undefined}
        >
          <span className="sgt-chip-logo">
            <TeamLogo tiers={resolveLogoTiers(t)} teamName={t.name} size={22} />
          </span>
          {t.name}
        </Link>
      ))}
    </nav>
  );
}

export function TeamView({ data }: { data: TeamPageData }) {
  const { team, stats, region, finish, stages, championShare } = data;
  const accent = teamAccent(team);
  const portrait = teamPortrait(team.pickid);
  const style = accent ? ({ "--c": accent } as CSSProperties) : undefined;
  const recent = stats?.recent ?? [];
  const wins = recent.filter((m) => m.result === "W").length;
  const losses = recent.filter((m) => m.result === "L").length;

  return (
    <div className="sg-page sgt" style={style}>
      <TeamStrip field={data.field} active={team.pickid} />

      {/* Portrait hero */}
      <section className="sgt-hero">
        <span className="ghost" aria-hidden="true">
          {teamCode(team)}
        </span>
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- static cutout
          <img className="cut" src={portrait} alt={`${team.name} player`} />
        ) : (
          <span className="mark" aria-hidden="true">
            <TeamLogo tiers={resolveLogoTiers(team)} teamName={team.name} size={240} />
          </span>
        )}
        {portrait && <span className="credit">Photo · HLTV</span>}
        <div className="in">
          <span className="eyebrow rise">
            {stats?.worldRank != null ? (
              <>
                HLTV <b>#{stats.worldRank}</b> ·{" "}
              </>
            ) : null}
            {region ? `${region.label} · ` : ""}
            {data.eventShort}
          </span>
          <h1 className="display rise d1">{team.name}</h1>
          <div className="sgt-meta rise d2">
            {recent.length > 0 && (
              <span className="sgt-form" title={`Last ${recent.length}: ${recent.map((m) => m.result).join(" ")}`}>
                {recent.map((m, i) => (
                  <i key={i} className={m.result === "W" ? "w" : m.result === "L" ? "l" : "t"} />
                ))}
              </span>
            )}
            <span className="mono muted">
              {data.eventCity} · {finishLabel(finish)}
            </span>
          </div>
        </div>
      </section>

      {/* Statement + stat cells */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">01 — {data.eventCity}</span>
          <h2>{statement(finish, data.eventCity)}</h2>
          <p>{roomLine(stages)}</p>
        </div>
        <div className="cells sgt-cells" style={{ "--n": 4 } as CSSProperties}>
          <div>
            <span className="k">HLTV rank</span>
            <span className="v">{stats?.worldRank != null ? `#${stats.worldRank}` : "—"}</span>
            <span className="s">World ranking · {data.statsAsOf}</span>
          </div>
          <div>
            <span className="k">Region</span>
            <span className="v">{region?.code ?? "—"}</span>
            <span className="s">{region?.label ?? "Unlisted"}</span>
          </div>
          <div>
            <span className="k">{data.eventCity} finish</span>
            <span className="v sgt-word">{finishLabel(finish)}</span>
            <span className="s">
              {championShare ? (
                <>
                  Crowned by <b>{pct(championShare.count, championShare.total)}%</b> of the room
                </>
              ) : (
                "From the official answer key"
              )}
            </span>
          </div>
          <div>
            <span className="k">Last {recent.length || 5}</span>
            <span className="v">{recent.length > 0 ? `${wins}–${losses}` : "—"}</span>
            <span className="s">{recent.length > 0 ? recent.map((m) => m.result).join(" ") : "No matches on file"}</span>
          </div>
        </div>
      </section>

      {/* Roster */}
      {stats && stats.roster.length > 0 && (
        <section className="chap">
          <div className="chap-h">
            <span className="n">02 — Roster</span>
            <h2>The five.</h2>
          </div>
          <div className="sgt-roster">
            {stats.roster.map((p) => (
              <a key={p.name} className="pl" href={p.hltvUrl} target="_blank" rel="noopener noreferrer">
                <span className={`ph${p.photo ? "" : " none"}`}>
                  {p.photo && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed HLTV CDN URL
                    <img src={p.photo} alt="" loading="lazy" />
                  )}
                </span>
                <span className="h">{p.name}</span>
                <span className="r">
                  {p.position}
                  {p.rating != null ? <b>{p.rating.toFixed(2)}</b> : null}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* How the room called them */}
      <section className="chap">
        <div className="chap-h row2">
          <div>
            <span className="n">03 — The room</span>
            <h2>How HOTLINE called them</h2>
          </div>
          <Link className="btn btn-ghost" href="/picks" prefetch={false}>
            Go to picks
          </Link>
        </div>
        {stages.length === 0 ? (
          <p className="sgt-empty">No Swiss stage on file for this team yet.</p>
        ) : (
          <div className="sgt-rooms">
            {stages.map((s) => (
              <RoomBlock key={s.sectionId} call={s} />
            ))}
          </div>
        )}
      </section>

      {/* Recent results */}
      {recent.length > 0 && (
        <section className="chap">
          <div className="chap-h">
            <span className="n">04 — Form</span>
            <h2>Last {recent.length}.</h2>
          </div>
          <div className="hair-list sgt-results">
            {recent.map((m, i) => (
              <div key={`${m.date}-${i}`} className={`sgt-res ${m.result === "W" ? "w" : m.result === "L" ? "l" : "t"}`}>
                <span className="res">{m.result}</span>
                <span className="opp">vs {m.opponent}</span>
                <span className="mono score">{m.score}</span>
                <span className="mono muted date">{m.date}</span>
              </div>
            ))}
          </div>
          <div className="cta">
            {stats?.hltvUrl && (
              <a className="btn btn-ghost" href={stats.hltvUrl} target="_blank" rel="noopener noreferrer">
                HLTV profile
              </a>
            )}
          </div>
          <p className="sgt-src mono">Stats via HLTV · {data.statsAsOf}</p>
        </section>
      )}
    </div>
  );
}

function RoomBlock({ call }: { call: StageCall }) {
  const head = (
    <div className="sgt-room-k">
      <span>{call.stage}</span>
      <span className="muted">
        {call.result ? `Result · ${RESULT_LABEL[call.result]}` : "Result pending"}
      </span>
    </div>
  );
  if (!call.share) {
    return (
      <div className="sgt-room">
        {head}
        <p className="sgt-empty">Calls reveal when this stage locks.</p>
      </div>
    );
  }
  const { total, threeZero, advance, zeroThree, notPicked } = call.share;
  const rows: Array<{ k: string; n: number; hit: boolean; dim?: boolean }> = [
    { k: "3–0", n: threeZero, hit: call.result === "3-0" },
    { k: "Advance", n: advance, hit: call.result === "adv" },
    { k: "0–3", n: zeroThree, hit: call.result === "0-3" },
    { k: "Not picked", n: notPicked, hit: false, dim: true },
  ];
  return (
    <div className="sgt-room">
      {head}
      {rows.map((r) => {
        const p = pct(r.n, total);
        return (
          <div key={r.k} className={`rb${r.hit ? " hi" : ""}${r.dim ? " dim" : ""}`}>
            <span className="k">{r.k}</span>
            <span className="b" aria-hidden="true">
              <i style={{ width: `${p}%` }} />
            </span>
            <span className="v">{p}%</span>
          </div>
        );
      })}
      <span className="sgt-room-n mono muted">{total} players called this stage</span>
    </div>
  );
}
