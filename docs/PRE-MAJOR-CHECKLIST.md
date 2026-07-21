# Pre-major checklist

Everything to capture **before** a new CS major goes live on `pickems.phatt.vip`,
plus the per-stage refresh routine that keeps team stats current **during** the
event. Written for IEM Cologne 2026; reusable for the next major by swapping the
ids and dates called out below.

The guiding rule everywhere here matches the rest of the app: **never fabricate a
date or a result.** A value goes into a committed config only once it's the
published, authoritative one. Undated stages degrade gracefully (no countdown,
no false freeze) rather than showing a made-up number.

---

## 1. Identify the event on HLTV

HLTV is the source of truth for teams, rankings, results and the bracket.

- [ ] Find the event hub on <https://www.hltv.org/events>. A major is usually
      split into separate HLTV events **per stage** — note the numeric event id
      in each URL, e.g. `hltv.org/events/9028/iem-cologne-major-2026-stage-1`.
  - IEM Cologne 2026: **Stage 1 = event 9028**, Stage 2 = event 9029.
- [ ] Record the **stage dates** (first/last play day of each stage) and the
      **first-match time** of each stage's day 1. CEST is UTC+2; record in UTC.
- [ ] Record the **playoff window** and, once published, per-round day + time.

> **PHA-1327 — call sites read the registry, not these constants.** Put the new Major's schedule
> on its `EventConfig` entry in `src/lib/events-core.ts` (`lockSchedule` / `matchWindows` /
> `playoffSchedule` — inline, or via a sibling `SINGAPORE_*` module the entry points at). The
> `COLOGNE_*` constants below are the **pattern to copy** (and the test/verify fallback), not what
> the live app reads.

