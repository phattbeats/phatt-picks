# Autopilot: how a Major runs itself

> Brandon, 2026-11-18: "it should honestly be as autonomous as possible without an
> LLM involved, once everything is set up for each state."

This is the operator's map of what HOTLINE does **on its own** during a Major,
what triggers each step, how to see that it happened, and the short list of
things a person still has to do. The code is the source of truth. This page
names the code, so check it when the two disagree.

**The rule:** once a stage's facts are committed (its lock time, match window
and HLTV page), nobody needs to touch that stage again. No agent and no cron
job outside the container are needed. Valve and HLTV supply the rest, and the
container's own timers act on it.

---

## 1. What runs, and where

Everything runs **inside the app container**, started from
`src/instrumentation.ts` at boot. A redeploy re-arms all of it. There is no
sidecar and no external cron. All of it reads the event registry
(`src/lib/events-core.ts`) every time it runs, so the live Major follows the
clock with no restart.

| Driver | Cadence | What it does | Gates (no-op when…) | Log line |
|---|---|---|---|---|
| **Live results** (`refreshLiveResultsTick`, `outcomes.ts`) | 5 min | Crawls the HLTV standings and bracket for each Swiss stage. Reads Valve's live layout, which holds both the answer key and the seeding: it caches the layout (Stage III advancers, playoff seeds, `picks_allowed`) and writes results. Bridges the HLTV Swiss records into results. Runs the stale-playoff watchdog. | The Major is frozen (archived). Every tick from 24h before a stage locks until its window `end`; **hourly before that** (PHA-5358), so opening matchups and the real first-match time land as soon as HLTV posts them. Also loads the stage-discovery overlay and, hourly, crawls linked stage pages that have no source yet (section 3a). | `[live-tick] event N: ingested …, resolved …` and `[live-tick] STALE …` |
| **Slow lane** (`ingestTeamStatsNow`, `ingestSpotlightOddsNow`, `refreshWireNow`) | hourly, first run 30s after boot | Refreshes the team dossier "Last 5" (32 HLTV profiles), the Polymarket odds for authored playoff matchups, and the HLTV news wire. | Frozen Major. Team stats skip days with no stage being played. Odds skip when no matchup is authored. | `[slow-tick] event N: team stats …, odds lines …, wire items …` |
| **Autopilot self-check** (`runAutopilotCheck`, `autopilot.ts`) | 5 min | Works out each section's phase and reports any config gap a human has to close (section 4). | The event isn't effectively live. | `[autopilot] NEEDS-HUMAN …` / `[autopilot] WARN …` |
| **Pushes** (`prelock-reminders`, `recap-pushes`, `announcement-pushes`, `coin-earned-pushes`) | 5 min | Pre-lock warnings 24h and 1h before each lock (the playoffs get **one** reminder), a "recap ready" push when a stage resolves, broadcasts, and "you earned a coin". | `PRELOCK_REMINDERS_DISABLED=1`. Each player's notification prefs. | `[prelock] …`, `[recap-push] …` |
| **PHATT ID sweep** (`syncAllToArcade`) | hourly | Replays every linked player's XP, achievements, coins and charms to the arcade. Idempotent. | `ARCADE_*` env unset. | `[arcade-sync] …` |

Page renders also start the same refreshes, deferred through `after()`.
That path is best-effort only: #1109 showed `after()` does not fire reliably in
the standalone server. The timers above are the guarantee.

**Post-deploy cache warm is automatic.** The first live tick (30s after boot)
crawls standings and resolves results. The first slow-lane run does the same for
team stats, odds and news. The `/api/*/refresh` routes remain available for an
immediate manual warm, but they're no longer a required deploy step.

---

## 2. The Major's lifecycle (event level)

Each event's status is derived from the clock and the Grand Final, never set
by hand (`event-lifecycle-core.ts`, `event-freeze.ts`).

