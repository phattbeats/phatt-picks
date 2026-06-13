# Stage Wrapped — "Craziest Moments" Content Model & Media Recommendation

**Issue:** PHA-1053 (research) · **Epic:** PHA-1051 Stage Wrapped · **Feeds:** PHA-1052 shell (done), PHA-1054 Stage 1 content
**Date:** 2026-06-13 · **Author:** Vision Quest

---

## 0. TL;DR — the decision

A "craziest moment" is a **stat-derived beat**, not a video clip. We build every moment from
data we already ingest (HLTV Swiss standings/bracket + our picks/consensus/scoring/rank
snapshots) and render it as a **moment card**: team logos + a figure/score + one line of copy.

**Media recommendation:** ship **option (a) — stat/score moment cards with team logos — now.**
Add **option (b) as a single optional "Watch" deep-link** to the ESL full-match highlight reel
and/or the HLTV match page. **Do NOT** build embedded per-moment video clips, and **do NOT**
write copy that promises a clip of *this specific moment* — that source does not exist for free.

> **Adversarial check against PHA-1043 (passed).** PHA-1043 spotlight research verified there is
> **no free source of short per-moment CS2/HLTV video clips.** What exists: full-match ESL
> `@ESLCSHighlights` reels (~3–8 min, one per *match*, title-parseable) and HLTV match pages
> (Allstar.gg widget + VODs). Neither returns a 10-second "the clutch" clip, and neither carries a
> per-moment timestamp. So any "watch this moment" affordance is, at best, a link to the **full
> match** — it must be labelled honestly as such. This model assumes **zero** embeddable
> per-moment video and is correct even if that never changes.

---

## 1. What a "moment" is (the type)

A moment is a small, typed record the deck builder ranks and turns into a `WrappedSlide`
(the slide model already shipped in `src/lib/stage-wrapped-core.ts`). Proposed shape — an
extension of the existing `WrappedSlide`, additive so the PHA-1052 shell stays unchanged for
text-only moments:

```ts
// proposed for PHA-1054 — sits alongside the existing WrappedSlide model
export interface WrappedMomentLink {
  label: string;                       // honest CTA, e.g. "Watch the full-match highlights"
  href: string;                        // ESL reel URL or HLTV match page — NEVER a per-moment clip
  source: "esl-youtube" | "hltv-match";
}

export interface WrappedMoment {
  id: string;                          // stable, e.g. "upset-105-team12-over-team48"
  type: MomentType;                    // see §2 catalog
  scope: "personal" | "event";         // "your" beat vs the stage's beat
  rank: number;                        // selection score (§3); higher = more "crazy"
  // — render payload (maps onto WrappedSlide fields) —
  eyebrow: string;                     // "BIGGEST UPSET", "YOUR STAGE", "THE CLINCHER"
  headline: string;
  body?: string;
  figure?: string;                     // hero number/score, e.g. "#14 over #2", "3-0", "+9"
  figureCaption?: string;
  logoPickIds?: number[];              // 1–2 team pickids → logos via logos-core (32/32 live)
  link?: WrappedMomentLink;            // optional, event moments only (§4)
}

export type MomentType =
  | "biggest-upset"
  | "clincher-3-0"
  | "clincher-0-3"
  | "elimination"
  | "contrarian-correct"   // the field's most contrarian *correct* pick
  | "rank-climber"         // player who gained the most leaderboard rank
  | "your-stage-score"     // personal: your hit-rate this stage
  | "your-best-call"       // personal: your lowest-consensus correct pick
  | "your-miss"            // personal: the bucket you whiffed (gentle)
  | "closest-map";         // TIER 2 — needs map-score parse, not available now
```

The shell already supports `intro | stat | moment | standings | outro` slide *kinds*. The
builder maps each `WrappedMoment` onto one of those kinds (mostly `stat` and `moment`).

---

## 2. Moment catalog — what's computable, and from where

All file/line refs are against the current repo. "Live now" = derivable from data we already
ingest and resolve during the event.

