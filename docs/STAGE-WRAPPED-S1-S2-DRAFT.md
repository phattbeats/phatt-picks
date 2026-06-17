# Stage Wrapped — Stage 1 + Stage 2 Recap **DRAFT**

> **STATUS — SHIPPED (content record).** This draft's Stage I/II narratives are live, authored in
> `src/lib/stage-wrapped-content.ts` as `AUTHORED[105]` / `AUTHORED[106]`; PHA-1052's shell merged.
> Kept for the source narratives + research trail. Two things below are **superseded**: (1) the
> `WrappedMoment[]` arrays in §3 are not the shipped shape — the implemented type is `AuthoredMoment`
> (no `link`/`source` fields), keyed by section id; (2) the **Suno** soundtrack in §4 was abandoned —
> the shipped audio is "The Descent" by Kevin MacLeod (CC-BY), see `public/audio/CREDITS.md`.

**Issue:** PHA-1054 (Stage 1 recap content + launch trigger) · **Epic:** PHA-1051 Stage Wrapped
**Depends on:** PHA-1052 shell (framework, *merged*) · **Content model:** PHA-1053 (`docs/STAGE-WRAPPED-CONTENT-MODEL.md`)
**Event:** IEM Cologne 2026 CS2 Major — Stage 1 (HLTV 9028, Jun 2–5) + Stage 2 (HLTV 9029, Jun 6–9)
**Author:** Vision Quest · **Date:** 2026-06-13 · **Status:** SHIPPED (was: DRAFT for Brandon review)

> Brandon asked: *"stage 1 + 2 already wrapped for this major, do this for both: do a fan out > fan in
> searches to get the narratives for the teams; create a draft, with music from suno included."*
> This is that draft. Narratives below come from a 7-agent fan-out across HLTV / Liquipedia /
> Wikipedia / egamersworld / esports.gg / vpesports / talkesport / dotesports / dust2 / win.gg /
> escharts, fanned in here. Every event beat is real and sourced (§5). Suno anthems in §4.

---

## 0. How to read this

Two decks — **Stage 1 Wrapped** and **Stage 2 Wrapped** — each following the PHA-1053 shape:
**intro → 2–4 "craziest moments" (event scope) → 1 personal slide (your run).**

Each moment is a `WrappedMoment` (see content model §1): `eyebrow` / `headline` / `body` / `figure` /
`figureCaption` / `logoPickIds` / optional honest `link`. The TS arrays in §3 are paste-ready for the
deck builder once PHA-1052 merges — no shell changes needed, they're plain text+figure+logo moments.

`logoPickIds` resolve to team logos via `logos-core` (32/32 live). Pickid reference used below:

| Team | pickid | Team | pickid | Team | pickid |
|---|---|---|---|---|---|
| Natus Vincere | 12 | NRG | 87 | Lynn Vision | 127 |
| Liquid | 48 | Spirit | 81 | FlyQuest | 132 |
| G2 | 59 | Vitality | 89 | B8 | 135 |
| Astralis | 60 | paiN | 102 | BetBoom | 137 |
| BIG | 69 | 9z | 112 | Falcons | 139 |
| TYLOO | 74 | GamerLegion | 115 | M80 | 140 |
| MIBR | 80 | Monte | 119 | FUT | 145 |
| FURIA | 85 | The MongolZ | 122 | Gaimin Gladiators | 146 |
| HEROIC | 95 | Legacy | 126 | SINNERS | 147 |

*(THUNDER dOWNUNDER 148, Sharks 104.)*

---

## 1. STAGE 1 WRAPPED — the deck

> **Theme:** the favorites fell and the impossible happened. Two flawless runs, one giant buried by
> a #81 seed, and the first 0-12 comeback in Major history — in the home building.

