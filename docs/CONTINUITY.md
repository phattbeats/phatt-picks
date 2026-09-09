# Continuity — if the maintainer is unavailable

*Written for the "hit by a bus" case: someone with no prior context — human or LLM
— needs to keep HOTLINE running, or stand up a fresh copy, without asking Brandon
anything. Read this first; it tells you which of the other docs you actually need
and, just as important, what this repo deliberately does **not** tell you.*

---

## 1. The one-paragraph version

Everything required to **build, deploy, and operate** HOTLINE is public and in
this repo: the code, the Docker image, the CI pipeline that publishes it, and the
full operator's manual ([ADMIN-GUIDE.md](ADMIN-GUIDE.md)). None of that requires
anything from Brandon personally. What *does* require Brandon (or whoever he's
delegated to) is **continuing the exact live instance** at `pickems.phatt.vip` —
that needs access to his home server and his domain, which are intentionally
**not** documented here (see §3). If you don't have that access, §2 tells you how
to stand up your own instance instead.

## 2. Two different goals — pick the one you actually have

### 2a. "Keep the same game going" (same players, same history, same URL)
You need someone's access to:
- The Unraid box the container runs on (to redeploy, or to pull the `/data`
  SQLite file for a backup/migration).
- The `phatt.vip` DNS / domain registration (to keep `pickems.phatt.vip` resolving,
  or to repoint it at a new host).

If you have both, follow [ADMIN-GUIDE.md §6](ADMIN-GUIDE.md#6-deploying--updating-the-maintainers-setup)
— it's the exact worked example for this instance. If you only have the SQLite
file and a new box, follow §2b below and copy that file into the new container's
`/data` volume before first boot instead of letting it self-create an empty one.

### 2b. "Stand up a fresh instance" (new URL, new database, same app)
This needs **nothing** from Brandon. Anyone with the public repo (or the public
`ghcr.io/phattbeats/phatt-picks` image) and a Docker host can do this today:
[ADMIN-GUIDE.md §5 — Run it yourself](ADMIN-GUIDE.md#5-run-it-yourself--deploy-on-your-own-hardware).
It's the same self-contained `docker-compose.selfhost.yml` path, no Unraid or SWAG
assumptions. The trade-off: player accounts, past picks, scores, and Challenge
Coins from the original instance don't come with it — it's a new group history,
not a migration. (For an actual migration, see 2a — the SQLite file *is* the
history, so carrying it over is what makes it a continuation instead of a restart.)

## 3. What's deliberately absent from this repo, and why

This repo is public, so it never carries: the Unraid login, the `phatt.vip`
registrar/DNS account, GitHub org ownership, or any of Brandon's personal
credentials. That's not a documentation gap to fill in-repo — putting real
account access in version control would be a bigger risk than the bus-factor
problem it'd solve. If you're reading this *because* Brandon is genuinely
unreachable and you need one of those specifically, that access has to come
through however he arranges succession outside of GitHub (password manager
emergency access, a note with next-of-kin, etc.) — that's a personal
estate-planning question, not something this repo can solve. Everything this repo
*can* hand you without that step is in §2b.

## 4. The single biggest real risk: there is no off-box backup today

Read that literally — as of this writing, nothing automatically copies the
SQLite database (`/data/phatt-picks.db`, every player/pick/score/coin the app has
ever recorded) anywhere off the one Unraid box it runs on. [ADMIN-GUIDE.md §9](ADMIN-GUIDE.md#9-routine-operations)
documents how to make a manual copy, but nothing does it on a schedule. If that
box is lost before anyone copies the file off it, the entire season's data goes
with it — the code and docs survive (they're in GitHub), but the game history
does not. If you're picking up maintenance of this project, standing up a
scheduled off-box copy of that one file is the highest-leverage single thing you
can add that isn't already done.

## 5. What an LLM (or a human with zero context) should read, in order

1. This doc, to know what you're actually being asked to do.
2. [ADMIN-GUIDE.md](ADMIN-GUIDE.md) top to bottom — the operator's manual: what
   HOTLINE needs, how it's wired, and (§5/§6) exactly how to deploy it either
   fresh or as this specific instance.
3. [OPERATIONS.md](OPERATIONS.md) as the exhaustive reference once you're
   actually configuring something (every env var, every route).
4. [GOTCHAS.md](GOTCHAS.md) before you touch live data or debug something that
   looks broken — most "obviously broken" symptoms here have already been
   diagnosed once and have a documented, non-obvious cause.
5. [NEXT-MAJOR.md](NEXT-MAJOR.md) + [PRE-MAJOR-CHECKLIST.md](PRE-MAJOR-CHECKLIST.md)
   only when a new CS2 Major needs to be stood up — not needed for routine
   operation of an already-live event.

None of this requires access to Brandon's Paperclip agent org, Signal, or any
other tooling he personally uses to *work on* this project day to day — those are
his workflow, not a runtime dependency of the app itself. The app is one Docker
container; anyone who can run Docker and read markdown can operate it.
