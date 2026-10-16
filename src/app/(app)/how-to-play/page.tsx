/* eslint-disable @next/next/no-img-element -- static editorial photos + coin art from /public. */

import Link from "next/link";
import { TapDemo } from "@/components/sg/content/TapDemo";
import { COIN_TIERS, type ChallengeCoin, type CoinTier } from "@/lib/challenge-coin-core";
import { CoinCase, CoinSlot } from "@/components/heat/ChallengeCoinShelf";

export const metadata = { title: "How Pick'Em works · HOTLINE" };

/**
 * How it works — the newcomer field manual (#987), rebuilt as the Singapore
 * editorial page (prototype 10): seven chapters, one idea each. Every rule
 * stated here is read off the code, not invented:
 *   • points per call    — the layout fixture's points_per_pick (1/2/3 Swiss,
 *                          12/10/7 playoffs; 135 perfect) via scoring.ts
 *   • the 2 / 6 / 2 calls — swiss-bucket-core.ts bucketSwissSlots(10)
 *   • lock & reveal       — reveal-core.ts (picks are revealed iff not writable)
 *   • coins               — challenge-coin-core.ts (≥1 real pick + Major
 *                          concluded; finish rank slots → tier)
 * Singapore stage day-splits are unpublished (events-core), so only the dated
 * windows are shown: Swiss 25 Nov – 6 Dec, playoffs 10–13 Dec.
 */

/** Sixteen teams in, eight survive (Swiss) / eight in, one champion (playoffs). */
function Dots({ n, lit }: { n: number; lit: number }) {
  return (
    <span className="dots" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < lit ? undefined : "x"} />
      ))}
    </span>
  );
}

const STAGES = [
  { d: "Opens 25 Nov", t: "Stage I", ppc: 1 },
  { d: "Dates TBA", t: "Stage II", ppc: 2 },
  { d: "Ends 6 Dec", t: "Stage III", ppc: 3 },
];

/** The records a Swiss team can sit on, after each round. */
const SWISS: { h: string; recs: { r: string; cls?: string; tag?: string }[] }[] = [
  { h: "Start", recs: [{ r: "0–0" }] },
  { h: "Rd 1", recs: [{ r: "1–0" }, { r: "0–1" }] },
  { h: "Rd 2", recs: [{ r: "2–0" }, { r: "1–1" }, { r: "0–2" }] },
  {
    h: "Rd 3",
    recs: [
      { r: "3–0", cls: "sw", tag: "sweep" },
      { r: "2–1" },
      { r: "1–2" },
      { r: "0–3", cls: "wo", tag: "out" },
    ],
  },
  { h: "Rd 4", recs: [{ r: "3–1", cls: "ad", tag: "through" }, { r: "2–2" }, { r: "1–3", cls: "el", tag: "out" }] },
  { h: "Rd 5", recs: [{ r: "3–2", cls: "ad", tag: "through" }, { r: "2–3", cls: "el", tag: "out" }] },
];

const TIER_COPY: Record<CoinTier, { name: string; rule: string }> = {
  diamond: { name: "Diamond", rule: "#1 · top 10%" },
  gold: { name: "Gold", rule: "Top 25%" },
  silver: { name: "Silver", rule: "Top 50%" },
  bronze: { name: "Bronze", rule: "You took part" },
};

/** Illustrative strike — the last Major's coins (Singapore's is minted at its final).
 *  Real ChallengeCoin shapes so each one opens the drag-to-rotate inspector. */
const DEMO_COINS: ChallengeCoin[] = COIN_TIERS.map((tier) => ({
  eventId: 0,
  slug: "iem-cologne-2026",
  name: "IEM Cologne 2026",
  tier,
  finish: null,
  fieldSize: 0,
  earnedAtMs: 0,
}));