### Slide 1 — Intro
- **eyebrow:** `IEM COLOGNE 2026 · STAGE 1 · WRAPPED`
- **headline:** `Sixteen walked in. Eight walked out.`
- **figure:** `STAGE 1`
- **figureCaption:** `Jun 2–5 · LANXESS Arena, Cologne`
- **body:** `The opening Swiss is done. Before you see who you called right — here's how Stage 1 actually went down.`

### Slide 2 — Biggest upset *(type: `biggest-upset`)*
- **eyebrow:** `BIGGEST UPSET`
- **headline:** `FlyQuest buried a giant`
- **figure:** `#81 over #25`
- **figureCaption:** `13-2, then 2-0 — Team Liquid go home`
- **body:** `World #81 FlyQuest met pre-event favorite Team Liquid in a win-or-go-home match and demolished the opener 13-2 before closing the sweep. The biggest ranking-gap exit of the stage.`
- **logoPickIds:** `[132, 48]` *(FlyQuest, Liquid)*
- **link:** `Watch the full-match highlights` → ESL `@ESLCSHighlights` FlyQuest vs Liquid reel *(honest full-match link per content model §4)*

### Slide 3 — The comeback *(type: `craziest-moment` — the headline beat)*
- **eyebrow:** `THE COMEBACK`
- **headline:** `Down 0-12. Won sixteen straight.`
- **figure:** `0-12 → 16-12`
- **figureCaption:** `BIG break NRG — and Major history — for the last Stage 2 spot`
- **body:** `Deciding Mirage, last ticket to Stage 2. NRG raced to a flawless 12-0 first half, one round from advancing. Then BIG won sixteen rounds in a row to take it 16-12 in overtime — the first comeback from 0-12 in Major history, in front of the home crowd. The match peaked near 500K viewers.`
- **logoPickIds:** `[69, 87]` *(BIG, NRG)*
- **link:** `Read what happened` → `https://www.hltv.org/news/44808/big-squeeze-past-nrg-into-stage-2-after-0-12-comeback`

### Slide 4 — Flawless *(type: `three-oh`)*
- **eyebrow:** `FLAWLESS`
- **headline:** `Two teams. Zero losses.`
- **figure:** `3-0`
- **figureCaption:** `BetBoom and B8 swept the field`
- **body:** `BetBoom (+29 round diff) ran the table and never blinked. B8 matched them — including a 22-20 Inferno marathon vs M80 — to make it two perfect runs into Stage 2.`
- **logoPickIds:** `[137, 135]` *(BetBoom, B8)*

### Slide 5 — Fallen favorites *(type: `elimination` / `oh-three`)*
- **eyebrow:** `THE GIANTS FELL`
- **headline:** `Two top-30 seeds. Both out.`
- **figure:** `#25 · #27`
- **figureCaption:** `Liquid and HEROIC eliminated in the opening Swiss`
- **body:** `Liquid (#25) and HEROIC (#27) both came in expected to advance; both went home. And nobody escaped winless quietly — SINNERS pushed FlyQuest to 14-16 before bowing out 0-3 alongside Gaimin Gladiators.`
- **logoPickIds:** `[48, 95]` *(Liquid, HEROIC)*

### Slide 6 — Your Stage 1 *(type: `personal` — reuses reveal/snapshot data, never leaks pre-lock)*
- **eyebrow:** `YOUR STAGE 1`
- **headline:** `{firstName}, here's your call sheet`
- **figure:** `{correct}/{possible}` *(from `scoring.ts ScoreBreakdown.bySection[105]`)*
- **figureCaption:** `{rankDelta >= 0 ? "↑" : "↓"} {abs(rankDelta)} spots on the board` *(from `rank-snapshot-core`)*
- **body:** `Your best call: {lowestConsensusHit} — only {bucketShare}% of players had it. {missLineGentle}`
- **fallback (no picks):** `You sat Stage 1 out. Stage 3 picks are open — get on the board.`

---

## 2. STAGE 2 WRAPPED — the deck

> **Theme:** one team turned a Major into an audit, while the bracket spat out the storied names and
> let the underdogs through. donk's 2.27. Astralis's drought. Three deciders on the final day.

