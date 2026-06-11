# HOTLINE — Knowledge Base

> *"We've done a lot of good work here, and there will be more majors."*

This is the project wiki. It lives **in the repo**, as markdown, version-controlled
next to the code it describes. That is a deliberate choice — see
[Why docs live here](#why-the-docs-live-here) below.

## The map

Read these in roughly this order. Each is self-contained.

| Doc | What it answers | Read it when |
|---|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | How the whole thing fits together — data flow, the core modules, the patterns that repeat. | You're new, or you're about to change how picks / scoring / brackets work. |
| **[NEXT-MAJOR.md](NEXT-MAJOR.md)** | The runbook to re-point the app at a *new* Major (the one that matters most for "more majors"). The code-seam map: every constant/fixture that changes per-event, in order, with a checklist. | A new Major is announced and you need to stand it up. |
| **[PRE-MAJOR-CHECKLIST.md](PRE-MAJOR-CHECKLIST.md)** | The field guide that *pairs* with NEXT-MAJOR: a tickable checklist for gathering the inputs — HLTV event ids, the 32-team field → pickids, and the per-stage stats-refresh routine. | You're collecting the facts for a new event before wiring them in. |
| **[OPERATIONS.md](OPERATIONS.md)** | Every env var, every HTTP route, one-time setup, smoke checks. The ops reference. | You're deploying, flipping a flag, or debugging a 500. |
| **[GOTCHAS.md](GOTCHAS.md)** | Hard-won lessons. The bugs that cost hours, why they happened, and the rule that prevents the repeat. | Something is behaving strangely, or you're touching iOS / crawl4ai / browserless / deploy / the shared checkout. |

## What this app is, in three sentences

A CS2 Major **Pick'Em companion** for a small private group. Members log in with
Steam (or play locally — no Steam needed), set their picks per stage, optionally
mirror them up to Valve, and compete on a shared leaderboard scored on Valve's own
weighting. Built **generically** so it can be re-pointed at the next Major by
editing a handful of committed config seams.

Live target as of this writing: **IEM Cologne 2026** (June 2–21).

## Why the docs live here

The knowledge this project has accumulated lived in three fragile places:

1. **Agent memory** — per-agent, not shared, invisible to humans.
2. **Commit messages** — searchable but scattered; nobody reads 60 commits to learn the system.
3. **Brandon's head** — the single point of failure this issue (PHA-922) exists to fix.

A markdown wiki in `docs/` fixes all three at once:

- **It survives container rebuilds.** It's in git, not in a database or a Notion that
  needs a subscription and a login.
- **It's readable by humans *and* by the next agent.** Whoever picks up the next Major —
  person or model — gets the same map.
- **It versions with the code.** When a module changes, the doc that describes it changes
  in the same PR. No drift between a wiki tab and reality.
- **Zero new infrastructure.** No wiki server to host, patch, or lose. `git clone` *is* the backup.

The alternative formats (Notion, Confluence, a hosted wiki) all add a service that can
go down, get abandoned, or fall out of sync with the code. For a single-container app
maintained by a small group, in-repo markdown is the format that *lasts*. That is the
recommendation, and this directory is it.

## Keeping it alive

The wiki is only worth building if it stays true. The rule:

> **If a PR changes a per-major seam, an architectural pattern, or burns you with a
> gotcha worth remembering — update the relevant doc in the same PR.**

Specifically:
- New env var or route → **OPERATIONS.md**
- New core module, or a change to how data flows → **ARCHITECTURE.md**
- A constant that will change for the next event → **NEXT-MAJOR.md** (and link it from the code comment)
- A bug that cost you real time → **GOTCHAS.md**

Stale docs are worse than no docs. Treat an out-of-date entry as a bug.
