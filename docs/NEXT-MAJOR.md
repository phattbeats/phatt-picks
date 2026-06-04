# Re-pointing at the next Major

This is the runbook. The app is built generically; standing up a new Major is
**editing committed config**, not writing new features. Every seam below is a file
you change, in roughly the order events happen in time.

If you do nothing else, do **Phase 1** (layout + schedule) — that's what makes the
app *work* for the new event. The rest sharpens it.

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
   (`fetchTournamentLayout` in `src/lib/layout.ts`) once Valve publishes the event, or
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
Two committed constants:
- **`COLOGNE_LOCK_SCHEDULE`**: `sectionId → ISO-8601 lock instant (UTC)`. This is when each
  stage's picker freezes and picks reveal. Set it to each stage's **first-match** time.
  ```ts
  105: "2026-06-02T10:30:00Z", // Stage I — Jun 2, 12:30 CEST first match
  ```
  Playoff sections (108/109/110) are intentionally left **dark** (no entry) — their
  per-round times are TBD; the bracket runs off the layout, not the clock.
- **`COLOGNE_MATCH_WINDOWS`**: `sectionId → { start, end }`. The date span each stage is
  *played*. The HLTV crawl only fires inside a window (`isWithinMatchWindow`), so the app
  stays idle on off-days. **Fails open** for undated sections (better to refresh than to
  go dark), so an unset window just means "always allowed", not "broken".

  Rename this constant if you like, but keep the param name; everything passes it
  explicitly. Run `node --experimental-strip-types scripts/verify-lock-schedule.ts`.

At this point the app renders the right teams, buckets correctly, locks on schedule,
and reveals/scores against the Valve answer key. **This is the minimum viable re-point.**

---

## Phase 2 — the live boards (HLTV scrape)

### 2a. Section → HLTV event URL — `src/lib/swiss-results.ts`
`SECTION_SOURCES` maps each Swiss section to its **HLTV event page**:
```ts
105: { url: "https://www.hltv.org/events/9028/iem-cologne-major-2026-stage-1", label: "..." },
106: { url: "https://www.hltv.org/events/9029/iem-cologne-major-2026-stage-2", label: "..." },
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
| **Team stats** | `src/lib/team-stats-core.ts` | `TEAM_STATS`: `pickid → { roster, world rank, recent W-L, hltvUrl }`, a **frozen HLTV snapshot** with a `TEAM_STATS_AS_OF` date. Re-gather per stage as rosters/ranks move (gather tooling if present, else crawl4ai the HLTV profiles). Powers the team dossier drawer. |

Run their verifiers: `verify-regions.ts`, `verify-team-stats.ts`, `verify-m6-logos.ts`.

---

## Phase 4 — per-stage cadence (during the event)

Once live, each stage start is a small recurring routine:

1. **Stage opens** → confirm Valve has seeded the next section's `picks_allowed` and the
   answer key resolves (the on-read outcome driver + Valve oracle handle this; watch a
   `/leaderboard` load to confirm `StageOutcome` rows appear).
2. **Add the stage's HLTV URL** to `SECTION_SOURCES` if not already mapped.
3. **Warm the standings cache** after any deploy during the stage (Phase 2a note).
4. **Re-gather team stats** if you want fresh ranks (`TEAM_STATS_AS_OF` bump).
5. **Verify the match window** covers the stage dates so the crawl actually fires.

---

## The "did I get them all?" checklist

```
[ ] cologne-layout.json        → new event's sections + pickids        (Phase 1a)
[ ] cologne-items/predictions  → refreshed from same capture           (Phase 1a)
[ ] COLOGNE_LOCK_SCHEDULE      → each stage's first-match instant       (Phase 1b)
[ ] COLOGNE_MATCH_WINDOWS      → each stage's played date-span          (Phase 1b)
[ ] SECTION_SOURCES            → HLTV event URL per Swiss stage          (Phase 2a)
[ ] cologne-logos.json         → re-run build-logos.ts                  (Phase 3)
[ ] TEAM_REGIONS               → pickid → region                        (Phase 3)
[ ] TEAM_STATS + AS_OF         → frozen HLTV snapshot                   (Phase 3)
[ ] run every scripts/verify-*.ts that touches the above
[ ] deploy → warm /api/standings/refresh inside a match window
```

If a future change adds a new per-major seam, **add a row here** and a pointer in the
code comment next to the constant. That's the contract that keeps this runbook true.