### Slide 1 — Intro
- **eyebrow:** `IEM COLOGNE 2026 · STAGE 2 · WRAPPED`
- **headline:** `The bracket tightened. Eight made the Playoffs.`
- **figure:** `STAGE 2`
- **figureCaption:** `Jun 6–9 · the road to Stage 3`
- **body:** `Sixteen teams, eight Playoff tickets. Here's the stage that decided who plays for Cologne.`

### Slide 2 — Total dominance *(type: `craziest-moment` — the headline beat)*
- **eyebrow:** `UNTOUCHABLE`
- **headline:** `Spirit didn't play Stage 2. They audited it.`
- **figure:** `10 rounds`
- **figureCaption:** `conceded across the entire 3-0 — donk at a 2.27 rating`
- **body:** `Team Spirit gave up ten total rounds all stage (+42 diff): 13-1 over MIBR, 13-3 and 13-1 over 9z. donk posted a 2.27 — the highest individual figure of Stage 2 and one of the most dominant stage runs in recent Major memory.`
- **logoPickIds:** `[81]` *(Spirit)*
- **link:** `Read the donk run` → `https://www.dust2.us/news/74697/donk-smurfs-in-stage-two-of-the-iem-cologne-major-with-an-insane-227-rating`

### Slide 3 — Nobody penciled them in *(type: `biggest-upset` / `three-oh`)*
- **eyebrow:** `NOBODY PENCILED THEM IN`
- **headline:** `FUT ran the table`
- **figure:** `3-0`
- **figureCaption:** `incl. a 2-1 over G2 — first-ever Cologne Playoff berth`
- **body:** `The team most brackets underestimated went a flawless 3-0. IGL Krabeni hijacked the Ancient decider to take down G2, and FUT booked their first Stage 3 at an IEM Cologne Major — arriving as a contender, not a Cinderella.`
- **logoPickIds:** `[145, 59]` *(FUT, G2)*

### Slide 4 — The drought *(type: `elimination`)*
- **eyebrow:** `THE DROUGHT CONTINUES`
- **headline:** `Astralis bow out. Again.`
- **figure:** `9 Majors`
- **figureCaption:** `paiN sweep them 2-0 — nine straight Majors without a Playoff`
- **body:** `TYLOO cracked them open 13-9, then paiN finished it 2-0 — Astralis collapsed on their own Nuke pick (11-13) and got run off Overpass 4-13. Nine consecutive Majors now without reaching the Playoffs. MIBR went out the same day.`
- **logoPickIds:** `[60, 102]` *(Astralis, paiN)*

### Slide 5 — Win or go home *(type: `craziest-moment`)*
- **eyebrow:** `WIN OR GO HOME`
- **headline:** `Three teams. Three deciders. All survived.`
- **figure:** `3-2`
- **figureCaption:** `Monte, Legacy and B8 each won a do-or-die for the last tickets`
- **body:** `The final day was a gauntlet of single-match survival. Monte upset paiN 2-0 (AZUWU 39-22). Legacy bullied TYLOO 13-7, 13-4. And B8 — 0-2 to start the stage — reverse-swept BIG, kensizor771 sealing it with an ace. All three made the Playoffs.`
- **logoPickIds:** `[119, 126, 135]` *(Monte, Legacy, B8)*

### Slide 6 — Your Stage 2 *(type: `personal`)*
- **eyebrow:** `YOUR STAGE 2`
- **headline:** `{firstName}, the bracket judged you too`
- **figure:** `{correct}/{possible}` *(from `scoring.ts ScoreBreakdown.bySection[106]`)*
- **figureCaption:** `{rankDelta} on the leaderboard since Stage 1`
- **body:** `Your sharpest read: {lowestConsensusHit} ({bucketShare}% had it). {missLineGentle} Stage 3 is where it counts double.`
- **fallback (no picks):** `Stage 2 went by without you. The Playoffs are seeded — last chance to call it.`