```
upcoming ──(first lock − 7d)──▶ live ──(GF resolved + 48h, or dates.end backstop)──▶ archived
   │                              │                                                  │
   │ off-season: the site keeps   │ picker, reminders, crawls, scoring,               │ writes 409, drivers stop,
   │ showing the last Major until │ Bleachers, Wrapped                                │ reveal forced, coins on the
   │ 45 days before go-live       │                                                  │ shelf, "your Majors" history
```

| Transition | Trigger | Code |
|---|---|---|
| Site switches to the next Major | 45 days before its go-live (`ANTICIPATION_LEAD_MS`) | `selectCurrentEvent` |
| upcoming → live | 7 days before its first lock (`DEFAULT_GO_LIVE_LEAD_MS`) | `goLiveMs` |
| Coins mint | The moment the Grand Final's result lands (or `dates.end`) | `coinMintAtMs` |
| Major Wrapped opens | Once the GF crowns a champion | `stage-wrapped-launch.ts` |
| live → archived | 48h after the GF resolves (`GRAND_FINAL_ARCHIVE_GRACE_MS`); `dates.end` is only a backstop | `resolveEffectiveStatus` |

---

## 3. A stage's lifecycle (section level)

`autopilot-core.ts` (`sectionPhase`) names the phases. `GET /api/autopilot`
shows each section's current phase.

| Phase | Meaning | Entered when | What happens automatically |
|---|---|---|---|
| `dark` | No published lock time | default | No countdown, reveal or reminder. Valve still locks it on time. |
| `scheduled` | Lock time known, more than 24h out | `lockSchedule[id]` committed | Countdown, the 24h/1h reminders queued, picks open. |
| `revealed` | Within 24h of lock | `lockAt − 24h` | The HLTV crawl goes to every tick. The live bracket and standings show under the picker from here at the latest, or earlier once HLTV publishes the opening matchups (PHA-5358). |
| `live` | Locked, results arriving | `lockAt` passed **or** Valve's `picks_allowed` is false, whichever comes first | Picks freeze (HOTLINE returns 409) and reveal to everyone. Results turn green and points land within a tick. Bleachers reactions open. |
| `decided` | Every slot has a result | last result written | Recap push. The next stage's teams come from Valve's seeding. |

### 3a. Stage discovery: where a stage's dates come from (PHA-5358)

A Swiss stage's **lock, crawl window and HLTV page come from HLTV**. Nobody
commits them by hand. `stage-discovery-core.ts` reads them off the stage pages
the crawl already fetches, `StageDiscovery` rows store them, and
`mergeStageFacts` (`events-core.ts`) overlays them on the committed registry.
Every `getEventConfig` / `EVENTS` read sees the merged config.

| Fact | Read from | Rule |
|---|---|---|
| Lock (`lockSchedule[id]`) | Earliest start time of a match with both teams named, from the stage page's group table | Published beats committed. Singapore's committed Stage I `11:00Z` was HLTV's day marker; the first match is `04:00Z`. |
| Source (`sectionSources[id]`) | The "Grouped events" strip on any crawled stage page ("Stage 2", "Stage 3 & Playoffs") | Only for a Swiss section with no committed source. Added once that page lists a timed matchup. |
| Window (`matchWindows[id]`) | The page header's date span, plus one day of grace on the end | Only when none is committed. A crawl stop, never shown as a time. |

A stage whose page has no timed matchup yet (TBD slots, or matchups with no
times) **stays dark**: no lock, no countdown, no reveal. Nothing is estimated.
Check it with `docker logs phatt-picks | grep stage-discovery` (it logs each
link and each overlay change) or by reading the `StageDiscovery` table.

**Two lock signals, and Valve wins.** A stage counts as locked when either our
committed time has passed or Valve has closed it (`isStageLocked` in
`reveal-core.ts`). So a wrong or missing committed time can't leave picks
open after Valve shuts. The autopilot reports any drift between the two
(`valve-closed-early`, `valve-still-open`).

