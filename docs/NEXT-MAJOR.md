# Re-pointing at the next Major

This is the runbook. The app is built generically; standing up a new Major is
**editing committed config**, not writing new features. Every seam below is a file
you change, in roughly the order events happen in time.

If you do nothing else, do **Phase 1** (layout + schedule) — that's what makes the
app *work* for the new event. The rest sharpens it.

> **The registry (PHA-948).** `src/lib/events-core.ts` is the committed index of
> events: `EVENTS[eventId] → { slug, name, status, dates, lockSchedule,
> matchWindows, sectionSources, sectionNames, fixtures, teamMaps }`, plus
> `resolveActiveEvent(now)` / `getEventConfig(id)` / `currentEventId(now)`. Every page
> and API route resolves `currentEventId(now)` **per request** instead of a hardcoded
> `26`, so the active event is decided in **one place** (PHA-1046 removed the
> module-load-bound `ACTIVE_EVENT_ID` and `SECTION_SOURCES` — never cache the active
> id at module scope). With the self-sustaining lifecycle
> (PHA-950) you no longer flip `status` by hand on go-live day: stage the new
> entry as `status: "upcoming"` with real `dates` + `lockSchedule` and it goes
> live on its staging lead while the old one archives at its `dates.end` — see
> `docs/ROADMAP-MULTI-MAJOR.md`. **Seed the next Major as early as you like** —
> the off-season *anticipation window* (`ANTICIPATION_LEAD_MS` ≈ 45 days,
> PHA-1048) keeps the just-archived Major as the face of the site until the new
> one is near go-live, so a registry entry staged 5 months out doesn't blank the
> site with an empty countdown the instant the prior Major ends; the hand-over to
> the countdown happens on its own ~6 weeks before the new event. `EventConfig` now
> also carries `playoffSchedule` (sectionId → per-game ISO times, mirrors
> `COLOGNE_PLAYOFF_SCHEDULE`'s shape). **The cutover is DONE (PHA-1327).** Every call
> site that used to lean on `lock-schedule-core.ts`'s Cologne-shaped default
> parameters now resolves the active event via `currentEventId()`/`currentEvent()`/
> `getEventConfig()` and threads that event's own `lockSchedule` / `matchWindows` /
> `playoffSchedule` / `sectionNames` into `lockTimeForSection`, `isLockTimePassed`,
> `isBracketRevealed`, `playoffGameTime`, `playoffLockTime`, `isWithinRefreshWindow`,
> `isWithinAnyMatchWindow`, `playoffSectionIds` and `stageLocksFromSchedule` explicitly.
> `lock-schedule-core.ts` keeps its Cologne-default params (tests/verify scripts still
> rely on them as a safe fallback) but production call sites no longer depend on them
> falling through. Standing up the next Major is now: fill `SINGAPORE_2026`'s
> `lockSchedule` / `matchWindows` / `playoffSchedule` / `sectionNames` (see Phase 1
> below) — no code changes needed in the call sites themselves. Verify:
> `node scripts/verify-events.ts`.

> Nomenclature: a **section** is a Valve `sectionid`. For Cologne 2026 they are
> `105` Stage I · `106` Stage II · `107` Stage III · `108` QF · `109` SF · `110` GF.
> A **pickid** is Valve's per-team id *within this event* — it changes every Major.
> The Valve **event** id (in the layout, `26` for Cologne) and the **HLTV event** ids
> (`9028` / `9029`) are three different numbers — don't conflate them.

---

## Phase 0 — gather the facts (before touching code)

You need, for the new Major:

1. The **Valve tournament layout** — the master document. It lists every section, every
   group, and every team's **pickid**. Pull it the same way the app does
   (`fetchTournamentLayout` in `src/lib/valve.ts`) once Valve publishes the event, or
   capture the raw `GetTournamentLayout` JSON. This becomes `src/fixtures/<event>-layout.json`.
2. **Stage dates + first-match times** (for the lock schedule). Cross-check HLTV,
   Liquipedia, and cs.money — they agreed on 12:30 CEST opener times for Cologne.
3. The **HLTV event id(s)** and their event-page URLs (one per Swiss stage) for the
   live standings/bracket scrape.
4. The **32-team field** with HLTV team profile URLs and rough regions.

**Companion doc:** [PRE-MAJOR-CHECKLIST.md](PRE-MAJOR-CHECKLIST.md) is the focused,
tickable checklist for **gathering** these facts — HLTV event ids, the 32-team field →
pickids → HLTV ids, and the per-stage stats-refresh routine. Use it to *collect* the
inputs; use **this** doc as the *code-seam map* that says where each input gets wired in.
They're deliberately split: the checklist is the field guide, this is the wiring diagram.

---

## Phase 1 — make it work (layout + schedule)

### 1a. The layout fixture — `src/fixtures/cologne-*.json`
The master is **`cologne-layout.json`**: `result.event`, `result.sections[]`, each with
`groups[].teams[].pickid` and `picks_allowed`. The app reads this for the team pool,
the bucket structure, and the answer key. Replace it with the new event's layout.
Sibling fixtures `cologne-items.json` / `cologne-predictions.json` are the Valve item
list and a sample predictions blob — refresh them from the same capture.

> The files are named `cologne-*` today. When you re-point, either overwrite them in
> place (simplest — the code imports by path) or rename and update the imports. Don't
> leave two events' fixtures both wired in.

### 1b. Lock schedule + match windows — `src/lib/lock-schedule-core.ts`

> **PHA-1327: the cutover is done — call sites read the registry, not this file's
> defaults.** Every page/route/lib now resolves the active event (`currentEvent()` /
> `getEventConfig()`) and passes **that event's own** `lockSchedule` / `matchWindows` /
> `playoffSchedule` into `lock-schedule-core`'s functions. So re-pointing at a new Major
> is filling `SINGAPORE_2026`'s (or the next Major's) registry fields in
> `events-core.ts` — you no longer edit `COLOGNE_LOCK_SCHEDULE` et al. directly and
> expect it to flow through. The constants below stay the *pattern* to copy: either
> add a sibling `singapore-lock-schedule.ts` module with equivalent
> `SINGAPORE_LOCK_SCHEDULE` / `SINGAPORE_PLAYOFF_SCHEDULE` / `SINGAPORE_MATCH_WINDOWS`
> constants and point the registry entry's fields at them, or inline the new Major's
> schedule straight into its `EventConfig` literal in `events-core.ts` if it's small
> enough — either is fine, the registry is what matters. `lock-schedule-core.ts`'s
> exported functions keep their Cologne-shaped default parameters (verify scripts and
> tests lean on them as a safe fallback), but nothing in the live app depends on that
> fallback anymore.