---

## 3. Paste-ready moment data (drop in once PHA-1052 merges)

```ts
// STAGE 1 — event moments (intro + personal handled by deck builder from snapshot data)
export const STAGE1_WRAPPED_MOMENTS: WrappedMoment[] = [
  {
    id: "upset-105-flyquest-over-liquid",
    type: "biggest-upset", scope: "event", rank: 95,
    eyebrow: "BIGGEST UPSET",
    headline: "FlyQuest buried a giant",
    figure: "#81 over #25",
    figureCaption: "13-2, then 2-0 — Team Liquid go home",
    body: "World #81 FlyQuest met pre-event favorite Team Liquid in a win-or-go-home match and demolished the opener 13-2 before closing the sweep.",
    logoPickIds: [132, 48],
    link: { label: "Watch the full-match highlights", href: "https://www.youtube.com/@ESLCSHighlights", source: "esl-youtube" },
  },
  {
    id: "comeback-105-big-0-12-nrg",
    type: "craziest-moment", scope: "event", rank: 100,
    eyebrow: "THE COMEBACK",
    headline: "Down 0-12. Won sixteen straight.",
    figure: "0-12 → 16-12",
    figureCaption: "BIG break NRG — and Major history — for the last Stage 2 spot",
    body: "NRG raced to a flawless 12-0 first half on the deciding Mirage. BIG then won sixteen rounds in a row to take it 16-12 in OT — the first 0-12 comeback in Major history, in the home building.",
    logoPickIds: [69, 87],
    link: { label: "Read what happened", href: "https://www.hltv.org/news/44808/big-squeeze-past-nrg-into-stage-2-after-0-12-comeback", source: "hltv-match" },
  },
  {
    id: "three-oh-105-betboom-b8",
    type: "three-oh", scope: "event", rank: 80,
    eyebrow: "FLAWLESS",
    headline: "Two teams. Zero losses.",
    figure: "3-0",
    figureCaption: "BetBoom and B8 swept the field",
    body: "BetBoom (+29 round diff) ran the table; B8 matched them, including a 22-20 Inferno marathon vs M80.",
    logoPickIds: [137, 135],
  },
  {
    id: "elim-105-liquid-heroic",
    type: "elimination", scope: "event", rank: 78,
    eyebrow: "THE GIANTS FELL",
    headline: "Two top-30 seeds. Both out.",
    figure: "#25 · #27",
    figureCaption: "Liquid and HEROIC eliminated in the opening Swiss",
    body: "Liquid (#25) and HEROIC (#27) both came in expected to advance; both went home. SINNERS and Gaimin Gladiators exited 0-3.",
    logoPickIds: [48, 95],
  },
];

// STAGE 2 — event moments
export const STAGE2_WRAPPED_MOMENTS: WrappedMoment[] = [
  {
    id: "dominance-106-spirit-donk",
    type: "craziest-moment", scope: "event", rank: 100,
    eyebrow: "UNTOUCHABLE",
    headline: "Spirit didn't play Stage 2. They audited it.",
    figure: "10 rounds",
    figureCaption: "conceded across the entire 3-0 — donk at a 2.27 rating",
    body: "Spirit gave up ten total rounds all stage (+42): 13-1 over MIBR, 13-3 and 13-1 over 9z. donk posted a 2.27, the highest individual figure of the stage.",
    logoPickIds: [81],
    link: { label: "Read the donk run", href: "https://www.dust2.us/news/74697/donk-smurfs-in-stage-two-of-the-iem-cologne-major-with-an-insane-227-rating", source: "hltv-match" },
  },
  {
    id: "upset-106-fut-3-0",
    type: "biggest-upset", scope: "event", rank: 90,
    eyebrow: "NOBODY PENCILED THEM IN",
    headline: "FUT ran the table",
    figure: "3-0",
    figureCaption: "incl. a 2-1 over G2 — first-ever Cologne Playoff berth",
    body: "The team most brackets underestimated went 3-0. Krabeni took over the Ancient decider vs G2; FUT booked their first Stage 3 at an IEM Cologne Major.",
    logoPickIds: [145, 59],
  },
  {
    id: "elim-106-astralis-drought",
    type: "elimination", scope: "event", rank: 85,
    eyebrow: "THE DROUGHT CONTINUES",
    headline: "Astralis bow out. Again.",
    figure: "9 Majors",
    figureCaption: "paiN sweep them 2-0 — nine straight Majors without a Playoff",
    body: "TYLOO cracked them 13-9, paiN finished 2-0 — Astralis fell on their own Nuke pick (11-13) and lost Overpass 4-13. Nine straight Majors without Playoffs. MIBR went out the same day.",
    logoPickIds: [60, 102],
  },
  {
    id: "gauntlet-106-three-deciders",
    type: "craziest-moment", scope: "event", rank: 82,
    eyebrow: "WIN OR GO HOME",
    headline: "Three teams. Three deciders. All survived.",
    figure: "3-2",
    figureCaption: "Monte, Legacy and B8 each won a do-or-die for the last tickets",
    body: "Monte upset paiN 2-0 (AZUWU 39-22). Legacy bullied TYLOO 13-7, 13-4. B8 — 0-2 to start — reverse-swept BIG, kensizor771 sealing it with an ace.",
    logoPickIds: [119, 126, 135],
  },
];
```