**Where results come from.**
- *Swiss:* Valve's answer key lists several correct teams per bucket, which
  can't be scored slot by slot. The HLTV bridge therefore reads final W-L
  records from the crawled stage page (`bridgeSwissOutcomes`). A Swiss stage
  with no `sectionSources` entry gets no Swiss scoring.
- *Playoffs:* Valve's answer key, one winner per match (`ingestOutcomes`). The
  watchdog logs `STALE` when a match is still unresolved 6h after its scheduled
  start.

Results are terminal. A slot is written once and never rewritten.

---

## 4. What still needs a human, and how you'll know

The autopilot can't invent a fact nobody has published. The whole remaining
human surface is a few registry edits, each gated by CI
(`verify-events.ts`) and each flagged by the self-check when it becomes urgent:

| Gap | When the self-check raises it | The edit (all in `src/lib/events-core.ts`) |
|---|---|---|
| **Next Swiss stage undated** (`undated-stage-next`, needs-human) | The previous stage has locked and this one still has no time | Normally nothing: stage discovery (section 3a) fills it the hour HLTV lists the stage's timed matchups. If the alert persists after HLTV shows them, check the `[stage-discovery]` log. The manual fallback is unchanged: add `lockSchedule[id]`, `matchWindows[id]` and `sectionSources[id]` together. |
| **Playoffs undated** (`undated-stage-next` on the QF section) | The last Swiss stage has locked and the bracket has no game times | Fill `SINGAPORE_PLAYOFF_SCHEDULE` (per-game UTC instants, bracket order). The bracket's lock, reveal and its one reminder are derived from it automatically (invariant F). |
| **Dated stage with no HLTV page** (`no-source-before-reveal`, needs-human) | Within 24h of lock with no `sectionSources[id]` | Add the HLTV stage URL. If HLTV makes no sub-event, use the hub page (Cologne's Stage III used hub 8301). |
| **Lock drift** (`valve-closed-early` / `valve-still-open`, warn) | Valve closed before our time, or was still open 45 min after it | Correct `lockSchedule[id]`. Picks are already frozen by Valve's flag either way. |
| **Spotlight odds** (`odds-unauthored`, info, optional) | The quarterfinals are seeded | Add that event's matchups to `PLAYOFF_MARKET_SLUGS_BY_EVENT[eventId]` in `spotlight-odds-core.ts`. Never re-use another event's entries: pickids collide across Majors. |
| **Roster / world-rank refresh** (not raised; optional) | Weekly HLTV ranking | `scripts/gather-team-stats.ts`, bump `TEAM_STATS_AS_OF`. "Last 5" is already live. |

**How the alert reaches you, with no agent involved:**
1. A log line, `[autopilot] NEEDS-HUMAN undated-stage-next section 113: …`.
2. A web push to the **owner's** devices (`OWNER_STEAM_ID` plus a push
   subscription on that player). It repeats every 12h while the gap persists,
   and once after every restart.
3. `GET /api/autopilot` returns JSON with the current state and findings. Point
   any uptime keyword monitor at it, matching on `"needs-human"`, to get paged
   through whatever channel that monitor uses.

**Every edit is a commit plus a deploy.** Follow the deploy rules in section 6.

---

## 5. Singapore 2026 timeline (event 27)

All times UTC, from the committed registry. Nothing below needs an agent
unless the "human" column says so.

