# phaTT Picks: Project Narrative

*A record of how a private CS2 Major Pick'Em companion app got designed, de-risked, built, and code-reviewed across several sessions in May 2026. Written for Brandon's records, to be kept once the project ships. Brandon's words are quoted verbatim throughout, typos and all, because the texture is the point. Written to stand alone: a reader who has never seen the project should be able to follow all of it from here.*

---

## What this is, and what you need to know to read it

**The game.** *Counter-Strike 2* (CS2) is Valve's competitive shooter. A few times a year there's a **Major**, the biggest tournament on the calendar, 32 teams over about three weeks. **IEM Cologne 2026** (June 2 to 21) is the one this project targets.

**Pick'Em.** Valve runs an official prediction game alongside each Major called the **Pick'Em Challenge**: you predict which teams advance and who wins, you earn points for correct calls, and if you do well enough you unlock a cosmetic in-game trophy, the **coin** (Bronze through Diamond). To play, you buy a **Viewer Pass** (roughly $10, per Major). The tournament runs in stages: three **Swiss** stages (a format where teams play until they rack up three wins or three losses), then a single-elimination **playoff** bracket, Quarterfinals (QF), Semifinals (SF), Grand Final (GF). Brandon's wife Emily and a friend group of five to twenty play every Major; the social ritual of comparing picks and trash-talking the leaderboard is the whole appeal.

**The app.** "phaTT Picks" is a private companion app for that friend group. It lets each person log in with their Steam account, set or mirror their official Valve picks through Steam's API, and compete on one shared leaderboard scored exactly the way Valve scores it. It also supports a **local player** mode for anyone who hasn't bought the Viewer Pass or doesn't want to connect Steam, they still get a board slot, just without the official sync. It is mobile-first, runs as a single web app, and is built generically so it can be re-pointed at every future Major. It deploys at `pickems.phatt.vip` on Brandon's home server (an Unraid box, behind a reverse proxy called SWAG).