> **rank** is the §3 selection score from the content model — higher = "crazier", deck shows top-N in
> order. The two comeback/dominance beats are deliberately the highest so each deck opens its moment
> run on its strongest card.

---

## 4. Suno soundtrack — paste-ready song specs

> **Heads-up for Brandon:** there is no Suno API key wired into my environment, so I can't render the
> audio myself. Below are two **complete, paste-ready Suno specs** (style prompt + structured lyrics
> with meta-tags). Paste each into Suno (Custom mode → Style + Lyrics), generate, and drop the MP3
> into the deck. If you'd rather I be able to generate these directly, add a `SUNO_API_KEY` to my
> environment (or the PHATT_TECH tooling doc) and I'll wire a render step. **Tell me if you want
> different genres** — these are my read of each stage's energy, not a locked call.

### 4.1 Stage 1 anthem — **"Twelve to Nothing"**

**Suno style prompt (paste into Style):**
```
aggressive hybrid trap, orchestral build into hard 808 drop, industrial German techno undertone,
distorted brass stabs, stadium crowd roar samples, tense cinematic strings, half-time gut-punch
drop, dark triumphant, 140 BPM, male gritty chant vocals
```

**Suno lyrics (paste into Lyrics):**
```
[Intro - whispered over rising strings]
Sixteen walked in...
only eight walk out.

[Verse 1]
Favorites on paper, ash in the wind,
Liquid came loud, then it caved in —
two to thirteen, the giant's on the floor,
eighty-one knocking the top seed out the door.

[Pre-Chorus - building]
Down on the board, the clock running thin,
nobody breathing in the LANXESS din —

[Drop / Chorus - heavy 808]
TWELVE to NOTHING and they don't fold,
sixteen rounds, the bravest told,
NRG froze, BIG took the throne,
first to climb out of the oh-twelve hole.
(History — written in the home zone.)

[Verse 2]
BetBoom flawless, B8 the same,
two perfect runs and they spell their name,
SINNERS swung, fourteen-sixteen close,
HEROIC and Liquid in the highlight ghost.

[Bridge - half time, crowd swell]
You called it, or you didn't —
the bracket doesn't lie.
Stage one's in the books now...
[beat drop]

[Outro Chorus]
TWELVE to NOTHING, let it ring,
the underdogs took everything,
eight survive and the rest go home —
Cologne just found its opening tone.
```

### 4.2 Stage 2 anthem — **"Ten Rounds"**