Three committed constants (today, Cologne's):
- **`COLOGNE_LOCK_SCHEDULE`**: `sectionId → ISO-8601 lock instant (UTC)`. This is when each
  stage's picker freezes and picks reveal. Set the **Swiss** stages to each stage's
  **first-match** time (the playoff locks are derived — see the third constant below).
  ```ts
  105: "2026-06-02T10:30:00Z", // Stage I — Jun 2, 12:30 CEST first match
  ```
- **`COLOGNE_PLAYOFF_SCHEDULE`**: `sectionId → [game-start ISO instants]` for the playoff
  sections (108/109/110), committed from the published bracket (PHA-1007). `derivePlayoffLocks`
  folds the earliest game of each into `COLOGNE_LOCK_SCHEDULE`, so the whole bracket locks at the
  first quarterfinal. Leave it **empty** and the playoffs stay dark (bracket runs off the layout,
  not the clock); fill it and the schedule + countdown + reminders light up everywhere at once.
  **This constant's keys also define the playoff section set** (`playoffSectionIds()`), which is
  how the rest of the app knows QF/SF/GF are one bracket — so just filling it is enough; you do
  not maintain a separate playoff-id list for the reminders.

  > **Playoffs are ONE Pick'Em stage — ONE reminder (PHA-1245).** The QF/SF/GF rounds share a
  > single bracket picker that all locks together at the first quarterfinal, so the pre-lock
  > reminder job (`stageLocksFromSchedule`) **collapses every playoff section into a single
  > "Playoffs" cutoff** keyed at the earliest playoff game. A player gets one "Playoffs picks
  > lock in …" warning (24h + 1h), not one each for Quarterfinals, Semifinals and Grand Final.
  > Per-round locks still exist in `COLOGNE_LOCK_SCHEDULE` for the countdown/reveal — only the
  > reminders collapse. A future major inherits this automatically as long as its playoff rounds
  > are the keys of its per-game playoff schedule; if you rename the stage, change
  > `PLAYOFF_STAGE_NAME`. Guarded by `verify-prelock-reminders.ts`.
- **`COLOGNE_MATCH_WINDOWS`**: `sectionId → { start, end }`. The date span each stage is
  *played*. Together with the lock schedule this drives the crawl window
  (`isWithinRefreshWindow`): it **opens 24h before the stage's lock** and **closes at the
  window `end`**. So the live bracket + standings go live the day before a stage starts
  (PHA-943: "the bracket should go live 24 hours before the start of the stage"), and stop
  crawling once it's decided. **Fails open** for undated sections (revealed → keep
  refreshing), so an unset window just means "no auto-close", not "broken".

  Rename this constant if you like, but keep the param name; everything passes it
  explicitly. Run `node --experimental-strip-types scripts/verify-lock-schedule.ts`.