These are the two configs to fill (shown as Cologne's committed pattern in `src/lib/lock-schedule-core.ts`):

| Config | What it drives | Fill in |
|---|---|---|
| `lockSchedule` (Cologne: `COLOGNE_LOCK_SCHEDULE`) | the lock countdown per stage | sectionId → UTC instant of that stage's first match |
| `matchWindows` (Cologne: `COLOGNE_MATCH_WINDOWS`) | gates the hourly live crawls to match days | sectionId → `{ start, end }` UTC span |

Section ids map to the committed layout fixture: `105` Stage I, `106` Stage II,
`107` Stage III, `108` QF, `109` SF, `110` GF. Leave a stage **out** of these
maps until its date is authoritative — `lockTimeForSection` returns `null` (no
clock) and `isWithinMatchWindow` returns `true` (don't freeze an undated stage).

## 2. Lock the 32-team field → pickids → HLTV ids

The dossier, regions, logos and stats are all keyed by **Valve pickid**. For a
new major you need, per team: the pickid (from Valve's layout), the HLTV team id
+ url slug, and the display name.

- [ ] Pull the field + pickids from Valve's tournament layout (`fetchTournamentLayout`
      in `src/lib/valve.ts`; the effective in-app layout is `getEffectiveLayout` in
      `src/lib/layout-state.ts`).
- [ ] Get HLTV team ids in bulk — fastest is to crawl the event page and the
      world-ranking page and scrape `/team/{id}/{slug}` links:
      ```bash
      # via the in-network crawl4ai service
      curl -s -X POST http://crawl4ai:11235/crawl \
        -H "Authorization: Bearer Phatt-tech-2026" -H "Content-Type: application/json" \
        -d '{"urls":["https://www.hltv.org/events/<EVENT_ID>/<slug>"]}' \
        | grep -oE '/team/[0-9]+/[a-z0-9-]+' | sort -u
      ```
      Top-ranked teams that don't appear on the event page are on
      <https://www.hltv.org/ranking/teams>.
- [ ] Update the `TEAM_SOURCES` map in `src/lib/team-stats-sources.ts`
      (pickid → `{ hltvId, slug, name }`) — the single field-of-record that BOTH
      the gather tool (the by-hand snapshot) and the live runtime refresh
      (PHA-921) crawl, so they can never point at different profiles.
- [ ] Refresh the other pickid-keyed maps for the new field:
      `src/lib/regions-core.ts` (region per team) and the logo manifest
      (`scripts/build-logos.ts` → `src/fixtures/<event>-logos.json`, re-run when the
      feed rotates; `public/logos/` is only the optional manual SVG fallback).

## 3. Seed the frozen stats snapshot

- [ ] Run the gather tool to populate `src/lib/team-stats-core.ts` with each
      team's world rank context, roster and last-5 results:
      ```bash
      node --experimental-strip-types --no-warnings scripts/gather-team-stats.ts
      ```
      `worldRank` and `roster` are **preserved** across runs (HLTV's ranking
      updates weekly — bump those by hand on Mondays); the tool refreshes
      `recent[]`, `hltvUrl` and the `TEAM_STATS_AS_OF` label.
- [ ] `node --experimental-strip-types --no-warnings scripts/verify-team-stats.ts`
      → expect all green (32 teams, 1–5 matches each, valid HLTV urls).
- [ ] Commit. Deploy is a Force Update — **no `prisma db push`** for stats
      (it's committed data, not a DB table).

## 4. During the event — refresh stats at each stage boundary

> Brandon: "the matches should update for each stage, so at the beginning of
> stage 2 the stage 1 team should have refreshed stats and the stage two teams
> should have their stats."

**This is now automated (PHA-921).** The dossier's "Last 5 matches" refresh on
their own: opening the picker fires an on-read, atomic-claimed, deferred batch
crawl of all 32 HLTV profiles, gated to `COLOGNE_MATCH_WINDOWS` (only on days
games are played), persisted to `TeamStatsCache`, and merged over the committed
snapshot at read time. So at the start of Stage 2 the Stage 1 teams already show
their just-played results — no gather/commit/deploy needed mid-event. `worldRank`
and `roster` stay frozen (live crawl doesn't touch them).

- [ ] **After deploy, during a stage:** warm the cache so the first viewer
      doesn't have to — `GET /api/team-stats/refresh` (unauth-safe; off-window it
      no-ops). Same pattern as `GET /api/standings/refresh`.
- [ ] On the HLTV ranking update (weekly), bump `worldRank` (still by hand): re-run
      the gather tool + verify + commit + Force Update. The gather tool remains the
      way to refresh the **frozen fallback** (roster/rank + a baseline recent[]):
      ```bash
      node --experimental-strip-types --no-warnings scripts/gather-team-stats.ts --check  # preview
      node --experimental-strip-types --no-warnings scripts/gather-team-stats.ts          # write
      node --experimental-strip-types --no-warnings scripts/verify-team-stats.ts
      ```

The live **Swiss standings/bracket** (PHA-902) auto-refresh the same way (hourly,
match-window-gated) — warm with `GET /api/standings/refresh`. Both the team-stats
and standings caches are DB tables: a new major's deploy needs **one**
`prisma db push` (for `TeamStatsCache` + `SwissStandingsCache`); the committed
frozen snapshot is what renders until the first live crawl lands.

## 5. Go-live config sanity pass

- [ ] The event's `lockSchedule` has every dated stage; playoff per-game times go in its
      `playoffSchedule` and fold in automatically (Cologne's `COLOGNE_PLAYOFF_SCHEDULE` is the
      committed pattern, PHA-1007).
- [ ] The event's `matchWindows` covers every stage that should crawl live.
- [ ] `WRITE_ENABLED`, `STEAM_API_KEY`, CAPTCHA + VAPID keys set (see
      [OPERATIONS.md](OPERATIONS.md)).
- [ ] Logo manifest `src/fixtures/<event>-logos.json` built (monograms site-wide =
      stale manifest → re-run `scripts/build-logos.ts`); `public/logos/` is only the
      optional self-host SVG fallback.
- [ ] Challenge-coin art — drop the four front faces
      `public/coins/<event-slug>-{diamond,gold,silver,bronze}.png` (PHA-1278). The
      reverses `public/coins/_back-{tier}.png` are shared, leave them. Coins mint
      automatically the moment the Grand Final crowns a champion (`coinMintAtMs` — **not** after
      the 48h archive grace; PHA-1274) — no DB, no per-team config.
- [ ] `verify-team-stats`, `verify-team-stats-live`, `verify-lock-schedule`,
      `verify-regions` all green.
- [ ] `prisma db push` ran on the deploy (creates `TeamStatsCache` +
      `SwissStandingsCache`); warm with `GET /api/team-stats/refresh` +
      `GET /api/standings/refresh` during a match window.

---

### Quick id reference — IEM Cologne 2026

| Stage | HLTV event | Section | Window (UTC) | First match |
|---|---|---|---|---|
| Stage I (Swiss) | 9028 | 105 | Jun 2–5 | 2026-06-02 10:30Z |
| Stage II (Swiss) | 9029 | 106 | Jun 6–9 | 2026-06-06 10:30Z |
| Stage III (Swiss) | hub 8301 (no dedicated sub-event) | 107 | Jun 11–15 | 2026-06-11 10:30Z |
| Playoffs (QF/SF/GF) | n/a (bracket from layout + StageOutcome) | 108/109/110 | Jun 18–21 | QF Jun 18 13:45Z (committed, PHA-1007) |

The 32 pickid → HLTV id mapping lives in `src/lib/team-stats-sources.ts`
(`TEAM_SOURCES`); `scripts/gather-team-stats.ts` just imports it.
