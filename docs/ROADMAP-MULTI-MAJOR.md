# Roadmap — self-sustaining, every-major, with history

> The vision (Brandon, 2026-06-06): *"self-sustaining looking forward pass. we need to
> get this ready for every major. historic scores, so you can look back at your picks
> throughout every major."*

This is the plan to take HOTLINE from "a great app pointed at IEM Cologne 2026" to **a
durable platform that runs itself across every Major and keeps your history forever.**
It's deliberately grounded in what already exists — this is an *evolution*, not a rewrite.

## The good news: the foundation is already here

- **The data model is event-scoped from day one.** `Pick`, `StageOutcome`, `RankSnapshot`,
  `SwissStandingsCache`, `TeamStatsCache`, `LayoutCache` all carry `eventId` in their keys
  (`Pick.eventId` is literally commented *"always keyed — multi-event from day one"*). So
  **picks and scores for many Majors already co-exist in one database** — nothing is
  overwritten between events. "Historic scores" is therefore mostly a *read + UI* problem,
  not a migration.
- **Much of "self-sustaining" already runs:** on-read refresh drivers (outcomes / standings /
  team-stats) with atomic claims + `after()`, the schema self-pushes on boot, the pre-lock
  reminder scheduler (PHA-929), and the Stage-3 source watcher (PHA-926). The app needs no LLM
  at runtime (see ARCHITECTURE → "Does HOTLINE need an LLM / agent?").

## What's missing (the gaps to close)

1. **No "active event" — `EVENT_ID = 26` is hardcoded in ~15 files** (every page + every API
   route) and the per-Major config is Cologne-specific singletons (`COLOGNE_LOCK_SCHEDULE`,
   `cologne-layout.json`, `SECTION_SOURCES`, `TEAM_*`, …) spread across ~10 modules. Adding the
   next Major today means hand-editing all of that. There is no single source of truth for
   "which event is live."
2. **No archive / history surface.** Past-event data exists in the DB but nothing lets a user
   *see* it — the leaderboard, compare, and profile all implicitly render "event 26." There's
   no event switcher and no "your picks across every Major" view.
3. **No event lifecycle.** Nothing transitions an event `upcoming → live → archived`; a human
   decides when a Major is "over." Truly self-sustaining means the app does this itself.

## The plan — three workstreams

### A. Event registry & "active event" *(the backbone — unblocks B and C)*
Replace the 16 hardcoded `EVENT_ID = 26` and the `COLOGNE_*` singletons with **one committed
registry**:

```
EVENTS = {
  26: { slug, name, status: 'upcoming'|'live'|'archived',
        layoutFixture, lockSchedule, matchWindows, sectionSources, teamMaps, dates },
  …   // the next Major is one more entry
}
resolveActiveEvent()   // the single source of truth pages/routes call instead of `= 26`
getEventConfig(id)     // per-event lock schedule / sources / maps
```

Adding a Major becomes: **drop in one registry entry + flip `status` to `live`.** This is the
turnkey "ready for every Major" piece, and it's mostly mechanical — the data layer already
takes `eventId`, so this is plumbing the *active id* + per-event config, not changing storage.
Keep the per-Major seam files (NEXT-MAJOR runbook) but index them by event in the registry.

### B. Historic scores & "look back" *(the headline feature)*
With the registry's `status` field, archived events are read-only views over data that's
already persisted:
- An **event switcher** on `/leaderboard`, `/leaderboard/compare`, and `/players/[id]`.
- A **"your Majors" history** view — every event you played, your picks, your score, your
  finish — so you can look back across all of them.
- **Freeze archived events:** no writes (`picks` 409), no crawls (drivers skip non-live), reveal
  always on. Mostly read + UI because the rows are already there.

### C. Self-sustaining event lifecycle
- Auto-transition `upcoming → live` (first lock approaches) and `live → archived` (the Grand
  Final resolves) so no human flips a switch.
- Make the watchers/reminders/drivers **registry-driven** (iterate live events, not a constant).
- The next Major's config can even be staged as `upcoming` and goes live on schedule.

**Dependencies:** A is the foundation; B and C both build on the registry. Suggested order:
A → (B ∥ C).

## The one decision that gates *when*, not *what*

The registry refactor touches ~15 files + core config **while Cologne is live** (Stage III Jun 11,
playoffs Jun 18–21). Two safe options:
- **Stage it:** land the registry groundwork now behind the current behavior (active event still
  resolves to 26), but **hold the cutover + history UI until after Cologne's Grand Final** — zero
  risk to the live event, and Cologne becomes the first archived Major the day it ends.
- **Build now:** do it all immediately, accepting more regression surface during a live tournament.

Recommendation: **stage it** — groundwork now, cutover + history right after the Grand Final, so
Cologne is the first entry in "look back at your picks throughout every Major."

## Tracking
Workstreams A/B/C are tracked as child issues of PHA-922 (see the issue thread). This doc is their
shared spec; keep it updated as they land.