export default function HowToPlayPage() {
  return (
    <div className="sgc-ed">
      <section className="bleed tall sgc-hero">
        <img src="/wrapped/major-cover.jpg" alt="" />
        <span className="credit">Photo · HLTV</span>
        <div className="in">
          <span className="eyebrow rise">Field manual · PGL Major Singapore 2026</span>
          <h1 className="display rise d1">
            How
            <br />
            Pick&apos;Em
            <br />
            works
          </h1>
          <p className="rise d2">
            Thirty-two teams, three weeks, one trophy. Before each stage you{" "}
            <b>call who sweeps, who crashes, and who survives</b> — then watch the board sort the
            sharp from the lucky.
          </p>
        </div>
      </section>

      {/* 01 — The Major */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">01 — The Major</span>
          <h2>Four stages, start to trophy</h2>
          <p>
            Each stage halves the field. You make a fresh set of calls before every one — they{" "}
            <b>lock at the first match</b> and can&apos;t be changed after.
          </p>
        </div>
        <div className="sgc-tl">
          {STAGES.map((s) => (
            <div key={s.t}>
              <span className="d">{s.d}</span>
              <span className="t">{s.t}</span>
              <span className="f">
                16<span>→ 8 survive</span>
              </span>
              <Dots n={16} lit={8} />
              <span className="p">
                <b>{s.ppc} pt{s.ppc > 1 ? "s" : ""}</b> per call · {s.ppc * 10} max
              </span>
            </div>
          ))}
          <div className="po">
            <span className="d">10 – 13 Dec · Indoor Stadium</span>
            <span className="t">Playoffs</span>
            <span className="f">
              8<span>→ 1 champion</span>
            </span>
            <Dots n={8} lit={1} />
            <span className="p">
              <b>12 · 10 · 7</b> per round · 75 max
            </span>
          </div>
        </div>
      </section>

      {/* 02 — Swiss */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">02 — Swiss</span>
          <h2>Three wins in, three losses out</h2>
          <p>
            In each Swiss stage, teams keep playing until they hit <b>3 wins</b> (through) or{" "}
            <b>3 losses</b> (gone). They&apos;re matched by record, so a 2–0 team plays another 2–0.
          </p>
        </div>
        <div className="sgc-swiss" role="img" aria-label="Swiss record paths: every team finishes on 3–0, 3–1 or 3–2 (through), or 0–3, 1–3 or 2–3 (out).">
          {SWISS.map((c) => (
            <div className="col" key={c.h}>
              <span>{c.h}</span>
              {c.recs.map((r) => (
                <div key={r.r} className={`sgc-rec${r.cls ? ` ${r.cls}` : ""}`}>
                  {r.r}
                  {r.tag && <small>{r.tag}</small>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sgc-legend">
          <span><i className="sw" />3–0 · you call 2</span>
          <span><i className="ad" />3–1 or 3–2 · you call 6</span>
          <span><i className="wo" />0–3 · you call 2</span>
        </div>
      </section>

      {/* 03 — Making a call */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">03 — Making a call</span>
          <h2>Tap a team. Tap a slot.</h2>
          <p>
            That&apos;s the whole interaction — try it below. On the real board you can also drag, and
            the <b>i</b> on any team opens its roster, world rank and recent form.
          </p>
        </div>
        <TapDemo />
      </section>

      {/* 04 — Points */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">04 — Points</span>
          <h2>Swiss climbs. Playoffs flip.</h2>
          <p>
            Straight from Valve&apos;s own scoring. Swiss calls are worth more each stage; in the
            playoffs it <b>inverts</b> — nailing all four quarterfinals is harder than calling one
            final, so it pays more.
          </p>
        </div>
        <div className="sgc-score">
          <div>
            <div className="sgc-sch"><h3>Swiss · per call</h3><span>60 max</span></div>
            <div className="sgc-bars" aria-hidden>
              <div><b>1</b><i style={{ height: "8%" }} /></div>
              <div><b>2</b><i style={{ height: "16%" }} /></div>
              <div><b>3</b><i style={{ height: "25%" }} /></div>
            </div>
            <div className="sgc-axis"><span>Stage I</span><span>Stage II</span><span>Stage III</span></div>
          </div>
          <div>
            <div className="sgc-sch"><h3>Playoffs · per call</h3><span>75 max</span></div>
            <div className="sgc-bars" aria-hidden>
              <div className="po"><b>12</b><i style={{ height: "100%" }} /></div>
              <div className="po"><b>10</b><i style={{ height: "83%" }} /></div>
              <div className="po"><b>7</b><i style={{ height: "58%" }} /></div>
            </div>
            <div className="sgc-axis"><span>Quarterfinal ×4</span><span>Semifinal ×2</span><span>Final ×1</span></div>
          </div>
        </div>
        <p className="sr-only">
          Swiss: 1 point per correct call in Stage I, 2 in Stage II, 3 in Stage III, ten calls each — 60 max.
          Playoffs: 12 per quarterfinal, 10 per semifinal, 7 for the final — 75 max.
        </p>
        <div className="sgc-perfect">
          <span className="v">135</span>
          <p>
            A perfect Major — <b>all 37 calls right</b>, from the first Stage I sweep to the Grand
            Final. Within a Swiss bucket, order doesn&apos;t matter.
          </p>
        </div>
      </section>

      {/* 05 — Lock & reveal */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">05 — Lock &amp; reveal</span>
          <h2>No copying</h2>
          <p>
            Everyone&apos;s picks stay hidden while a stage is open. <b>The moment it locks</b>, the
            whole room&apos;s calls go public at once.
          </p>
        </div>
        <div className="sgc-flow">
          <div><span className="k">Open</span><span className="t">Call it</span><p>Make and change picks freely. Nobody sees yours.</p></div>
          <div><span className="k">First match</span><span className="t">Locked</span><p>Picks freeze the moment the stage starts.</p></div>
          <div><span className="k">At lock</span><span className="t">Reveal</span><p>Every player&apos;s calls go public — consensus, bold calls, who faded whom.</p></div>
          <div><span className="k">Results land</span><span className="t">Scored</span><p>Points update live, the board redraws, the next stage opens.</p></div>
        </div>
      </section>

      {/* 06 — Two ways in */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">06 — Two ways in</span>
          <h2>Same board either way</h2>
          <p>
            Local and Steam-synced players <b>share one leaderboard</b>, ranked by points.
          </p>
        </div>
        <div className="sgc-lanes">
          <div className="sgc-lane">
            <div className="ph"><img src="/wrapped/major-thanks.jpg" alt="" loading="lazy" /></div>
            <div className="b">
              <span className="eyebrow">Free</span>
              <h3>Play here</h3>
              <ul>
                <li>Make picks in HOTLINE</li>
                <li>Full board, reveal and compare</li>
                <li>Earn HOTLINE challenge coins</li>
                <li>Join late and call every stage still open</li>
                <li className="no">No in-game Valve Pick&apos;Em</li>
              </ul>
            </div>
          </div>
          <div className="sgc-lane">
            <div className="ph"><img src="/wrapped/major-nations.jpg" alt="" loading="lazy" /></div>
            <div className="b">
              <span className="eyebrow"><b>Needs the Viewer Pass</b></span>
              <h3>Sync with Steam</h3>
              <ul>
                <li>Everything on the left</li>
                <li>Picks mirror your in-game Pick&apos;Em</li>
                <li>Stages that already locked backfill from your official picks</li>
                <li>
                  Two-minute setup with an{" "}
                  <Link href="/help/auth-code" prefetch={false}>auth code</Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 07 — Coins */}
      <section className="chap">
        <div className="chap-h">
          <span className="n">07 — Coins</span>
          <h2>One coin per Major</h2>
          <p>
            Make at least one pick and a coin mints when the Grand Final ends.{" "}
            <b>Where you finish decides the metal.</b>
          </p>
        </div>
        <div className="sgc-coin-case">
          <CoinCase slots={DEMO_COINS.length}>
            {DEMO_COINS.map((coin, i) => (
              <CoinSlot
                key={coin.tier}
                coin={coin}
                title={TIER_COPY[coin.tier].name}
                sub={TIER_COPY[coin.tier].rule}
                subTier={coin.tier}
                delay={i * 1.3}
              />
            ))}
          </CoinCase>
          <span className="sgc-note">
            Shown: the Cologne 2026 strike · tap one to turn it over · slices round up, so #2 of 7 is gold
          </span>
          <span className="sgc-coin-links">
            <Link href="/coins" prefetch={false} className="eyebrow">See current coin-holders →</Link>
          </span>
        </div>
      </section>

      <section className="cta">
        <Link href="/picks" prefetch={false} className="btn-solid">Make your calls</Link>
        <Link href="/faq" prefetch={false} className="btn-ghost">Read the FAQ</Link>
      </section>
    </div>
  );
}
