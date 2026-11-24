/**
 * verify-authcode-check — what a Valve answer means for a freshly pasted auth code.
 *
 * "The fighter" had a code on file with a green check that Valve answered 403 for
 * on every call, so each sync failed. Saving only checked the 4-5-4 shape; nothing
 * ever asked Valve. This pins the rule the save route now follows: only a 403
 * rejects a code; an outage, a 429, a 5xx or a closed Pick'Em saves it and says it
 * could not be checked; and the green line can show a rejected code in red.
 *
 * Run: node --experimental-strip-types --import ./register-ts-resolve.mjs scripts/verify-authcode-check.ts
 */
import { answerForCheck, classifyCodeCheck, codeState } from "../src/lib/authcode-check-core.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name + (detail ? `  (${detail})` : "")); }
};

console.log("\n[1] only a 403 rejects a code");
check("200 accepts", classifyCodeCheck(200).verdict === "accepted");
check("403 rejects", classifyCodeCheck(403).verdict === "rejected");
for (const s of [429, 500, 502, 503, 504]) {
  check(`${s} is unchecked (Valve trouble, not a bad code)`, classifyCodeCheck(s).verdict === "unchecked");
}
check("404 is unchecked, reason pickem-not-open", (() => { const c = classifyCodeCheck(404); return c.verdict === "unchecked" && c.reason === "pickem-not-open"; })());
check("a thrown network/timeout error is unchecked", classifyCodeCheck(null).verdict === "unchecked");
check("an unknown 4xx (e.g. 418) does not reject", classifyCodeCheck(418).verdict === "unchecked");

console.log("\n[2] the save answer");
const rej = answerForCheck({ verdict: "rejected" });
check("rejected: refused, not stored, error code_rejected", rej.httpStatus === 422 && !rej.store && rej.body.error === "code_rejected" && rej.body.ok === false);
const unc = answerForCheck(classifyCodeCheck(503));
check("outage: saved, ok, and says it could not be checked", unc.httpStatus === 200 && unc.store && unc.body.ok && unc.body.check === "unchecked");
const acc = answerForCheck({ verdict: "accepted" });
check("accepted: saved, ok", acc.httpStatus === 200 && acc.store && acc.body.check === "accepted");
check("a rejected code never reaches the database (store false)", rej.store === false);

console.log("\n[3] the green line");
check("no code is none", codeState({ hasCode: false, savedForCurrentEvent: false, valveRejected: false }) === "none");
check("a code for an earlier Major is stale", codeState({ hasCode: true, savedForCurrentEvent: false, valveRejected: false }) === "stale");
check("a code for this Major that Valve has not refused is current", codeState({ hasCode: true, savedForCurrentEvent: true, valveRejected: false }) === "current");
check("a code for this Major that Valve refused is rejected, not green", codeState({ hasCode: true, savedForCurrentEvent: true, valveRejected: true }) === "rejected");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