> **Three tables, one section id (the future-proofing rule).** For a Swiss stage's live
> bracket+standings to work, the SAME section id must appear in **`lockSchedule`** (→ when
> it reveals, `lockAt − 24h`, and when it locks), **`matchWindows`** (→ when the crawl
> stops), and **`sectionSources`** (→ the HLTV page to crawl). A missing one fails
> *silently* (e.g. a source with no lock never reveals). `validateEventRevealConfig()` in
> `events-core.ts` enforces this for **every** registered event and `verify-events.ts`
> asserts it — so a half-filled next-Major config fails loudly at CI, not live. A Swiss
> stage may legitimately have lock+window but **no source yet** (source unpublished); add
> the source when HLTV posts it and the boards fill automatically inside the 24h window.

At this point the app renders the right teams, buckets correctly, locks on schedule,
and reveals/scores against the Valve answer key. **This is the minimum viable re-point.**

---

## Phase 2 — the live boards (HLTV scrape)

### 2a. Section → HLTV event URL — `src/lib/events-core.ts` (registry)
After PHA-948, the per-section HLTV URLs live in the event registry (`events-core.ts →
EventConfig.sectionSources`), not in `swiss-results.ts` — there is no `SECTION_SOURCES`
constant anymore (removed in PHA-1046). `swiss-results.ts` resolves them per request via
its `sectionSourcesFor(eventId)` helper (`getEventConfig(eventId).sectionSources`). Add
each Swiss section's URL to the registry entry for the new event:
```ts
sectionSources: {
  105: { url: "https://www.hltv.org/events/9028/iem-cologne-major-2026-stage-1", label: "HLTV" },
  106: { url: "https://www.hltv.org/events/9029/iem-cologne-major-2026-stage-2", label: "HLTV" },
  // Stage III: if HLTV creates a dedicated sub-event, add it; if not, the hub URL
  // works (see the IEM Cologne 2026 Stage III note in events-core.ts comments).
},
```
Only map sections that have a live HLTV event up; add later stages as HLTV publishes
them. Direct fetch is **403 Cloudflare** — the app goes through `crawl4ai:11235`
(`cache_mode: BYPASS`). Map scores live in the page's `data-match-details-popup-json`,
not the markdown. Verify: `verify-swiss-results.ts`, `verify-swiss-bracket.ts`,
`verify-swiss-standings.ts`.

> **Cold-cache warming:** the standings cache is filled on-read from the gated `/picks`
> page, so a freshly deployed container starts **empty** until someone hits it inside a
> match window. After a deploy during a live stage, warm it yourself:
> `GET http://phatt-picks:3000/api/standings/refresh` (unauth-safe). It crawls
> synchronously and persists. Without this the bracket renders blank on a cold container.

### 2b. Playoff bracket
`playoff-bracket-core.ts` builds the QF/SF/GF tree from the **committed layout** and
fills it from `StageOutcome` — **no crawl**. It honestly shows `???` until Stage 3 seeds
the quarterfinals. Nothing to change per-major beyond the layout itself.

---

## Phase 3 — the polish maps (all keyed by pickid)

These make the app *look* right for the new field. All key off the new event's pickids,
so they can only be filled after Phase 1's layout lands.

