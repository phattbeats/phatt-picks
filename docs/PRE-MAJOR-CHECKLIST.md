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

These feed two committed configs in `src/lib/lock-schedule-core.ts`:

| Config | What it drives | Fill in |
|---|---|---|
| `COLOGNE_LOCK_SCHEDULE` | the lock countdown per stage | sectionId → UTC instant of that stage's first match |
| `COLOGNE_MATCH_WINDOWS` | gates the hourly live crawls to match days | sectionId → `{ start, end }` UTC span |

Section ids map to the committed layout fixture: `105` Stage I, `106` Stage II,
`107` Stage III, `108` QF, `109` SF, `110` GF. Leave a stage **out** of these
maps until its date is authoritative — `lockTimeForSection` returns `null` (no
clock) and `isWithinMatchWindow` returns `true` (don't freeze an undated stage).

## 2. Lock the 32-team field → pickids → HLTV ids

The dossier, regions, logos and stats are all keyed by **Valve pickid**. For a
new major you need, per team: the pickid (from Valve's layout), the HLTV team id
+ url slug, and the display name.

- [ ] Pull the field + pickids from Valve's tournament layout (see
      `src/lib/layout-core.ts` / `getEffectiveLayout`).
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
- [ ] Update the `TEAM_SOURCES` map in `scripts/gather-team-stats.ts`
      (pickid → `{ hltvId, slug, name }`) — this is the field-of-record the
      gather tool crawls.
- [ ] Refresh the other pickid-keyed maps for the new field:
      `src/lib/regions-core.ts` (region per team) and the logo manifest
      (`scripts/build-logos.ts` → `public/logos/`, re-run when the feed rotates).

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

Until the runtime auto-refresh lands (tracked as a child of PHA-897), this is a
**one-command manual refresh** run at each stage transition:

- [ ] **Before Stage 2 opens** (and again before Stage 3 / playoffs): re-run the
      gather tool, verify, commit, Force Update. Each team's "Last 5 matches"
      then includes whatever they just played in the previous stage.
      ```bash
      node --experimental-strip-types --no-warnings scripts/gather-team-stats.ts --check  # preview
      node --experimental-strip-types --no-warnings scripts/gather-team-stats.ts          # write
      node --experimental-strip-types --no-warnings scripts/verify-team-stats.ts
      ```
- [ ] On the HLTV ranking update (weekly), bump `worldRank` if a team moved.

The live **Swiss standings/bracket** (PHA-902) already auto-refresh hourly on
match days via the same `COLOGNE_MATCH_WINDOWS` gate — warm them after deploy
with `GET /api/standings/refresh`. The team-stats auto-refresh (this checklist's
§4 automated) will hang off that same window gate.

## 5. Go-live config sanity pass

- [ ] `COLOGNE_LOCK_SCHEDULE` has every dated stage; playoffs filled once known.
- [ ] `COLOGNE_MATCH_WINDOWS` covers every stage that should crawl live.
- [ ] `WRITE_ENABLED`, `STEAM_API_KEY`, CAPTCHA + VAPID keys set (see
      [OPERATIONS.md](OPERATIONS.md)).
- [ ] Logos present in `public/logos/` (monograms = stale manifest → re-run
      `scripts/build-logos.ts`).
- [ ] `verify-team-stats`, `verify-lock-schedule`, `verify-regions` all green.

---

### Quick id reference — IEM Cologne 2026

| Stage | HLTV event | Section | Window (UTC) | First match |
|---|---|---|---|---|
| Stage I (Swiss) | 9028 | 105 | Jun 2–5 | 2026-06-02 10:30Z |
| Stage II (Swiss) | 9029 | 106 | Jun 6–9 | 2026-06-06 10:30Z |
| Stage III (Swiss) | _tbd_ | 107 | Jun 11– | 2026-06-11 10:30Z |
| Playoffs (QF/SF/GF) | _tbd_ | 108/109/110 | Jun 18–21 | _per-round tbd_ |

The 32 pickid → HLTV id mapping lives in `scripts/gather-team-stats.ts`
(`TEAM_SOURCES`).
