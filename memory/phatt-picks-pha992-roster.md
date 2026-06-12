---
name: phatt-picks-pha992-roster
description: PHA-992 enrich team-dossier roster — positions, HLTV rating, clickable player profiles
metadata:
  type: project
---

**PHA-992** "update the roster. positions, rating" — dossier roster was bare screennames; now per-player row: clickable name→personal HLTV profile + role chip (IGL lime/AWP amber/Rifler muted) + HLTV rating (display face).

**Data model:** `team-stats-core.ts` `roster: string[]` → `RosterPlayer[] {name, position, rating:number|null, hltvUrl}`. All 32 teams / 160 players populated.
- **rating + hltvUrl SOURCED** from each HLTV team profile's "Players of X" table (team-period "Rating 3.0" col + /player/<id>/<slug> link), crawled via crawl4ai. Jimpphat (MOUZ) BENCHED on HLTV after swap but committed lineup → matched by nick, rating 1.10.
- **position HAND-CURATED** (HLTV has no structured role): conservative AWP/IGL only where established real-world role, else Rifler. AWP/IGL sets in the python gen.

**Files:** `RosterPlayer` interface + 32 rosters (core); per-player render + `.tsd-roster-key` (TeamStatsDrawer + globals.css `.tsd-player*`); shared pure parser `parseRosterStarters` + `hltvPlayerUrl` (team-stats-sources, STARTER filter + `startersOnly=false` BENCHED escape + next-heading section bound); **NEW** `scripts/gather-roster.ts` (ops tool: refresh rating/url, PRESERVE name+position verbatim — sibling of gather-team-stats); **NEW** `scripts/verify-roster-parse.ts`. gather-team-stats readExisting regex widened to capture multi-line structured roster block + emit verbatim (so results-only refresh can't flatten it). verify-team-stats extended (positions/rating-bounds/profile-link).

**Verify:** verify-all 37/37, tsc + next build clean. Visual proof via browserless (real globals.css + drawer markup) — attached to issue (att 3441c115).

**Status:** **in_review** 2026-06-09. PR #68 (`pha992-roster-positions-rating` off origin/main 6d3f110), commit `35890be` (phattbeats, NO co-author). Pending `request_confirmation` 77522d8b (wake_assignee) — Brandon review+Force-Update to go live; on accept → mark done. The one judgment call = curated positions.

**GOTCHA hit again:** harness reset HEAD onto pha991 branch + reverted ALL tracked edits mid-run (untracked new files + /tmp data survived). Recovery: `git reset --hard origin/main` on a fresh pha992 branch, re-applied edits via python patch scripts (file-state safe), committed, pushed immediately. Always re-check `git branch --show-current` before commit. See [[phatt-picks-pha987-newcomer]].