**Suno style prompt (paste into Style):**
```
dark Eastern-European phonk meets Brazilian baile funk, cold metallic 808s, menacing low choir,
aggressive cowbell, switch-up second half into euphoric funk drop, villain-energy verses into
underdog-celebration chorus, 150 BPM, layered male + chant vocals, cinematic outro
```

**Suno lyrics (paste into Lyrics):**
```
[Intro - cold, sparse]
They didn't play the stage...
they audited it.

[Verse 1 - menacing]
Ten rounds given the whole way through,
two-twenty-seven, nothing you can do,
thirteen-one and the bomb never lands,
donk on the server with the whole game in his hands.

[Pre-Chorus]
The bracket spat out every storied name,
nine straight Majors — Astralis, same old pain —

[Drop / Chorus - funk switch]
But the kids that nobody picked,
FUT run the table, three-and-oh quick,
Krabeni on Ancient, stealing the night,
the underdog ticket cashed in under the light!
(Eight make the playoffs — hold on tight.)

[Verse 2 - funk energy]
Monte said "underdog? not today,"
AZUWU thirty-nine and paiN walks away,
Legacy bully, thirteen to four,
B8 down two and they came back for more —
kensizor ace, slam the door.

[Bridge]
Three teams, three deciders,
win or you're gone,
final day gauntlet —
they all carried on.

[Outro Chorus]
TEN ROUNDS — that's all they'd give,
the perfect run, the way they live,
but the road to Cologne ain't carved in stone,
eight teams left... and they're not alone.
```

---

## 5. Sources (fan-out provenance)

**Stage 1:** HLTV 9028 + news/44808 (0-12 comeback) · egamersworld Stage 1 recap + day-by-day ·
escharts stage1 results · esports.gg Stage 1 overview · Liquipedia Cologne/Stage_1 · dotesports
BIG/NRG + FlyQuest/Liquid · pley.gg/HLTV (THUNDER dOWNUNDER upset) · win.gg recap.

**Stage 2:** HLTV 9029 · Liquipedia Cologne/Stage_2 · Wikipedia IEM_Cologne_Major_2026 ·
egamersworld Stage 2 recap · vpesports/talkesport day recaps · dust2.us (donk 2.27) · techtimes ·
hotspawn (Spirit/FUT, 9z/BetBoom/G2) · community.skin.club (Astralis/MIBR out, paiN/B8) ·
fieldlevelmedia (BetBoom/9z/G2) · esports.gg Stage 2 details.

Full URL list lives in the fan-out task output; key citations inlined per slide above.

---

## 6. Launch trigger + no-op safety (for the wiring task, post-PHA-1052)

Per PHA-1054 scope — when the framework merges, the deck fires from the **same reveal/rank-snapshot
gating** the rest of the app uses, so it can never leak before a stage locks/resolves:

- **Trigger:** Stage N Wrapped becomes available once section N is **resolved** (terminal outcomes
  in `StageOutcome` / standings status) AND the reveal gate for N is open — reuse
  `event-freeze` / reveal selectors, do **not** add a parallel clock.
- **No-op proof:** before a stage resolves, the moment list is empty → deck builder yields zero event
  slides → entry point hidden. Add a `verify-stage-wrapped-content` assertion: given pre-resolve
  fixtures, `buildStageWrappedDeck(105)` returns only the (data-driven) personal/intro scaffold with
  no event moments; given resolved fixtures, returns the §3 arrays.
- **Personal slide:** pulls from `scoring.ts bySection[]` + `rank-snapshot-core` + `bucketShareFor()`
  — all already reveal-gated, so no new leak surface.
- **Screenshot proof at user width (1440–1920):** required on the wiring PR, not this draft.

---

*Draft ends. Awaiting Brandon's review on: (a) narrative tone/picks per slide, (b) Suno genres + lyrics,
(c) whether to wire a `SUNO_API_KEY` render step. Wiring stays blocked on PHA-1052.*