| Seam | File | What it is |
|---|---|---|
| **Logos** | `src/fixtures/cologne-logos.json` | `pickid → { name, image }`. **Generated** — run `node scripts/build-logos.ts`, which resolves Steam CDN images. The manifest goes **stale when the upstream feed rotates**; if logos 404 site-wide, re-run it. |
| **Regions** | `src/lib/regions-core.ts` | `TEAM_REGIONS`: `pickid → "EU"\|"NA"\|"SA"\|"ASIA"\|"OCE"` (CIS folds into EU). Drives the region chips. |
| **Team stats** | `src/lib/team-stats-core.ts` **+ `team-stats-sources.ts`** | `TEAM_STATS` (in `-core`): `pickid → { roster, world rank, recent W-L, hltvUrl }`, a **frozen HLTV snapshot** with a `TEAM_STATS_AS_OF` date — the fallback + roster/rank base. **As of PHA-921 the `recent[]` (Last-5) auto-refreshes live** during a stage via `team-stats.ts` + the **`TEAM_SOURCES`** map in `team-stats-sources.ts` (`pickid → HLTV profile URL`), so per major you update **both** files. Roster/rank still re-gathered by hand (`scripts/gather-team-stats.ts`, `TEAM_STATS_AS_OF` bump). Powers the dossier drawer. See `PRE-MAJOR-CHECKLIST.md` §3. |
| **Challenge-coin art** | `public/coins/<event-slug>-{diamond,gold,silver,bronze}.png` | The four front faces for the Major's collectible coin (PHA-1278), keyed by the event **slug** (`coinArtSrc(slug, tier)` in `challenge-coin-core.ts`). The reverses `public/coins/_back-{tier}.png` are **shared** across Majors — don't duplicate them. Coins are pure-derived (no DB, no per-team map); the only per-major input is these four images. Without them the shelf falls back to a monogram. |

Run their verifiers: `verify-regions.ts`, `verify-team-stats.ts`, `verify-m6-logos.ts`.

---

## Phase 4 — per-stage cadence (during the event)

Once live, each stage start is a small recurring routine:

1. **Stage opens** → confirm Valve has seeded the next section's `picks_allowed` and the
   answer key resolves (the on-read outcome driver + Valve oracle handle this; watch a
   `/leaderboard` load to confirm `StageOutcome` rows appear). **Playoffs resolve headlessly**
   now — `refreshLiveResultsTick` drives `ingestOutcomes` (the Valve answer key) on every tick,
   so QF/SF/GF turn green without an owner trigger (PHA-1273). **If a winner never turns green
   while QF1/QF2 lag QF3/QF4** ("temporally backwards"), it's the **seed-swap / off-roster
   rejection class**, not the clock — the playoff bracket is dynamically seeded so the committed
   fixture roster can drift from Valve's live bracket. Trust the live field; do **not** patch the
   fixture seeds. Full mechanism + the PHA-1109 (Swiss) / PHA-1273 (playoff) history in
   `docs/GOTCHAS.md` → "Playoff (and off-roster Swiss) winners never turn green".
2. **Add the stage's HLTV URL** to `sectionSources` in the event registry entry (`events-core.ts`) if not already mapped.
3. **Warm the caches** after any deploy during the stage — `GET /api/standings/refresh`
   (standings + outcome resolve) **and** `GET /api/team-stats/refresh` (dossier Last-5).
4. **Re-gather team stats** only for **roster/world-rank** moves (`TEAM_STATS_AS_OF` bump);
   the Last-5 results auto-refresh live, so you rarely need this mid-stage.
5. **Verify the match window** covers the stage dates so the crawl actually fires.

---

## The "did I get them all?" checklist

```
[ ] events-core.ts EVENTS      → new registry entry, status:"upcoming"  (PHA-948)
                                  (no hand flip — the lifecycle lights it live, PHA-950)
[ ] cologne-layout.json        → new event's sections + pickids        (Phase 1a)
[ ] cologne-items/predictions  → refreshed from same capture           (Phase 1a)
[ ] registry lockSchedule      → each Swiss stage's first-match instant, on the new
                                  EventConfig entry, NOT edited into COLOGNE_LOCK_SCHEDULE
                                  (Phase 1b, PHA-1327)
[ ] registry playoffSchedule   → per-game playoff times (derives locks), on the new
                                  EventConfig entry                      (Phase 1b, PHA-1327)
[ ] registry matchWindows      → each stage's played date-span, on the new
                                  EventConfig entry                      (Phase 1b, PHA-1327)
[ ] sectionSources (events-core.ts registry) → HLTV event URL per Swiss stage (Phase 2a)
[ ] verify-events.ts GREEN     → reveal config consistent (lock∩window⊇source) (PHA-943)
[ ] cologne-logos.json         → re-run build-logos.ts                  (Phase 3)
[ ] TEAM_REGIONS               → pickid → region                        (Phase 3)
[ ] TEAM_STATS + AS_OF         → frozen HLTV snapshot                   (Phase 3)
[ ] TEAM_SOURCES               → pickid → HLTV profile URL (live Last-5)(Phase 3)
[ ] public/coins/<slug>-*.png  → 4 coin front faces (shared backs reused) (Phase 3)
[ ] run every scripts/verify-*.ts that touches the above
[ ] deploy → warm /api/standings/refresh inside a match window
```

If a future change adds a new per-major seam, **add a row here** and a pointer in the
code comment next to the constant. That's the contract that keeps this runbook true.