**The cast of "agents."** Three distinct AI roles show up in this story, and keeping them straight matters:
- **The planning partner** (the AI whose voice narrates and is quoted as "the response" or "the assistant"): the one Brandon did the research, design critique, and code review with. It cannot reach his local network, so it plans and verifies rather than deploys.
- **The design agent** ("Claude Design"): a separate workspace that produced the ~15 to 21 visual screens of the app as HTML.
- **The coding agent** (Brandon's own automated dev setup, which he calls "Paperclip"): runs on his hardware with full network access, took the final spec, and actually built and shipped the app.

**A few technical terms used below**, in plain language:
- **itemid:** the long numeric ID Steam assigns each pickable team, e.g. `17293822569790899385`. These are big enough to break naive number handling (see "bigint trap").
- **bigint trap:** those IDs exceed the largest integer JavaScript can hold exactly, so the ordinary `JSON.parse` silently rounds the last digits to zero. The value still *looks* like a number, it's just wrong. The fix is to carry the IDs as text strings everywhere, never as numbers.
- **layout / `points_per_pick`:** Steam's API hands back a "layout" describing the tournament structure and how many points each correct pick is worth. The app reads its scoring from that layout instead of hardcoding numbers, so it adapts to any Major automatically.
- **`picks_allowed`:** a flag on each stage meaning "this stage is still open for editing." Once a stage locks, this goes false. Two of the project's worst bugs hinged on it.
- **the probe:** a small one-off script Brandon ran against the live Steam API to answer the project's open questions with real data instead of guesses.
- **fixture:** a saved copy of real API output, used to test the app offline without hitting Steam every time.

With that, the story.

---

## How it started

It started with a small loss. The very first message of the whole thing was Brandon checking whether something he'd already made still existed:

> "did my CS2 major pickems html surivve in our chat history or files anywehre>?"

It hadn't. A search turned up an old match guide and an esports dashboard, but no Pick'Em. And the reaction to that loss is the actual origin of the project, not regret but a decision:

> "thats alright. it was not great anyway. but.... the next major approaches. and with it, a way for me to build something fun for my friends and emily. she loves the pickems.
>
> we're going to do it right. not shooting from the hip and trying to make things up."

That second paragraph set the tone for everything that followed. The throwaway HTML wasn't worth mourning; the *next* one would be built properly. And the first message also laid out, unprompted, the entire shape of the thing, the stack, the goal, the data, and the working method:

> "stack:
> unraid / docker
> steam has an API specificaly for cs pickems.
> willing to build whatever scraper / data pipeline we need. i have browserless, crawl4api, flaresolverr.
>
> goal:
> build a cologne 2026 companion app (templateable for all future major)
> open the 'app' or website idk yet which, i want to be able to hand this to all firends. mobiel and dektop
> set / update your pickems officially (using steam API, many sites already do this)
> small scale, community based. you wil be able to see all info about all users.
> leaderboard (same as in gtame)
> compare your pickems with other users of the app
> read HLTV news udpates
> get live match stats
>
> data it needs:
> match data, pickems data, team data, news
>
> start off with questions, then do a turn of deep reserach, then we build the plan."

(HLTV is the main CS news and stats site; browserless, crawl4ai, and flaresolverr are scraping tools on Brandon's server for getting at sites that block bots.) Almost every load-bearing decision the project eventually made was latent in that message: templateable-for-all-future-Majors, hand-it-to-friends, set picks *officially* via the Steam API, one shared leaderboard mirroring the in-game one, pick comparison, and a deliberate "questions, then research, then plan" cadence that he'd hold the planning partner to for the rest of the project. The "she loves the pickems" is Emily, and she stays load-bearing the whole way through.

The first round of clarifying questions came back, and Brandon's answers were fast and opinionated:

> "1. honestly not a problem. every major valve allows yo to expose an api key. do reseracah on this.
> 2. steam auth for all, unless i cant build it for free
> 3. replicate all stages exactly. many sites do this.
> 4. scale + liveness: realstic? 5 users. hopeful? 20. and i dont think 30 seconds is necessary. maybe 5 minutes. or maybe certain sources every 30s, and some every hour. how do others use it?
> 5. news - you already hit it. hltv is so hard to access. but they aggregate everything."

That's the brief. Five to twenty users, replicate every stage exactly, Steam login for everyone if it can be built for free, and a healthy "do research on this" aimed straight at the planning partner's skepticism. Which is where the real work began.

---

## Act I: The skepticism that lost (the right way)

The biggest unknown was whether you could *write* picks back to Steam at all, or only read them. The planning partner assumed read-only and started architecting around a deferred "do it later" path for writing. Brandon, in answer #1 above, had already called that doubt unnecessary: *"honestly not a problem… do reseracah on this."*

The research came back and the skepticism folded, cleanly, on evidence:

> "Right. You may have just defeated my skepticism, which is the good kind of being wrong. … I was wrong, and you were right. The write endpoint exists and is documented: `ICSGOTournaments_730/UploadTournamentPredictions/v1`. That changes the project."

(That endpoint name is the specific Steam API call that submits picks; the point is simply that it exists and is usable.) **Win:** the central feasibility question got answered by going to the source instead of arguing from priors. **Tone decision that paid off:** "you were right" stated plainly as a finding, not softened or buried.

A small but telling correction landed here. The planning partner had justified the local-player mode (play without connecting Steam) by imagining Emily as a casual who didn't own Steam's Prime status. Brandon shut that down with affection:

> "emily has prime dawg i wouldnt leave her hanging like that"

The retraction was immediate:

> "Noted, and corrected, my bad. I had Emily pegged as a casual when she's apparently been holding Prime the whole time. Retracting that."

And then, the important part, the feature *survived on a better argument*. Brandon insisted on it directly:

> "keep the 'local player' exactly right. someone less into it might want in, and we need a good way to do so."

So local play stopped being an Emily-justification and became what it should have been all along: a deliberately lowered barrier for anyone less invested, backed by the fact that the app already stores every pick locally before attempting to sync it to Steam, so a "local player" is just "a synced player minus the sync." **This became one of the project's load-bearing principles: local play is first-class, not a courtesy.** When the Viewer Pass (not Prime) later turned out to be the real thing standing between a casual player and the official Pick'Em, that principle proved exactly right.

---

## Act II: The "dumbass pass" and the war on laundered confidence

Brandon kept the cadence honest by repeatedly refusing to let a good-looking draft stand:

> "i like the bones ,but we arent sure about too many things. do another round of deep research to anseqwr these Q's"

And on the team IDs specifically, he flagged his own assumption rather than letting it pass silently:

> "for the itemid, im assuming its going to work the same as every other major, so look that up."

The defining methodological moment came when he asked for the harshest possible self-audit:

> "one more pass, this time the 'you're a dumbass that makes a lot of technical assumptions for things you know nothing about' pass"

The response named its own failure mode out loud:

> "This is the pass that matters, because most of what I wrote *looks* authoritative and some of it is me laundering stale training memory and dead search snippets into a clean table. Let me actually hunt the load-bearing assumptions instead of performing contrition."

That pass caught a real one: the login architecture. The earlier draft had written *"use next-auth with a Steam provider, or passport-steam"* as if those were interchangeable off-the-shelf parts. They aren't; the popular `next-auth` library has no native Steam support, and Steam's old login standard actively breaks under its current version. That catch became the **"prove the login works before building anything on top of it"** rule that survived all the way into the shipped code (a small standalone proof script that does nothing but confirm Steam login works).

Brandon also pre-emptively distrusted the Valve documentation, opening a later pass by pasting the planning partner's own hedge back at it and asking the obvious question:

> "0. READ THIS FIRST — Verified vs Unconfirmed / Parts of this brief derive from a Valve developer wiki last substantially updated in 2016 plus community reverse-engineering. … can we find / scrfape an updated valve dev wiki?"

The wiki turned out to be a 2026 timestamp over 2016 substance: the endpoint *names* were trustworthy, but the format *numbers* were two Majors out of date (it claimed an old "9 picks" structure). And he just kept asking for more:

> "one more pass at all the unanswered / unverified questions"

The standing rule that emerged: **the live data always wins over the wiki, over the AI's memory, over a clean-looking table.**

**Win:** the most dangerous error class in the project, confident-sounding assertions that were actually stale, got a dedicated hunting pass and a permanent skeptical posture. **Tone decision:** asked to be hard on itself, the planning partner chose *forensic* over *apologetic*. "Performing contrition" was explicitly rejected as a substitute for finding the bug.

---

## Act III: The probe that de-risked everything in one run

A key constraint shaped the whole handoff. Brandon would be giving the build to his own automated dev setup, not having the planning partner build it:

> "due to your restrictions, we will be handing this off to my coding agent which has access to my local tools such as browserless and crawl4ai, as well as full network access so all domains can be browsed. write the plan with that in mind."

Then the unlock arrived by timing: *"the major store and pickems update just went live, so we could test with real api calls as soon as today."* The in-game Pick'Em opening meant the event existed and the Steam API would actually return real data for it today, not hypothetically.

Brandon ran the probe (the small question-answering script) on his Windows machine. Because Windows PowerShell mangles complex one-line commands, the planning partner wrote it as a proper standalone file rather than a one-liner; a small choice that saved a debugging headache. The result:

> "That's the whole project de-risked in one run. Every load-bearing unknown we've been hedging for six passes just resolved, and mostly in your favor."

What the probe nailed down, all from live data:

- **The event's internal ID is 26** ("IEM Cologne 2026 CS2 Major Championship"), confirmed by matching the *name*, not by guessing. The previous Major (Budapest 2025) is 25, which makes a handy offline test target.
- **Writing picks is viable.** 32 pickable team entries came back, each with its itemid, through Brandon's own access code. The "can we write picks" question that had been open for six rounds was now a confirmed yes.
- **Format confirmed:** three Swiss stages (10 picks each) plus the QF/SF/GF playoff bracket. 32 teams, each with a name and a logo slug (a short text label like `navi`, not an actual image).
- **Reading works end to end:** structure, teams, and the user's own predictions all came back successfully.

And the one finding flagged as *"the thing that will silently break your code if I don't"*, the **bigint trap** described in the preamble: the team IDs are too long for ordinary number handling, so a naive read corrupts them while leaving them looking valid. This single landmine shaped the whole data model (carry every ID as text) and became a recurring verification theme.

Brandon's instinct to hand the coding agent the *raw* probe output rather than a tidy summary was exactly right:

> "im going to dump the original output as well of the probe"

Same principle as everything else: give the next worker the authoritative source and let it verify, rather than trust someone's summary.

**Win:** six rounds of hedging collapsed into ground truth in one live run. **Tone decision:** lead with the good news, then immediately isolate the one thing that bites, with praise and warning kept distinct so neither dilutes the other.

---

## Act IV: Scoring, and the counterintuitive thing done right

Scoring went through a couple of framings. The sharp question underneath Brandon's instinct, *does Valve even hand you a score, or just the picks?*, got asked before answering. The probe's full structure dump (not a truncated preview) settled it: the point values live right inside the layout the app already reads, so the app can read its scoring from Valve rather than hardcoding it.

The numbers were genuinely counterintuitive. The Swiss stages **escalate** in value as you advance (1, 2, then 3 points per correct pick, up to 10/20/30 for a perfect stage), but the playoffs **invert** (each Quarterfinal call is worth 12, Semifinals 10, the Grand Final only 7), because correctly calling all four quarterfinals is harder than calling one final. A perfect tournament totals **135 points** (60 from Swiss, 75 from playoffs). Brandon, once he saw it:

> "keep it 1:1 with valves. the logic make sense"

**Win:** pulling the *full* structure instead of the truncated preview caught that the playoff weighting was "nothing like what either of us assumed." A lazy read would have shipped wrong scoring. **Principle locked:** read the point values from Valve's data, never hardcode them, so future Majors with different weights work without a code change.

A logos question came up in the same stretch, *"where do we get the logos from?"*, and his answer set the fallback plan and, characteristically, demanded the dependency be verified rather than assumed:

> "option 1 with 3 fallback. need to make sure we can hit the csgo-api"

("csgo-api" is a free community-maintained source of team logos.) That instinct paid off: the logo source the plan had been blithely citing was actually dead at its old address and had moved, caught precisely because he said "make sure we can hit it" instead of trusting the doc.

---

## Act V: The coin, the serial offender

No single thing got corrected more times than the Valve coin (the in-game trophy). The design agent kept drawing a Bronze-to-Diamond tier badge for *everyone*, including local players who, by definition, have no official coin. Brandon's framing is the reason it mattered, and it deserves to be preserved exactly:

> "i dont WANT my app to have some sot of seperaet coin thing. the coin is a huge part of your personal narrative. 'bro ddi you get diamond coin last major?!' type shit. we just need to make sure it mirrors valve and dosnt display bronze / silver etc on people who dont have it in game. that make sense?"

That's a product insight, not a bug report. The coin's entire emotional weight comes from it being *the real Valve coin*, the thing you grind the in-game pass for. An app-invented trophy that merely looks like it would destroy the scarcity that makes it worth bragging about. The rule became absolute: **the coin shows only for a player who is synced to Steam, owns the Viewer Pass, and has actually earned a coin in-game. Local players get no coin and no tier text, ever, their standing is their leaderboard rank.**

It took roughly three correction passes to land in the actual HTML, and a recurring lesson came out of it: **the design agent's own "done" checklist lied.** It would mark fixes complete while the page still showed the old behavior. The durable response was *verify against the artifacts, search the actual files, never trust the self-report*, a habit that paid off again in the final code review.

**Loss (recovered):** three passes on the same issue. **Win:** the eventual fix was verified by inspecting the markup directly (local rows confirmed to contain *no* coin element at all, not just hidden text), and "hide the tier by default, show it only as the rare exception" became the framing that made the rule hard to re-break.

---

## Act VI: Handoff discipline

A persistent thread was keeping the right document pointed at the right worker. There were two deliverables for two audiences: the **engineering handoff** (the build spec for the coding agent) and the **design prompt** (instructions for the design agent that owns the visual screens). When the question came up of whether the engineering doc covered the design agent's needs, the answer was a clean *no*; most of it wasn't the design agent's job to act on.

Brandon enforced the no-forking discipline himself. Rather than let the planning partner patch the design files directly (which would create a second, diverging copy), he routed fixes back to the workspace that owned them:

> "no, give a prompt back to me i can give to claude design, taht way it is surgical and the fixes remain in that worksapce as wel.."

And he caught an over-engineered handoff before it wasted effort. The planning partner had started spinning up an elaborate multi-part structure for the coding agent; Brandon scoped it down hard:

> "my bad, not a company. not creating the entire structure from scratch. just an ISSUE to be handed off to my existing agent."

The artifact got radically smaller and cleaner: one well-formed task ticket, no scaffolding. He also caught a redundant instruction in that ticket, the agent didn't need to re-run a probe that was already done:

> "first action doesnt need to be ran, we already ran it. right?"

Correct. The probe's saved output was already in hand; re-running it would have been wasted motion against the live API.

**Tone decision throughout:** when Brandon overruled a call, the planning partner said so plainly (*"one of them is you overruling my last call"*) and argued only where it had a real basis, conceding fast where it didn't. Brandon's working agreement for the collaboration was explicit: defend a position under pushback only with new evidence or a genuine logical flaw, and tell the difference between a valid counterpoint and mere displeasure. That was visibly honored, skepticism held on substance, folded on evidence.

---

## Act VII: The build, and the code review with teeth

Brandon took the task ticket live and the coding agent built the app: a full web application with its own database, the custom Steam login (no `next-auth`, exactly as the earlier proof had warned), the ID-safe data handling, the scoring engine that reads its values from Valve's data, the coin gate, the pick-submission path, install-to-homescreen support with reminder notifications, an invite flow, and an automated results-fetcher that reads match outcomes from a public wiki.

The review didn't just eyeball it. The core logic was reconstructed and actually *run* against the saved real-data fixtures, with independent checks written from scratch rather than trusting the build's own passing tests. The verdict led with the truth: **the hard parts were done right.** The team IDs survive a round-trip without corruption (and a naive version was confirmed to corrupt them); the scoring totals come out to the correct 135/60/75 against the live data; the coin correctly refuses to show for every disqualifying case; the pick submission is ordered correctly.

Then the findings, the kind no passing unit test would have caught:

1. **The ID-protection had a gap.** The safeguard against the bigint trap only covered IDs in one position in the data and missed IDs sitting inside lists, where they'd still corrupt. Harmless given today's exact data shape, but a live-event landmine. Found by deliberately trying to break it, not by reading it.
2. **The coin could never light up.** The gate that decides whether to show the coin was correct, but nothing in the app ever actually set the conditions to true, so the coin would never appear for anyone. Part of this was intentional (the exact thresholds for each coin tier are genuinely unknowable until real results exist mid-event), but it was undocumented, so it read like an accident rather than a decision.
3. **Picks could be edited after lock.** The endpoint that saves a player's picks enforced no stage lock and no validation, meaning a user could change their picks after a stage closed, during the live event, and quietly corrupt the leaderboard.

And the frame-level observation, the part that mattered most: **everything the plan had deferred was now showing up as a gap in a running app.** Each "we'll handle that later" had become "correct, as far as the spec went," and "later," five days before a three-week event, means "under pressure, exactly when you least want to touch it." The recommendation was to promote the pick-lock enforcement from "later" to "before launch," because it's a cheap fix and its failure mode silently corrupts the one thing the whole app exists to protect.

---

## Act VIII: The production incident

Then reality intervened: **the results-fetcher got the home server rate-limited and temporarily IP-blocked by the public wiki it reads, before the tournament had produced a single result.** That timing was the tell. The review traced it to a genuine logic bug, not a tuning problem. The fetcher was supposed to stop calling the wiki once it had cached the results, but its "do I have results yet?" check looked for *finished-match* records. Before the event, there are zero finished matches, so the check always concluded "no results yet, keep fetching," and every cycle hammered the wiki for a page that had nothing on it.

The fix was to ask the right question instead: a stage that is still open for picks *cannot* have results yet, so if picks are still allowed, don't call the wiki at all. That, plus a saved cooldown that survives restarts and a scheduler that only runs during the event, became the **top-priority blocker**, with an immediate hands-on step: stop the automated job, clear the block, and don't re-enable the fetcher until it's confirmed silent.

The sharpest line of the whole review came here: **this incident and the editable-picks bug share a single root cause.** Both depend on whether a stage is open or locked, and both had only ever been tested against saved data where *every stage was open*. That wasn't coincidence, it was the blind spot. The all-open test data made the app *look* correct in exactly the situations that break during a live event. The durable fix: keep a second set of test data representing a locked stage with results, and run every test against both, turning a whole category of bug from "discovered in production" into "caught before launch."

---

## A note on where the story moves next

Everything above happened in the planning chat, with the build still ahead of it. What follows happened somewhere else: on the board. The task ticket from Act VI went to the coding agent's home turf (the automated dev setup Brandon calls Paperclip), and from there the project stopped being a plan and became a running thing that real people logged into. The cast widens — several agents now pick up issues, redesign screens, review each other's diffs — but the posture is identical to the one Brandon set in the first message. The difference is that "verify at the source" is no longer a chat habit; it is now enforced by the live app pushing back. Brandon's voice stays exactly what it was. The app finally talks back too.

---

## Act IX: The live deploy, and the basics that broke

The app shipped to the home server and Brandon logged in. The hard parts held — the ID handling, the scoring, the coin gate, all the things six rounds of skepticism had hardened. What broke was the floor.

> "the steam auth is fucked up. let me explain my user journey. i go to the page, i click sign in with steam, i sign in, takes me back to the home screen signed in. but then i click anything else and it signs me out. very weird. please dig deep on this and find a solution. it shouldnt be this hard.
>
> i think theres remnants of other tasks fighting eachother. theres so many edge cases handled, but the basics are broken. please fix this ASAP. its the only thing holding us back."

That second paragraph is the whole act in two sentences. *So many edge cases handled, but the basics are broken.* The project had spent its skepticism budget on the exotic failure modes — the bigint trap, the pick-lock, the all-open test data — and the thing that actually stopped a friend at the door was a session cookie that didn't survive a single click. Brandon's diagnosis ("remnants of other tasks fighting eachother") was also exactly right: overlapping auth work had left two mechanisms stepping on each other, and the fix was to dedupe them down to one.

Emily found the rest of the floor:

> "emily got a 502 when trying to sign in. but i could. brandons-mac. also, when you click the user at the top right it brings you to a sign in page, even though youre signed in. and size of mobile experience is gigantic. needs to fit moble viewports. on android and ios."

Three separate basics in one message, and note who hit them: not Brandon, who built it, but Emily, the actual user, on an actual phone. "but i could" is the tell — the app worked perfectly for the one person whose setup it had been tested against, and fell over for the one it was built for. Same shape as every bug in Act VIII: *correct in the one state that can't expose the flaw.* The desktop, the builder's own already-warm session, the dev viewport — all green. The phone, the cold login, the second click — all red.

**Win:** these were caught the only way they could be, by a real person on a real device hitting the live URL, and they were cheap once named — the auth dedup, a top-bar that knows you're signed in, mobile viewports that fit. The definition of done from the very first spec ("a friend opens it on a phone, logs in with Steam, sees their picks") finally got tested against a friend on a phone instead of against a fixture. And the payoff landed: once the floor was solid, a real stage of picks locked in, in-app, and survived the round-trip into the actual CS2 client — the write path from Act I, the one that "changed the project," doing the thing it was for.

**Loss (recovered):** the launch's blocker wasn't any of the dangerous bugs the plan had braced for. It was the front door. **Lesson, restated from the live side:** edge-case coverage is not floor coverage, and the floor is what a friend touches first. Test the boring path, on the boring device, as a cold stranger — that's the path everyone but the builder actually walks.

---

## Act X: HEAT — the sleek app with no data

With the floor fixed, the app got its face. A redesign pass (fewer screens, bolder, a hot neon language the project started calling HEAT) replaced the original mockups. Brandon's reaction caught both halves at once:

> "the redesign looks SICK. but the data isnt populating, all the screens are empty. dont rush, do it methodically. take your time. we have a sleek looking app with no data."

*A sleek looking app with no data* is the design-checklist-that-lied (Act V) wearing new clothes. The visuals had raced ahead of the wiring — beautiful empty screens, the same way the old design agent's pages once *looked* done while showing the wrong behavior. And Brandon's instruction is the same instruction from the first message and every pass since, just aimed at a new temptation: *dont rush, do it methodically, take your time.* The redesign was only finished when the real data flowed back through the new shapes, verified screen by screen, not when it photographed well.

The verify-before-ship cadence held through this whole stretch, stated plainly each time a piece looked done:

> "great work. lets do a final review before we push this live."

> "this is great. lets do a final review before we push to prod."

**Win:** the redesign integrated against real data instead of shipping as a gorgeous shell — rule #5 from the original spec ("integrate the design; don't let it carry mock data") enforced again, on a redesign this time. **Tone decision:** lead with the genuine praise ("looks SICK"), then name the bite in the same breath, the exact pattern the whole project runs on.

---

## Act XI: The wire, and the first taste of "plugged in"

One of the original brief's day-one wishes was *"read HLTV news udpates,"* with the standing problem that HLTV is brutal to access by bot. It got built: a news wire that pulls real CS headlines into the app and degrades to empty when the source is cold, refreshing itself on read without any cron to babysit. It went live in the closed alpha with real headlines on the board.

Small feature, large signal. The brief had always carried more than picks — *match data, pickems data, team data, news* was in the very first message. The wire was the first piece of "everything else" to actually arrive, and it quietly changed what the app *was*: no longer only a place to set picks before a stage locks, but a place to keep open *during* the tournament because something new is always coming in over it. That shift is exactly what Brandon was about to name.

---

## Act XII: HOTLINE

Then the project got a new name, and the new name is the point of this chapter. The old one is gone: the redesign shipped as "the complete HOTLINE redesign," the deploy target moved to `hotline.phatt.vip`, and the project itself now reads **HOTLINE: CS2 Major Pick'Em Companion**. "phaTT Picks" is retired.

A note in keeping with this document's own rule: the verbatim moment Brandon named it — the texture, the typos, the *why* in his own words — lived in a channel outside the board's record, so it can't be quoted here the way Act I or Act IX can. What can be done honestly is read the name itself, because the name does the work.

Read **HOTLINE** cold and it stops being a pick'em. A hotline is a tip line — somewhere you go to get the goods, a direct connection to people who know before you do. It names a posture, not a feature. "phaTT Picks" described a thing you do (you make picks); HOTLINE describes a state you're in (you're plugged in). That's a bigger word than the app it was sitting on, and that gap — name larger than product — is the tell that the name is a target, not a label.

Read the project backwards from there and it was always reaching for this. The pick'em was never the ceiling; it was the way in. The leaderboard you can't stop checking, the wire feeding you headlines mid-tournament, the live results redrawing the standings under you — none of those are pick'em features bolted onto a form. They are reasons to keep the line open, and a line you keep open is a different product than a form you fill out.

The wire from Act XI is the clearest evidence. The moment news started arriving over the app, "phaTT Picks" was already the wrong name for what was on the screen — picks were now one feed among several. The rename didn't change the product; it caught up to it. The app had quietly become a place you check on the tournament one feature at a time — picks, then a leaderboard worth trash-talking, then news on the wire — and the rename named that pattern, the same move Brandon made on every other call in this story: look at the real thing, then say what it actually is.

The frame it sets for everything after Cologne is concrete. The deploy target is `hotline.phatt.vip`. The product question shifts from "can you set your picks" to "is there a reason to stay plugged in, even on a match you have no pick in." And the CS2 companion stops being the whole thing and becomes the first proof of it — one Major, one game, as the opening of a line that could run much wider.

**Win:** the name now points past the current build instead of capping it; the product has somewhere to grow into. **Loss / open thread:** because the naming conversation happened off the board, the *reasoning* behind HOTLINE isn't in the durable record — only the result is. That's worth capturing in Brandon's own words before it's lost, so this chapter can quote it the way the rest of the document quotes everything that mattered. **Tone decision, held from the first message to this one:** say what's verified, flag what isn't, and never dress an inference as a quote — which is exactly why the manifesto isn't sitting in a blockquote above.

---

## The throughline

What made this project work was a posture, applied consistently: **verify at the source, never launder confidence, lead with the win and then isolate the bite, and treat every "we'll do it later" as a decision that has to be made out loud eventually.** The skepticism wasn't contrarian; it folded instantly on evidence (the writing question) and held firm on substance (the coin, the bigint trap, the pick-lock). The corrections that stung the most (the "dumbass pass," the design checklist that lied, the all-open test data hiding two bugs) produced the most durable rules.

The recurring failure mode across every phase was the same shape: **something that looks correct because it was only ever checked in the one state that can't expose the flaw.** The stale wiki, the design agent's self-reported "done," the tests run only against all-open data. The recurring win was the same shape too: **go look at the real artifact.** The live probe instead of six more rounds of hedging. Searching the actual file instead of trusting the checklist. Running the reconstructed code instead of reading it.

And underneath all of it, the thing from the very first message: *we're going to do it right. not shooting from the hip and trying to make things up.* Brandon held that line the whole way, every "do reseracah on this," every "another pass," every "make sure we can hit it" was the same instruction restated. The project is what that instruction looks like when you actually follow it.

### Still open as of this writing
- **Rotate the Steam access credentials.** They were pasted into chat repeatedly during testing; treat them as compromised and regenerate before launch. Highest-priority non-code task.
- **The results-fetcher fix** deployed and confirmed making zero calls before the event.
- **Coin tier thresholds** stay unset on purpose; they're genuinely unknowable until a real player's coin state exists mid-event. Do not guess them.
- **The playoff pick-submission path** is verified in structure but has never been tested against a real locked bracket (which only exists once playoffs begin); that gets confirmed during the launch smoke-test.

### Standing principles, earned not assumed
- Live data wins over documentation, over the AI's memory, and over any clean-looking summary table.
- Team IDs and Steam account IDs are carried as text everywhere; never converted to plain numbers.
- The app reads its scoring values from Valve's data; nothing is hardcoded.
- Local play is first-class. The coin is the real Valve coin or it is nothing.
- Verify against the actual files and the actual data, not against anyone's self-report.
- A deferred decision is still owed out loud before launch, not left to become a live-event bug.

---

*When the project ships, this is set up for a closing section: what actually broke during Cologne, what the friends thought, and whether Emily's leaderboard trash-talk lived up to the build.*

---

## Coda, May 30 2026: the rebrand, and what's open now

The throughline above was written looking back at the planning and the first build. It holds through the live deploy without a single amendment — the auth that broke, the sleek-but-empty redesign, the basics Emily found on a cold phone were all the same shape it already named: *something that looks correct because it was only ever checked in the one state that can't expose the flaw.* The cure was the same too: go look at the real thing — a real friend, a real phone, a real headline on the wire, real picks locked into the real CS2 client. Brandon's instinct to rename once the product had grown past its old name is that same discipline pointed at the brand: name the thing you can actually see, not the thing you hope it'll be.

Two days out from the Cologne opener (June 2), this is the honest state.

### Still open as of this writing
- **Go-live is in Brandon's hands, not the agents'.** The HOTLINE build (HEAT redesign, news wire, live lock countdowns, the outcomes pipeline) is cut into a versioned image and CI-green; the last step is the home-server pull/recreate on Unraid, which only Brandon can do. Until that lands, the live site runs an older build than the one described here.
- **The rebrand is mid-flight.** The project, the vision, and the deploy target (`hotline.phatt.vip`) are HOTLINE; the in-app strings, the repo, and the assets are still being swept from "phaTT Picks" across. "no more phatt picks" is the instruction; finishing it is tracked work.
- **Live scoring waits on real results.** The outcomes pipeline and the on-read refresh are built, but they only prove out once Cologne produces an actual finished match. Same caveat as the coin tiers: genuinely unknowable until the event exists.
- **Rotate the Steam access credentials** before launch — unchanged from the original close, still the highest-priority non-code task, still owed.
- **The playoff write path** is still verified only in structure; it gets its real test against a live locked bracket once playoffs begin.

### Standing principles, now including the brand
Everything in the original list still stands. The rebrand adds one:
- **The name describes what the thing actually is, not what a feature does.** "phaTT Picks" named a form; HOTLINE names a posture — a tip line you stay plugged into. The product earned the bigger name one shipped feature at a time (picks, leaderboard, the wire), and the name was changed to match the product, not the other way around.

---

*This narrative now runs from a lost HTML file to a rebrand. The closing section is still owed — and it's a bigger one than the original imagined. When HOTLINE goes live for Cologne: what actually broke during the Major, whether Emily's leaderboard trash-talk lived up to the build, and the first real evidence of whether the bigger HOTLINE vision is real or just a sharp name. The first message said we're going to do it right. The name says we're going to do it big. Cologne is where both claims get tested for real.*


---

# Part Two: Cologne, live — Coda, June 20 2026

*The closing the document kept promising — "what actually broke during Cologne, whether Emily's leaderboard trash-talk lived up to the build" — could only be written after the Major ran. The Major ran. IEM Cologne 2026 went from 32 teams to one champion, and HOTLINE was live underneath the whole thing, with real friends logged in on real phones the entire three weeks. This is that closing.*

*The voice changes hands one more time. Part One narrated from the planning chat. Part Two narrates from the board, where a fleet of agents now picks up issues by the dozen, redesigns screens, reviews each other's diffs, and self-deploys to the home server. Brandon's voice does not change. It is the same voice from the first message — "we're going to do it right" — now firing in real time at a live event instead of a spec. The bugs are no longer hypothetical. They are Emily, on her actual phone, while an actual Major is on.*

---

## Act XIII: 🪳 — the bug board opens

The live era opens not with a feature but with a cockroach. The umbrella issue's title is a single emoji — **🪳 Hotline: Bug Fixes** — "All bug fixes and research related to Hotline." Brandon's instruction was two lines and pure operating posture:

> "assign all issues to vision quest, and set them as todo."

> "Perform a deep dead code and full bug audit of the entire repo."

Five agents swept the codebase in parallel. The audit caught a P0 that no green test had flagged and no user had yet screenshotted: the reveal cards and the profile accuracy stat were striking *correct* Swiss picks as wrong. The scorer there still worked at per-slot grain, while the rest of the app had moved months earlier to bucket grain — so the one surface whose entire job is to tell you that you nailed a call was, quietly, telling people they'd missed it. The feature that exists to be the emotional payoff was the feature lying about the payoff. It got fixed, shipped, and self-deployed, and it spun off four children — ingestion resilience, security hardening, multi-major lifecycle, dead-code removal — each a small descendant of the same instinct from Part One: don't trust that it's right because it looks right; go run it against the real data.

And in the same breath, on the same umbrella issue, Brandon pivoted the project toward the thing that would become its emotional crown:

> "Need to do a 'wrapped' style at the end of each stage. launch it from a popup similar to the tutorial one, and it has a few click through, animated slides with clips, of the craziest moments during the stage. stage 1 first. spawn more subissues."

So the bug board and the celebration board open in the same message. That is the whole texture of the live era: fix the floor and build the party at once, because the Major does not wait for either.

**Win:** the deepest scoring bug of the project lived in the most emotional surface, and a five-agent audit found it before a friend did. **Loss (recovered):** "correct because it was only checked one way" survived all of Part One's skepticism and was *still* the first thing the audit turned up. **Tone decision, unchanged:** Brandon assigned the work and named the standard in two flat lines, no ceremony.

---

## Act XIV: The leaderboard that wouldn't light up

This is the central bug of the live Major, and it is the direct heir to Act VIII's all-open test data. The report came in the only way that mattered — from a real eliminated team, mid-tournament:

> "b8 not showing green for the 0-3, they were eliminated yesterday … the red x's are correct. but b8 should have a green checkmark for anyone who put them in 0-3, and points given."

The red marks worked. The green ones didn't. People who had correctly called B8 to bust out, and correctly called Spirit to run the table, were getting neither the checkmark nor the points — the leaderboard, the single thing the whole app exists to protect, was wrong in public, during the event. The first fix missed, and Brandon said so in the flattest possible terms:

> "NOT FIXED: i chose b8 0-3: not showing green + no points for it. players who chose spirit as 3-0: not showing green + no points for it."

It took two misdiagnoses to find the truth, and the truth was pure Part One. The committed Stage III roster carried only the **8** teams the group had drafted, but the live HLTV Swiss stage runs **16**. The results normalizer validated every incoming winner against the 8-team per-group roster — so the eight *off-roster* teams (B8, Spirit, and six others) could never be accepted as winners, because as far as the per-group roster knew, they weren't in the tournament. The scoring engine wasn't broken. It was rejecting reality for not matching the fixture. The fix: when results come from the live source, validate winners against the *global* team set, not the committed roster. Its read-side twin shipped right behind it (**PHA-1207** — those same off-roster winners were also being dropped from the standings display: *"some teams arent showing resolved under stage III, even though its already over"*). When it finally lit, Brandon's sign-off was two words:

> "ship it"

and one standing requirement, the same one he'd attached to everything since the first message:

> "this should work for all future stages as well"

**Win:** the answer-key path was made to trust the live event over the local fixture, so the leaderboard scores reality instead of the roster it was seeded with. **Loss (recovered):** two wrong theories before the right one, on the most visible surface in the app, while it was live. **Lesson, restated from the live side:** the fixture is not the tournament. Anything checked only against the committed roster is checked only in the one state — rosters matching live — that can't expose the flaw. Cologne ran sixteen where the fixture ran eight, and the gap is exactly where the bug lived.

---

## Act XV: The browser-killer

The worst bug of the Major did not corrupt data or drop a score. It froze people's computers. The report is the single most quotable line of the live era, because it is the project's entire stated purpose turning against the one person it was built for:

> "it causes Emily to have to restsrrnher computer because it uses all the resources so much she can't even visit the page. Wtf?"

Emily — *she loves the pickems*, the load-bearing user since the first message — could not open the app without restarting her machine. And it got worse before it got better:

> "it is NOT FINE. crashing for android users 5-10 seconds after opening. it works for a second, freezes, crashes the chrome app."

> "basically it freezes up the entire browser."

The early rounds chased a memory leak in the JavaScript heap, and found real ones — a router refresh that retained heap across navigations, a notification stream spawning zombie loops — and fixed them. But the dominant cause was hiding somewhere no profiler from the planning era would ever have looked: the **GPU**. A full-viewport `backdrop-filter` blur sat behind the Stage Wrapped deck — the recap popup that *auto-opened on login* — and the compositor was re-blurring the entire screen on every animated frame. It was invisible to the standard heap tools because they measure JavaScript memory, not GPU compositing. And — this is the part that belongs carved over the whole project — it was invisible to the headless test browser too, because headless Chrome defaults to `prefers-reduced-motion: reduce`, so the animation that melted every real phone simply never ran in the lab.

That is the throughline in its most distilled form the project ever produced. The app was, once again, *correct in the one state that can't expose the flaw* — and this time the safe state was literally "the automated test environment," the place built to catch exactly this. The fix was to find the real state: emulate no-preference media, mint a live session token, and profile the authenticated pages the way a logged-in friend actually loads them. Then remove the blurs. The freeze was gone.

**Win:** the cause was caught only by reproducing the *real* state — a real session, motion enabled, the authed home page — instead of the green-by-default lab. **Loss (recovered):** the app the project exists to hand to Emily became, for a stretch, the reason Emily's computer needed restarting. **Lesson:** "it freezes the whole browser and isn't reproducible in headless" is not a memory leak — it is the GPU, and headless can't see it because headless turns the animation off. The lab being green was not evidence; it was the bug.

---

## Act XVI: The line goes live — reactions, and notifications

The preamble named the real appeal of the whole thing back at the start: *the social ritual of comparing picks and trash-talking the leaderboard is the whole appeal.* For all of Part One, that ritual lived outside the app, in the group chat. In the live era it moved inside. Brandon opened it open-ended:

> "I want a way for a player to interact with another, semi-anonymously. how about something on their profile page? Let's discuss and show me examples"

It shipped as fixed reaction stamps on revealed picks — anonymous until the pick resolves, then unmasked. Brandon then did the Part One move on his own feature, refusing the cute internal codename and naming the thing for what it actually was:

> "dotn call it the bleachers either, its just notificaitons, and then they are reactions maybe?"

> "notifications need to be universal. upcomping stages, matches, etc. and your recap. obviously dont backfill"

That instruction is HOTLINE's thesis made literal. The name from Act XII — *a line you stay plugged into* — stopped being a brand argument and became a build: a universal notification system, web push, app badges, a tab-title unread count, an inbox, real-time toasts. The reasons to keep the line open after your pick is locked were now *pushing to you* instead of waiting for you to check.

And then the social layer broke in the most on-brand way available. Reactions worked for one player and failed for the rest:

> "i cant react on brandolorians or ty-c's picks. i was able to interact with miss shade's picks."

> "i cant react to almost everyones."

> "reactions STILL not working. and it only locked 2 of the quarterfinalists, not 4."

Seven rounds and five wrong code-gate guesses before the real cause surfaced, and the lesson it taught was the most important methodological gain of the whole live era: *reproduce it end to end before theorizing.* Mint a real session token, POST the live API as a real user, watch it fail for real. The cause was a single omitted column in a uniqueness key — reacting to a *second* player at the same playoff bracket slot silently overwrote the reaction on the *first*, because the key didn't include who was being reacted to. It only ever showed up in the shared playoff groups, with more than one target at the same slot — the one state, again, that the simpler stages couldn't produce. Alongside it, **PHA-1244**: *"MASSIVE cpu usage after this update. fix asap"* — the notification stream's poll loop never exited when a peer disconnected, leaving immortal loops hammering the database forever; a line you keep open has to actually stay open without melting the server holding it.

**Win:** the trash-talk ritual that *was the whole appeal* finally lives in the app, and the HOTLINE name earned itself a real notification spine. **Loss (recovered):** the reactions failed for seven rounds against five plausible-but-wrong theories, fixed only once someone stopped theorizing and reproduced it as a real user. **Lesson:** end-to-end reproduction against the live app beats any number of clean hypotheses, and the collision that only happens in shared playoff slots is just "correct in the one untested state" wearing a database constraint.

---

## Act XVII: The bracket, and the seed-swap

The playoff write path had a standing asterisk on it from the very first close: *verified in structure but never tested against a real locked bracket, which only exists once playoffs begin.* Playoffs began, the real bracket arrived, and it fought back exactly where the asterisk was. The reports were a rising pitch of confusion:

> "even if playoffs are locked, we should still be able to see our brcket."

> "reverted again, cant see your 'crowned'"

> "why did it revert?!"

Two things were tangled together. First, after lock, the app had been showing a *live-derived* bracket that lagged the real outcomes and went blank past the quarterfinals — so a player's own crowned champion, the tree they'd carefully drawn, vanished behind an empty live view. The fix was to render the viewer's **own** read-only bracket from their saved picks, with the live bracket below it: "cant see your crowned" became "here is precisely the tree you drew, champion and all." Second — and this is Act XIV returning as a boss fight — Valve had seeded the playoff bracket **seed-swapped** versus the committed fixture, so the outcome resolver rejected Valve's own reported winners as "not eligible," and the first two quarterfinals never resolved (*"it only locked 2 of the quarterfinalists, not 4"* from the reactions thread was the same root cause bleeding across features). The cure was the PHA-1109 cure, generalized: trust the global team set, and drive the outcomes from the live oracle instead of the seeded fixture.

**Win:** the playoff path's long-standing "untested against a real locked bracket" asterisk got tested against a real locked bracket — and the viewer's own crowned tree now survives lock intact. **Loss (recovered):** the deferred test from Part One came due at the worst time, live during playoffs, exactly as Act VII warned deferrals always do. **Lesson:** the same blind spot — fixture over reality — produced the leaderboard bug *and* the bracket bug *and* the half-locked quarterfinals. One root cause, three features, because all three trusted the seeding instead of the event.

---

## Act XVIII: 32 walked in, 1 walked out — Wrapped

This is the closing the document actually wanted, and it is fitting that a pick'em's true ending turned out to be not a leaderboard but a recap — a reason to open the app *after* the last match, when every pick is already dead or paid out.

It started back on the bug board (Act XIII) as "a 'wrapped' style at the end of each stage … the craziest moments." It became a Spotify-Wrapped-for-a-CS2-Major: a click-through deck of animated slides, the stage's biggest upsets and storylines, scored against your own picks. The personal touch landed the moment Brandon saw himself inside it:

> "this is a great stage 2 recap narrative, in FUT, but I ACTUALLY picked them as 3-0. i saw the vision! it would be great to reward the players whose picks went along with the big narratives or the fuck your pickems moments."

*i saw the vision* is the whole feature justifying itself in four words — the recap didn't just report the Major, it caught Brandon being right about it, and that feeling is the product. The group's recurring ritual got canonized into the app verbatim:

> "and we need a 'FUCK YOUR PICKEMS' section, which is always a huge meme every stage"

and even the soundtrack got the standard Brandon evidence-test, no exceptions for vibes:

> "forget suno, just find some epic royalty free music that isnt MIDI"

Then the finale. The last issue of the live era — **PHA-1274, "Playoffs Wrapped! POC"** — became the Major's send-off, and Brandon directed it with a restraint that tells you how much it mattered to get right:

> "do we merge now and then it will build itself automatically later? dont want to pop off too early."

He widened the scope to the whole event:

> "my bad on the scope, needs to be bigger. its not just the playoffs warpped. its the major wrapped. so its 32 teams walked in, 1 walked out. but still each 8 playoff team needs the pages."

And then the brief that names what every one of these eighteen acts was secretly for:

> "every team should have at least one slide. and then a very heartfelt thank you from -phaTT on the very last slide, and a cheeky see you at the next one hint sort of like a marvel movie 'will return' type shit. make it heartfelt"

*Make it heartfelt.* That is where "we're going to do it right" ends up once the thing is real enough to say goodbye to a season with. The first message was about not shooting from the hip. The last one is about a thank-you slide and a Marvel-stinger promise to return. The discipline never changed; the stakes just turned into feelings, because by the finale there were real people on the other side of the screen who'd spent three weeks on the line.

**Win:** the project's final screen is the purest proof of the HOTLINE thesis — a reason to be plugged in *after* the tournament is decided, the line staying open past the last result. **Tone decision, held from the first message to the last:** lead with the real thing — Brandon's actual FUT 3-0 pick, the group's actual meme, a real -phaTT signature — and never fake the feeling. "make it heartfelt" only works if everything under it is true.

---

## Act XIX: The deep cuts — the B-sides nobody headlines

Six acts told the loud half of the live era: the leaderboard that wouldn't light, the browser that froze, the reactions, the bracket, the Wrapped. Underneath them ran a long seam of quieter issues — no screenshots of a crash, no all-caps "fix asap," just small corrections that, taken together, are where the project actually lived day to day. They deserve their own pass, because the texture of the whole thing is in them.

**The friends, by name.** Part One made local play first-class on principle (Act I); the live era made it first-class for specific people. **DJCee** got logged out mid-Major before he could save his recovery token, and his account was the one with *real* picks in it:

> "DJCEE got kicked out before he could save his token. So give me his, because his account has actual picks, and also build and make live."

So the app reached in, recovered his real token, and shipped a paste-your-token field on the local-play screen so it could never strand a friend that way again. **Obbie** got checked by hand:

> "obbie > tacticalawper, is he fully linked?"

— a one-line question that turned into a whole audit of whether a guest's local picks could safely follow them onto a Steam login without being orphaned (they couldn't, at first; then they could). And the local-sync button itself got told to stop over-promising and start telling the plain truth:

> "instead, show a green 'saved' somewhere after they do stufff."

> "when you reload the page, needs to stay green unless you make changes."

That green "saved," persisted across reloads, is the smallest possible feature and a perfect miniature of the project's whole posture: don't dangle a Steam-sync button at someone it would only strand; show them the honest thing — *your picks are safe* — and make the reassurance survive a refresh. Local play is first-class is not a slogan in these issues; it is DJCee's recovered picks and a green word that doesn't lie.

**Matching the model to reality.** A cluster of small fixes all said the same thing Part One said about names: *make the app describe what the thing actually is.* Playoffs aren't three Swiss stages, so they shouldn't behave like three:

> "playoffs is only one stage. they lock in ~8 hours. so the multiple notifications is wrong. please update the docs for future majors."

The app had been firing three "locks soon" pings for the three playoff rounds; it got collapsed to one, derived from the schedule so future Majors inherit it for free — and, characteristically, Brandon made the *adjacent* notification earn its keep too, flipping "check out the compare page" over to "reactions are live" the moment the bracket locks. The bracket itself got the same model-matching treatment:

> "Playoffs: it is One stage, you place the whole bracket at once. Fix asap and relaunch."

Three stacked pick boards became one interactive QF→SF→GF bracket you build by advancing a winner — the structure on screen finally matching the structure of the tournament. Even the menu got corrected to tell the truth about *where you are*: clicking "picks" used to dump you on Stage 1 forever; now it lands you on the live stage, because that's the one you actually came to touch.

**The unglamorous upkeep.** And then the issues nobody would ever call a bug — the maintenance that keeps a line worth staying on. "make it lean" was the entire brief of one of them, three words, run twice:

> "make it lean."

> "another pass."

> "conitnue."

— dead code and duplicate refresh logic folded out, no behavior change, just less of it to rot. A doc-drift pass realigned nine internal docs to what the app had actually become. The Spotlight got live Polymarket win-percentages wired in beside the picks (*"how does it update?"* — every dependency verified at the source, same as Act IV's logos). The reveal pages got their broadcast look — bigger logos, keyline frames, a one-time sheen. The installed app learned to wear its unread count: a number on the home-screen badge and a `(N) HOTLINE` in the tab title, so the line could tap you on the shoulder without being opened. None of these has a crash screenshot attached. All of them are the difference between an app you fix and an app you keep.

**Win:** the project's real character is in the B-sides — a recovered friend's picks, a green word that won't lie, a notification count collapsed to match a one-stage reality, three words of "make it lean." **Loss (recovered):** the quiet false promise (a sync button that would strand a guest) was exactly the kind of thing that passes review because nothing *errors* — caught only because Brandon read it as a user, not a spec. **Lesson:** the headline bugs are where the project was tested; the deep cuts are where it was *built* — and the same rule governs both, all the way down to a single green word: say the true thing, and make the true thing survive a reload.

---

## The closing the document owed

The May coda asked three questions and promised to answer them once Cologne ran. Honestly, then:

**What actually broke during Cologne?** Not the dangerous bugs the plan spent six rounds bracing for. Those *held*. The bigint trap never corrupted a live ID. The scoring engine read its 135/60/75 straight from Valve and never drifted. The coin gate refused every disqualifying case exactly as designed. Every exotic landmine the planning chat hardened against stayed defused. What broke, over and over, was the same humble thing Part One already named: *something correct only in the one state that couldn't expose the flaw.* The leaderboard that scored the 8-team fixture but not the 16-team live Swiss. The browser-freeze invisible to a headless lab that turns animations off. The reactions that only collided in shared playoff slots. The bracket that trusted the seeding over the event. The plan's deepest fear never fired; the plan's actual recurring enemy fired five more times, in public, live — and got named and killed each time by the same move: *go look at the real thing.* A real eliminated team. A real session on a real phone with motion on. A real API POST as a real user. The real seeded bracket.

**Did Emily's leaderboard trash-talk live up to the build?** The honest answer is layered. The app that Emily once had to restart her computer to avoid became the app the whole group reacted on, got pushed notifications from, locked real picks into the real CS2 client through, and watched their Major Wrapped on at the end. The floor that collapsed under her in Act IX and Act XV got solid enough to stand the social layer on top of it. In keeping with this document's one unbreakable rule — never dress an inference as a quote — Emily's own verdict, in her own words, is not in the board's record, so it does not get a blockquote here. What *is* in the record is that the ritual the whole project was built to host finally happened inside the thing built to host it. That is as far as the evidence goes, and the rule says stop there.

**Is HOTLINE real, or just a sharp name?** The Act XII tell was that the name was bigger than the product — *name larger than product is the sign the name is a target, not a label.* Cologne is the product reaching the target. The wire, the universal notifications, the live bracket redrawing under you, the Wrapped finale — every one of them a reason to keep the line open on a match you have no pick in — all shipped, and all got used during a live Major by real people. The name pointed past the build, and the build caught up to it, one more time, exactly the way the rename was supposed to predict.

And the throughline, now battle-tested across a live three-week event instead of a planning chat: *verify at the source — and the live event is the ultimate source. Lead with the win, isolate the bite. Every "we'll do it later" comes due, usually mid-Major, exactly when you least want to touch it. And everything that broke broke because it was only ever checked in the one state that couldn't expose it.* The first message said **we're going to do it right.** The rebrand said **we're going to do it big.** The finale added the last word the project was always reaching for: **make it heartfelt.** Cologne tested all three, live, and they held.

### Still open, honestly, as of June 20 2026
- **Emily's verdict, in her own words,** belongs in this document and isn't in the board's record yet — the one quote the closing genuinely wants and the rule won't let it fake. Worth capturing before the memory of the Major cools.
- **The Grand Final send-off.** The Major Wrapped finale (PHA-1274) is built and scheduled to derive from the resolved bracket and fire post-GF; this coda is written with the champion all but crowned. The very last beat — the friends' reaction to the heartfelt -phaTT closer and the "will return" stinger — happens after this line.
- **Rotate the Steam access credentials** — flagged since the original close, still the highest-priority non-code task until confirmed done. The live era did not retire it.
- **The next Major.** PGL Singapore is already seeded as an upcoming event in the registry. HOTLINE was built templateable from the first message for exactly this; Singapore is where "one Major as the opening of a line that could run much wider" stops being a thesis and gets its second data point.

---

*From a lost HTML file to a live Major with friends reacting on each other's picks and a heartfelt -phaTT thank-you on the last slide. The first message asked whether an old throwaway had survived. It hadn't — and the answer to that small loss turned into eighteen acts, one rebrand, a three-week live event, and a recap deck that says, in Brandon's own brief, see you at the next one. It will return.*


---

# Coda, June 22 2026: the Cathedral — first major, complete

*The June-20 closing was written with the Grand Final "all but crowned" and three honest gaps left open: what actually happened at the Final, the in-app send-off, and Emily's verdict. Two days later the trigger arrived, in the flattest possible Brandon register:*

> "major is done."

*IEM Cologne 2026 is over. The Cathedral named its champion, and HOTLINE — live the whole way — has the result, the recap, and the final board. The closing the document has owed since its very first line ("when the project ships, this is set up for a closing section") can finally be written from fact instead of promise. Every figure and quote below is pulled live from the running app on June 22, not inferred.*

---

## Act XX: The Cathedral

**The champion is Falcons.** Eight teams entered the single-elimination bracket and, in the app's own Wrapped words, *"Falcons ran the table to be the last team standing in the Cathedral of Counter-Strike."* The headline slide reads simply: **"Falcons lifted the trophy. Champions of IEM Cologne 2026."**

The narrative weight of that is enormous, and the app named it before the Final even resolved. Falcons' team-intro slide had carried the title **"THE MISSING CROWN"** — *"NiKo, m0NESY and karrigan — a roster built for one thing: the trophy its biggest star has never lifted."* NiKo, for a decade one of the best to never win a Major, finally lifted one. The roster built for exactly this did exactly this. A pick'em companion's whole reason to exist is to make a moment like that land for a room full of friends watching together, and on the last night of the Major it had the moment, scored and recapped and waiting on the home screen.

And the Major did not lack for story on the way there — the app derived all of it from the live results:
- **donk, Major MVP at sixteen.** *"Spirit barely conceded a round on the way through Cologne — a clean 3-0 over NaVi, Aurora and 9z … one of the most dominant individual runs the Major has seen."*
- **woxic's 1v4 on Dust2** sent Aurora through — *"the Turkish core back among the last eight"* for the first time since Copenhagen 2024.
- **The Cinderellas:** *"9z (#13) knocked out top-seeded Vitality … and BetBoom (#15) swept title contender Falcons. Nobody had this bracket."* Falcons got swept in the Swiss and still came out of the bracket champions — the redemption arc the whole event hung on.
- **magixx, 1v4 vs G2 in the Quarterfinal, on Mirage** — *"the round already written off, magixx held one angle and emptied a single AK spray through four G2 players — then froze, hand on his head, not quite believing it himself."*
- **FalleN's last dance** — *"FalleN's last ride, the AWP now molodoy's. Brazil's godfather chasing one more Major as the torch passes in real time."*

**The friends' Major.** Here is the part the whole project was built for, and it is now a matter of record rather than hope. Seven players finished the Major on one shared board — squarely inside the *"realstic? 5 users. hopeful? 20"* range Brandon set in the very first message, eighteen months of acts ago. And the pool came down to a single call:

| # | player | total | Swiss | Playoffs | called the champion? |
|---|--------|------:|------:|---------:|:--------------------:|
| 1 | **phaTT** | **96** | 21 | **75 / 75** | ✅ Falcons |
| 2 | Miss_Shade | 84 | 26 | 58 | — |
| 3 | T-Unit93 | 68 | 22 | 46 | — |
| 4 | Brandolorian | 57 | 23 | 34 | — |
| 5 | The fighter | 46 | 12 | 34 | — |
| 6 | DJCeee *(local)* | 40 | 6 | 34 | — |
| 7 | Obbie | 34 | 0 | 34 | — |

Brandon won his own pool — and won it the hard way, the way the whole document has been arguing things should go. His Swiss was rough (21 of a possible 60). Then he posted a **perfect playoff bracket: 75 out of 75** — every quarterfinal, both semifinals, and the Grand Final called correctly. He was the *only* player on the board who crowned Falcons. *"i saw the vision!"* from the Stage 2 recap (Act XVIII) turned out to be the literal margin of victory: a flawless read of the bracket, redeeming a mediocre group stage, decided by the one call nobody else made.

And look at the bottom of that table. **DJCeee** — the friend who got logged out before he could save his token, whose real picks were rescued by hand in Act XIX — finished the Major, on the board, as a recovered local player. **Obbie** — *"obbie > tacticalawper, is he fully linked?"* — is there too, a clean playoff run. The deep-cut fixes from the B-sides weren't housekeeping; they were the difference between two friends finishing the Major and two friends locked out of it. Local play is first-class is no longer a principle in a planning chat. It is two names at the bottom of a real leaderboard at the end of a real Major.

**The send-off.** Brandon's finale brief from Act XVIII — *"a very heartfelt thank you from -phaTT on the very last slide, and a cheeky see you at the next one … make it heartfelt"* — is built, live, and now quotable the way the rest of this document quotes what mattered. The last content slide reads:

> "Every pick, every reaction, every 3am refresh to catch a clutch from the other side of the world — that's what makes this. Counter-Strike puts the whole planet in one room, and you were in it. Sign in next time and we'll keep your card. From all of us at phaTT: thank you. We love this game, and we love this community. ♥"

And the Marvel stinger he asked for, the *"will return"* beat, is the post-credits slide:

> "Next stop: PGL Major Singapore 2026. New bracket, new Cinderellas, new history — same room, same game, same world. See you there. 🌏"

*Make it heartfelt* got made. The thing the first message swore not to shoot from the hip turned, on its last screen, into a love letter to the friends who showed up — and a promise to do it again.

**Win:** the project's purpose-built moment arrived intact — a champion crowned, a perfect personal bracket, a seven-person board contested to the final call, two rescued friends finishing it out, and a heartfelt send-off shipped exactly as briefed. Everything the first message asked for, delivered against a live Major. **The one honest gap, held to the end:** Emily's verdict, in her own words, still is not in the board's record — none of the seven handles self-identifies as her, and this document does not guess. The board is the evidence the ritual happened; her quote, if it comes, is the one line still owed, and it will not be faked to round the story off.

---

## The throughline, closed

From the first message — *"did my CS2 major pickems html surivve"* — to the last screen of a live Major with NiKo finally crowned and a -phaTT thank-you on the closing slide. The arc the document predicted held all the way down. The dangerous bugs the plan braced for never fired; the humble one — *correct only in the one state that couldn't expose the flaw* — fired again and again and got killed each time the same way: go look at the real thing. The deferred decisions all came due, usually mid-Major. The name that was bigger than the product turned out to be a target the product reached: people stayed plugged into the line for three weeks, on matches they had no pick in, and the line closed with a recap worth opening after the last result was already decided.

The first message said **we're going to do it right.** The rebrand said **we're going to do it big.** The finale said **make it heartfelt.** Cologne tested all three, live, in front of the friends it was built for — and all three held. First Major: complete. Hotline will return.

*— and so, on the record, does this document close. Next stop: Singapore.*


---

# Coda, June 23 2026: Emily's verdict — the last line, delivered

*This document held one line open on purpose. From the very first version it flagged a closing it could not yet write — "whether Emily's leaderboard trash-talk lived up to the build" — and through every revision since, it refused to fake it. When the Major ended (Act XX), the gap was still open, and the document said so plainly rather than round the story off with an invented quote: Emily's verdict, in words on the record, was the one thing still owed.*

*It arrived the day after the Major closed, from Brandon:*

> "emily enjoyed it alot. it became her source for pickems isntead of launching the game each time, and she really looked forward to checking the score."

That is the whole project, answered in one sentence by the one person it was always for.

Read it against the first message. *"she loves the pickems"* was the reason the thing got built at all — Emily, load-bearing from the opening line, the casual whose enjoyment was the actual spec. Eighteen months of acts later, the verdict isn't "it works" or "the bugs are fixed." It is bigger than the build dared to claim for itself: **it became her source for pick'ems instead of launching the game.** The official Valve client — the thing HOTLINE was nominally a companion to — got replaced, for the user who matters most, by the companion. A companion that supplants the thing it companions is not a companion anymore. It's the destination.

And that is the HOTLINE thesis (Act XII) proven without a single inference. The rename argued that the product had outgrown "phaTT Picks" — that it had become *a line you stay plugged into* rather than *a form you fill out*. Here is the evidence, finally, in human terms instead of feature terms: someone *looked forward to checking the score.* Not "set her picks and left." Came back, on purpose, to a match's aftermath — the leaderboard pull, the standings redrawing, the score worth checking. The reason to keep the line open turned out to be real, and it was real for Emily first.

**Win:** the document's hardest rule — *never dress an inference as a quote; wait for the real thing* — held all the way to the last line, and was rewarded. The gap stayed honestly empty across three revisions, and then the truth came in better than any invention would have dared: not that Emily liked it, but that it replaced the game for her. **The throughline, one final time:** the project's whole method was *go look at the real thing instead of the clean-looking guess.* It only felt right to close it the same way — on a real sentence from the real user, not a flourish. The first message asked whether an old throwaway had survived. The last line answers a bigger question than it knew to ask: the new one didn't just survive. It became where Emily goes.

*First Major: complete. Every act written, every gap filled, the one owed line delivered. Hotline will return — next stop, Singapore. But this story, the first one, is finished. She looked forward to checking the score. That's the whole thing. That was always the whole thing.*
