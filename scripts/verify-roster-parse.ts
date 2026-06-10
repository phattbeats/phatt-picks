/**
 * verify-roster-parse — offline proof for the PHA-992 roster parser.
 *
 * gather-roster refreshes each player's HLTV rating + profile link from the team
 * profile's "Players of {team}" table. This asserts the shared parser reads that
 * table the way the ops tool relies on — STARTER filtering, the BENCHED late-swap
 * escape hatch, section isolation, and graceful empties — with no network.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/verify-roster-parse.ts
 */

import {
  parseRosterStarters,
  hltvPlayerUrl,
} from "../src/lib/team-stats-sources.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

// A faithful slice of an HLTV team profile's markdown "Players of X" table:
// four STARTERs and one BENCHED, each a [flag nick](player/id/slug) link followed
// by STATUS | time | maps | rating cells. (Shape lifted from a real crawl.)
const md = `
## Players of Vitality
Stats from entire team period *
| Player | Status | Time on team | Maps played | Rating 3.0 |
| --- | --- | --- | --- | --- |
| [ ![img](x) ![France](f) apEX ](https://www.hltv.org/player/7322/apex) | STARTER | 7 years \n8 months | 1429 | 1.00 ** |
| [ ![img](x) ![France](f) ZywOo ](https://www.hltv.org/player/11893/zywoo) | STARTER | 7 years \n2 months | 1432 | 1.32 |
| [ ![img](x) ![France](f) flameZ ](https://www.hltv.org/player/16693/flamez) | STARTER | 1 year | 491 | 1.14 |
| [ ![img](x) ![Finland](f) Jimpphat ](https://www.hltv.org/player/18850/jimpphat) | BENCHED | 2 years | 478 | 1.10 |
| [ ![img](x) ![GB](f) mezii ](https://www.hltv.org/player/18462/mezii) | STARTER | 1 year | 438 | 1.06 |
## Some other section
| [ ![img](x) ![DK](f) someoneElse ](https://www.hltv.org/player/9999/someoneelse) | STARTER | 1 year | 10 | 2.00 |
`;

// STARTER-only (the default): the four starters, in table order, no benched, and
// nothing from the unrelated section after the table window.
const starters = parseRosterStarters(md);
check("starters: 4 STARTER rows", starters.length === 4);
check(
  "starters: nicks in order",
  starters.map((p) => p.nick).join(",") === "apEX,ZywOo,flameZ,mezii",
);
check("starters: id + slug captured", starters[0].hltvId === 7322 && starters[0].slug === "apex");
check("starters: rating parsed past the ** footnote", starters[0].rating === 1.0);
check("starters: ZywOo rating", starters[1].rating === 1.32);
check("starters: BENCHED excluded by default", !starters.some((p) => p.nick === "Jimpphat"));
check(
  "starters: out-of-section player excluded",
  !starters.some((p) => p.nick === "someoneElse"),
);

// startersOnly=false: the late-swap escape hatch — a committed starter HLTV now
// lists as BENCHED is still found so gather-roster can match by nickname.
const all = parseRosterStarters(md, false);
check("all: includes the BENCHED player", all.some((p) => p.nick === "Jimpphat" && p.rating === 1.1));
check("all: still section-isolated", !all.some((p) => p.nick === "someoneElse"));

// No table → [] (caller keeps the committed roster, never blanks it).
check("no section → []", parseRosterStarters("nothing relevant").length === 0);

// The profile-url helper is the one gather-roster writes into the core.
check(
  "hltvPlayerUrl shape",
  hltvPlayerUrl(11893, "zywoo") === "https://www.hltv.org/player/11893/zywoo",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