| # | Moment | Scope | Source (file → fields/fn) | Live now? |
|---|--------|-------|---------------------------|-----------|
| 1 | **Biggest upset** | event | `swiss-results-core.ts` `RawStandingRow.seed` + `swiss-bracket-core.ts` `team{1,2}.{score,winner}`, `matchId`; tiebreak `team-stats-core.ts` `worldRank` | ✅ |
| 2 | **3-0 clincher** | event | `swiss-clinch-core.ts` `pickBucketForRecord(w,l)` → `"3-0"`; standings `wins/losses` | ✅ (already implemented) |
| 3 | **0-3 clincher** (the elimination beat) | event | `swiss-clinch-core.ts` → `"0-3"` | ✅ |
| 4 | **Elimination** (any `losses>=3`) | event | `swiss-results-core.ts` `deriveStatus()` → `"eliminated"` | ✅ |
| 5 | **Field's most contrarian *correct* pick** | event | `consensus-core.ts` `buildBucketConsensus` + `bucketShareFor()` (count/total) ∩ resolved outcome | ✅ |
| 6 | **Rank climber** (player who gained most) | event | `rank-snapshot-core.ts` `rankDelta()`, `buildSnapshotRows()` (pre/post section) | ✅ |
| 7 | **Your stage score** (hit-rate) | personal | `scoring.ts` `ScoreBreakdown.bySection[].{correct,possible,points}` | ✅ |
| 8 | **Your best call** (your lowest-consensus hit) | personal | `scoring.ts` correct picks ∩ `bucketShareFor()` minimum | ✅ |
| 9 | **Your miss** (bucket with 0 correct) | personal | `scoring.ts` `bySection[].correct === 0` | ✅ |
| 10 | **Closest map** (16-14 / overtime) | event | ❌ not parsed — bracket stores **series** score only (`swiss-bracket-core.ts:60`, popup JSON `matchScore.team{1,2}Score`); per-map scores dropped | ⚠️ **Tier 2** |

**Tier 1 (build for Stage 1):** moments 1–9. Nine real, honest moment types, all computable
today. That is more than enough to fill a 5–7 slide deck per player.

**Tier 2 (deferred, optional):** moment 10 ("closest map") and any "match duration / OT length"
beat. These need a **new map-score parse** — HLTV's popup JSON carries only the series count
(e.g. "2" in a Bo3), not per-map scores like 16-14, and we store no match end time. This is a
follow-up parse task, **not** a blocker for Stage 1, and **not** a clip dependency. Flag, don't
promise.

---

## 3. Selection — how the deck picks "the craziest"

Each player's deck is ~5–7 slides. The builder produces all eligible `WrappedMoment`s, scores
them, and assembles:

```
[ intro ] → [ your-stage-score ] → [ your-best-call ] → [ 1 event moment ] → [ standings ] → [ outro ]
              (+ your-miss only if it lands gently; skip on a clean sweep)
```

**Personal slides always render** (every signed-in player has a score). **The single event
moment** is chosen by a "craziness" ranking so the deck leads with the stage's actual headline:

- **biggest-upset:** `rank = seedGap` = `loserSeed − winnerSeed` (bigger positive = crazier).
  Use `worldRank` as tiebreak when seeds tie/missing.
- **contrarian-correct:** `rank = (total − count) / total` (rarer correct call = crazier), gated
  to picks that actually resolved correct.
- **clincher-3-0 / 0-3:** flat baseline rank; promoted if the team was *not* the field's
  consensus (a 3-0 nobody saw, or a 0-3 favourite-flame-out, outranks an expected one).
- **rank-climber:** `rank = max rankDelta` across players.

Pick the highest-ranked event moment for the hero slot; keep 1 runner-up only if the deck has
room. **No silent truncation** — if a stage is quiet (no upset, chalk results), fall back to the
3-0/0-3 clinchers, which always exist once a Swiss stage resolves.

