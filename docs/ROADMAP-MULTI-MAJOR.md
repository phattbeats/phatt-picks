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

## What was missing (now closed)

*Updated 2026-06-12 — all three workstreams shipped during Cologne 2026.*

1. ~~**No "active event" — `EVENT_ID = 26` hardcoded in ~15 files.**~~ **Done — PHA-948.**
   `src/lib/events-core.ts` is the committed registry: `EVENTS[id]`, `resolveActiveEvent()`,
   `getEventConfig(id)`, `ACTIVE_EVENT_ID`. The singleton `COLOGNE_*` constants remain in
   their files but are referenced by the registry, not scattered. Adding the next Major is a
   new registry entry.
2. ~~**No archive / history surface.**~~ **Done — PHA-949.** `/majors` route shows "Your Majors" —
   every event you played, your score, your finish, linked into that event's full profile.
   Data was already persisted per `eventId`; this was a read + UI problem.
3. ~~**No event lifecycle.**~~ **Done — PHA-950 + PHA-954.** Clock-derived
   `upcoming → live → archived` transitions run from the event registry dates + the Grand
   Final resolve signal. Archive fires at `grandFinalResolvedAt + 48h` grace (PHA-954 safety
   net). Drivers skip non-live events; reminders/watchers iterate from the registry.

**Remaining — PHA-952 (cutover):** the full inversion of domain-module defaults — so every
page/API reads `getEventConfig(ACTIVE_EVENT_ID)` instead of its local `COLOGNE_*` constant.
Deliberately deferred until after Cologne's Grand Final (Jun 21). That cutover makes adding the
next Major truly turnkey: drop in a registry entry and all surfaces update automatically.
Cologne becomes event #1 in the archive the moment it ends.

## The plan — three workstreams

### A. Event registry & "active event" — **DONE (PHA-948)**
The registry (`events-core.ts`) is the single source of truth. `resolveActiveEvent()` /
`getEventConfig(id)` / `ACTIVE_EVENT_ID` replace the old hardcoded `= 26`. Adding a Major is
one new registry entry. Full domain-module cutover deferred to PHA-952 post-GF.

### B. Historic scores & "look back" — **DONE (PHA-949)**
`/majors` route: every event you played, your score and finish, linked into its full profile.
Read view over already-persisted `eventId`-scoped rows — no schema change, no crawl.

### C. Self-sustaining event lifecycle — **DONE (PHA-950 + PHA-954)**
Clock-derived status transitions, registry-driven drivers/reminders, 48h GF grace arc.
The running app handles `upcoming → live → archived` without any human flip.

**Dependencies:** A → (B ∥ C). All three shipped; remaining work is the PHA-952 cutover.

## Tracking
PHA-948/949/950/952/954 are the child issues. This doc is their shared spec.