| When | What happens on its own | Human |
|---|---|---|
| 11-17 11:00 | Major went live (first lock − 7d) | — |
| 11-22 | Stage I bracket shows under the picker (HLTV published the opening round early) | — |
| 11-23 04:00 | Stage I crawl goes to every tick | — |
| 11-23 04:00 / 11-24 03:00 | Stage I reminders (24h / 1h) | — |
| **11-24 04:00** | **Stage I locks** (HLTV's first match, 12:00 SGT; or Valve's flag, whichever is first). Results and points start landing every 5 min. | — |
| 11-27 23:59 | Stage I crawl window closes | — |
| After Stage I | HLTV draws Stage II; within the hour its lock moves to the real first match and the bracket shows | — |
| **11-28** | **Stage II locks** (committed fallback `11:00Z` is HLTV's day marker until the draw replaces it). | — |
| After Stage II | HLTV draws Stage III on hub 8302; discovery wires its source, lock and window within the hour | Only if `undated-stage-next 113` persists after HLTV lists the matches |
| Stage III lock | Locks (Valve's flag even if our time is missing). From this tick, if the bracket is undated, the self-check raises `undated-stage-next 114` | **Commit the playoff game times** |
| Dec 10–13 | QF, SF and GF resolve from Valve's answer key. The bracket locks at the first QF. | Optional: author the Polymarket matchups |
| GF result | Coins mint, Major Wrapped opens | — |
| GF + 48h | Archived: writes freeze, drivers stop, it joins "your Majors" | Post-mortem |
| 12-15 23:59 | Calendar backstop for archiving, if the GF never ingests | — |

---

## 6. Deploying during a Major

Unchanged rules, Brandon's:

1. **Tell Brandon before any vps1 redeploy.** Pushing to `main` builds the
   image (`ghcr.io/phattbeats/phatt-picks:sha-…`). It isn't live until the
   container is recreated.
2. **Keep the previous image tag as the rollback** and log both in the vps1
   pending changelog.
3. Merge locally under the phattbeats identity (CONTRIBUTING), never with the
   GitHub merge button.
4. After the deploy, check the boot log for the five `armed` lines
   (`[live-tick]`, `[slow-tick]`, `[fantasy]`, `[autopilot]`, `[prelock]`) and open
   `/api/autopilot`. A manual cache warm is optional now (section 1).

---

## 7. Checking it with no agent

```bash
curl -s https://hotline.phatt.vip/api/autopilot | jq '{status, phases: [.sections[] | {sectionId, name, phase, seeded, resolved, slots}], findings}'
docker logs phatt-picks 2>&1 | grep -E '\[(autopilot|live-tick|slow-tick)\]' | tail -20
```

`findings` empty, or only `info` entries, means there's nothing to do.

---

## 8. Known gaps (as of 2026-11-22)

Tracked on the PHA-1406 epic. Each one is code, not a missing fact.

- **Playoff rounds are still Cologne's ids.** `PLAYOFF_ROUNDS`
  (`playoff-bracket-core.ts`), `PLAYOFF_SECTION_IDS` (`write-core.ts`) and the
  seal unit (`pick-lock-core.ts`) are 108/109/110. For Singapore's 114/115/116
  the bracket picker, the one-call Steam bracket upload and the single
  playoff seal don't engage. Must land before Dec 10.
- **Major Wrapped content is Cologne's** (`COLOGNE_PLAYOFF_MOMENTS`, the
  "Cologne Major" title, `COLOGNE_PLAYOFF_TEAMS`), and the per-stage
  `stage-wrapped-content.ts` entries exist only for 105–107. Singapore needs
  its own entries, keyed by event.
- **Playoff game times are not discovered yet.** Swiss stages are (section
  3a, PHA-5358). The playoff bracket's per-game times still arrive as a
  commit to `SINGAPORE_PLAYOFF_SCHEDULE`. `undated-stage-next 114`
  says when it's due. PHA-5276: HLTV lists every playoff game with its time
  on the hub match list (`/events/8302/matches`) while the teams are still
  TBD. `playoff-schedule-core.ts` reads it into a proposed schedule
  (`node scripts/verify-playoff-schedule.ts`). It isn't wired in yet, pending
  the choice between a live overlay and an automated PR.
- **crawl4ai runs on RAID** (`CRAWL4AI_URL` over Tailscale). If the container
  stops, every HLTV crawl fails and the bracket freezes on its last cache. On
  2026-11-22 it sat in `Created` after a recreate until it was started by hand.