**Empty-state honesty:** if the stage isn't resolved yet, the deck doesn't open (the PHA-1052
shell is already one-time-per-resolved-stage via `wrappedSeenKey`). The builder must return
`null`/empty rather than placeholder figures.

---

## 4. Media — the recommendation in detail

Three options were on the table (from the issue). Verdict on each:

### (a) Stat/score moment card with team logos — ✅ **SHIP NOW (the default)**
- **Feasible:** logos are live (`logos-core.ts`, `public/logos/` = 32/32 steamstatic images,
  same pipeline as compare/PicksBoard). Figures/scores come from §2 sources.
- This is the **backbone of every moment**, personal and event. No external dependency, no
  crawl, no rights question. Renders identically on mobile (the deck is a bottom-sheet).

### (b) Deep-link to the match — ✅ **SHIP as one optional "Watch" button (event moments only)**
- **ESL reel:** `@ESLCSHighlights` posts one **full-match** highlights video per match, titles
  parseable as `{A} vs {B} - HIGHLIGHTS - IEM Cologne 2026 Stage N` (PHA-1043, 56+ verified up).
  A small title→match map (same crawl shape as PHA-1043's proposed highlight pipeline) resolves a
  reel URL for the upset/clincher's match.
- **HLTV match page:** we already capture `matchId` (`swiss-bracket-core.ts:66`). The HLTV URL
  needs a slug we don't store — **verify the canonical URL form during PHA-1054** (HLTV's popup
  JSON likely carries it; otherwise `hltv.org/matches/{id}/-` redirect must be confirmed before
  shipping a live link). Until verified, prefer the ESL reel link.
- **Honesty rule (hard):** the CTA reads **"Watch the full-match highlights"** — never "Watch
  this moment". The reel has no per-moment timestamp. A link that over-promises is worse than no
  link. If neither a reel nor a verified match URL resolves, the moment renders card-only (a).

### (c) Curated highlight URL — ⚪ **OPTIONAL, editorial, not v1**
- A per-major hand-picked URL field (like PHA-1043's authored narratives) lets Brandon drop a
  specific clip/VOD timestamp for a marquee moment. Cheap to support (it's just `link.href`), but
  it's manual labour per stage and not required for launch. Leave the field; don't depend on it.

### ❌ Embedded per-moment video clips — **DO NOT BUILD**
- No free source exists (PHA-1043, re-verified §0). Building toward embedded clips means either
  cutting our own with ffmpeg from VODs (rights + effort, rejected in PHA-1043) or a paid clip
  API. Out of scope. The content model is designed to be **great with zero video** so this is
  never on the critical path.

---

## 5. Handoff to PHA-1054 (Stage 1 content)

PHA-1054 builds the real `WrappedSlide[]` builder. This model hands it:

1. **A typed `WrappedMoment` model** (§1) — additive to the shipped `WrappedSlide`; only new bit
   the shell needs is optional rendering of `link` (a button) on `moment`/`stat` slides.
2. **Nine Tier-1 moment builders** (§2 #1–9), each with exact source fns — pure functions over
   data already in the DB/caches, unit-testable in a `verify-stage-wrapped-moments.ts` the same
   way the reducer is tested today.
3. **A selection/ranking function** (§3) to assemble the per-player deck.
4. **A media policy** (§4): logos always; one optional honest "Watch" link on event moments;
   no embedded clips; `closest-map` deferred to Tier 2.

**Open items PHA-1054 must close (small, not blockers):**
- Confirm the canonical HLTV match-page URL form for `matchId` (or rely on ESL reel only).
- Decide whether the ESL reel title→match map is built now or the link ships ESL-channel-level
  (link to `@ESLCSHighlights` filtered by stage) as a v1 simplification.
- Copy tone pass on `your-miss` so a whiffed bucket reads as a wink, not a scold.

**Verdict:** the key unknown the issue named — *what a moment is and where its media comes from* —
is **resolved**. Moments are stat-derived and fully computable today; media is logos + an honest
optional deep-link; embedded per-moment clips are confirmed infeasible and designed out.
