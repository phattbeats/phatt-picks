# Stage Wrapped — Design Record

Stage Wrapped is live: `src/lib/stage-wrapped-content.ts` (`buildStageWrappedDeck()`, authored
decks keyed by section id) + `stage-wrapped-core.ts`, gated by `StageWrappedGate`. This is a
condensed design record — the *why* behind the shape of the feature — replacing two longer
working drafts whose proposed types/lyrics diverged from what actually shipped.

## The core decision: stat-derived moments, not video clips

A "craziest moment" is a stat-derived beat, not a video clip: team logos + a figure/score + one
line of copy, built from data already ingested (HLTV Swiss standings/bracket + picks/consensus/
scoring/rank snapshots). No free source of short per-moment CS2/HLTV video clips exists — what's
available (full-match ESL highlight reels, HLTV match VOD pages) is match-length, not
moment-length, so embedded per-moment clips were designed out from the start.

## Media policy

- **Stat card with team logos** — the backbone of every moment, personal and event. No external
  dependency, no crawl, no rights question.
- **One optional honest link** on event moments, typed by `WrappedMomentLink.source` so the CTA
  verb always matches the medium:
  - `esl-youtube` → "Watch the full-match highlights"
  - `hltv-match` → "See the match"
  - `news-recap` → "Read what happened"
  - `curated` → an editorially hand-picked URL
- **No embedded per-moment clips.** A link that over-promises ("watch this moment") is worse than
  no link, since the reel/VOD has no per-moment timestamp.

The `news-recap` option exists because the two best beats from the first two stages — BIG's
16-12-OT comeback from 0-12 down against NRG, and donk's 2.27-rating stage run for Spirit —
were carried better by a human-written article than by a stat card or a 6-minute reel. The data
path covers systematic moments (clinchers, upsets, your-run) that recur every stage for free; the
editorial path covers historic moments that data can flag the shape of but not the weight of.

## Selection

Personal slides (your stage score, your best call, your miss) always render. One event moment is
chosen by a "craziness" ranking — biggest upset by seed gap, contrarian-correct by rarity of the
correct pick, clinchers promoted when they beat the field's consensus, rank-climber by max
leaderboard delta — and a quiet stage with no upset falls back to the 3-0/0-3 clinchers, which
always exist once a Swiss stage resolves. The deck stays empty until a stage is resolved; it never
renders placeholder figures.

## Soundtrack

The original draft explored AI-generated (Suno) anthems per stage; that was abandoned. The
shipped soundtrack is Kevin MacLeod's CC-BY catalog — see `public/audio/CREDITS.md`.

## Content sourcing

Stage 1 and 2 narratives were fanned out across HLTV, Liquipedia, Wikipedia, and several esports
news outlets, then hand-verified before being authored into `stage-wrapped-content.ts`. Every
event beat quoted in the deck is sourced from real match results and reporting, not generated.
