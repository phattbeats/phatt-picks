# Multi-Major roadmap

How HOTLINE goes from a one-Major app to one that runs itself across every CS2
Major, season after season, with nobody flipping switches. This is the **spec**;
`NEXT-MAJOR.md` is the mechanical re-point **runbook** and `PRE-MAJOR-CHECKLIST.md`
is the go-live checklist. Read this for the *why* and the *shape*; read those two
for the *what to edit*.

The work is split into three workstreams. A is the backbone; B and C build on it.

| Workstream | Issue | What it does | State |
|---|---|---|---|
| **A** — Event registry | PHA-948 | One committed index of events (`src/lib/events-core.ts`), each with a `status` field; every page/route reads `ACTIVE_EVENT_ID` instead of a hardcoded `26`. | **Merged.** |
| **B** — Your Majors / history | PHA-949 | Per-event historic scores + a "your Majors" surface; archived events freeze (picks closed, reveal always on). | See PHA-949. |
| **C** — Self-sustaining lifecycle | PHA-950 | Derive an event's *effective* status from the clock so it auto-transitions `upcoming → live → archived`; drivers/watchers/reminders iterate the registry's live events, not a constant. | This doc. |

---

## A — the registry (backbone)

`EVENTS[eventId] → EventConfig { slug, name, status, dates, lockSchedule,
matchWindows, sectionSources, sectionNames, fixtures, teamMaps }`.

- **`status`**: `"upcoming" | "live" | "archived"` — the *baseline / staged intent*
  of a Major (see C for how the clock advances it).
- **`resolveActiveEvent()` / `ACTIVE_EVENT_ID` / `getEventConfig(id)`** — the single
  source of truth for "which Major are we serving." ~15 pages and routes read
  `ACTIVE_EVENT_ID`, so the active event is decided in one place.

The registry currently *references* the committed `COLOGNE_*` constants
(`lockSchedule`, `matchWindows`, `sectionNames`) rather than owning their bytes.
Inverting that — making the domain modules read the active event's config by
default instead of their own `COLOGNE_*` constant — is the **cutover** (PHA-952),
deliberately deferred until after Cologne's Grand Final so we don't destabilise a
live event. Verify: `node scripts/verify-events.ts`.

---

## C — self-sustaining lifecycle

**Goal: no human flips a switch.** A Major staged as `upcoming` goes live on
schedule; a live Major archives when it's over — without anyone editing the
registry's `status` field the morning of.

### How the clock drives status — `src/lib/event-lifecycle-core.ts`

A pure leaf module (no registry import, no `Date.now()` — every entry point takes
`nowMs`) that derives an event's **effective** status from its baseline + the
wall clock:

- **`resolveEffectiveStatus(event, nowMs, opts)`**
  - `upcoming → live` once `nowMs` reaches the event's **go-live instant**: the
    earlier of `dates.start` and `firstLock − DEFAULT_GO_LIVE_LEAD_MS` (7-day
    staging runway, so the picker/countdown open before the first match).
  - `live → archived` once the **Grand Final resolves** (an injected
    `grandFinalResolved` signal — the precise trigger) **or** `nowMs` passes
    `dates.end` (the safety ceiling that needs no outcome data).
  - **Monotonic clamp**: the clock can only push an event *forward* on the
    `upcoming < live < archived` line, never back. An `archived` baseline is
    terminal (a retired Major is never resurrected); a `live` baseline is never
    demoted to `upcoming`. The baseline is the floor; the clock raises it.
- **`selectLiveEvents(events, nowMs, optsFor)`** — the events that are effectively
  live now. **What the drivers iterate** instead of a single hardcoded id.
  Normally length 1; 0 between Majors; briefly >1 across an overlap.
- **`selectCurrentEvent(events, nowMs, optsFor)`** — the one event the picker/pages
  should show, robust across gaps: live › soonest-upcoming › most-recently-
  archived, so the off-season shows the last Major rather than a blank site.

Verify: `node scripts/verify-event-lifecycle.ts` (incl. the proof that *Cologne
today still derives `live`* — C lands behind current behaviour).

### How the registry uses it — `src/lib/events-core.ts`

`resolveActiveEvent()`, `ACTIVE_EVENT_ID` and `SECTION_SOURCES` are now
**clock-derived** (via `selectCurrentEvent`), plus three accessors for callers
that need a live answer at call time rather than module-load time:

- `liveEvents(nowMs)` — the effectively-live events (drivers iterate this).
- `currentEvent(nowMs)` / `currentEventId(nowMs)` — the single event to serve.

Two halves of "self-sustaining":

1. **Boot-time** — `ACTIVE_EVENT_ID` / `SECTION_SOURCES` resolve once at module
   load, so a deploy/restart inside the next Major's window auto-serves it. (The
   app already transitions across Majors on a deploy; this just removes the manual
   `status` edit that used to gate it.)
2. **In-process** — long-running drivers re-evaluate by calling
   `liveEvents(now)` / `currentEventId(now)` each tick, so they follow the
   calendar without a restart.

### Registry-driven drivers

The on-read drivers / watchers / reminders iterate `liveEvents(now)` and read each
live event's **own** config from the registry, so they follow the Major with no
re-pointing:

- **`src/lib/prelock-reminders.ts`** — `reminderTargets(now)` iterates
  `liveEvents(now)` and fires each event's reminders off its own committed
  `lockSchedule` / `sectionNames`. (Operator escape hatches preserved:
  `STAGE_LOCKS_JSON` for out-of-band cutoffs, `EVENT_ID` to pin one event.)
- Standings + team-stats crawls already read the active event's
  `sectionSources` / windows via the registry (A). They gate on match windows, so
  they idle automatically off-season; pointing them at `liveEvents(now)` for true
  multi-event overlap is a thin follow-up (single live event today).

### Staging the next Major

When the next Major's details are known, add a registry entry with
`status: "upcoming"`, its real `dates` and `lockSchedule`, and the per-fixture
swaps from `NEXT-MAJOR.md`. Then **do nothing on go-live day** — it flips to live
on its staging lead and Cologne archives at its `dates.end`. To go live earlier or
later, adjust that entry's `dates.start` / `lockSchedule`, not a status flag.

### Known follow-ups

- **GF-resolve fast-path**: the `grandFinalResolved` trigger is wired into the
  lifecycle core and proven, but no live caller injects it yet — archive currently
  fires on the `dates.end` ceiling. Feeding the Grand Final's resolved StageOutcome
  into `currentEvent` / `liveEvents` (an impure driver-layer helper) makes archive
  precise. Low risk to defer; the ceiling already removes the human.
- **Cutover (PHA-952)**: invert the `COLOGNE_*` domain-module defaults to read the
  active event's config. Gated post-Cologne-GF.
- **Multi-event drivers**: the standings/team-stats crawls iterate a single active
  event today; switch them to `liveEvents(now)` if two Majors ever overlap.
