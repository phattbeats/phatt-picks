#!/usr/bin/env node
// phaTT Picks :: Steam Pick'Em API probe (v2)
// ---------------------------------------------------------------------------
// Validates the whole premise against the LIVE IEM Cologne 2026 Pick'Em.
// Zero dependencies. Node 18+ (native fetch).
//
// WINDOWS / POWERSHELL — set vars then run (note: NOT the bash "VAR=val node" form):
//   $env:STEAM_API_KEY="your32charkey"
//   $env:STEAMID64="76561197995179865"
//   $env:STEAM_AUTH_CODE="AAAA-AAAAA-AAAA"
//   node probe.mjs
//
//   Optional: $env:EVENT_ID="27"   (skip scan, target one event)
//             $env:SCAN_FROM="18"; $env:SCAN_TO="45"
//             $env:ATTEMPT_WRITE="1"  (see WRITE EXPERIMENT block first)
//
// To clear a var later:  Remove-Item Env:\STEAM_API_KEY
// ---------------------------------------------------------------------------

const BASE = "https://api.steampowered.com/ICSGOTournaments_730";
const KEY = process.env.STEAM_API_KEY;
const STEAMID = process.env.STEAMID64;
const AUTH = process.env.STEAM_AUTH_CODE;
const EVENT_ID = process.env.EVENT_ID ? Number(process.env.EVENT_ID) : null;
const SCAN_FROM = Number(process.env.SCAN_FROM ?? 18);
const SCAN_TO = Number(process.env.SCAN_TO ?? 45);
const ATTEMPT_WRITE = process.env.ATTEMPT_WRITE === "1";

if (!KEY) {
  console.error("Missing STEAM_API_KEY. Set it with: $env:STEAM_API_KEY=\"...\"");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function explain(status) {
  return {
    400: "400 Bad Request — malformed params",
    401: "401 Unauthorized — key problem",
    403: "403 Forbidden — bad/missing auth code, or key not allowed for this call",
    404: "404 Not Found — event/section not open (or doesn't exist)",
    410: "410 Gone — picks for this matchup are locked (match started)",
    412: "412 Precondition Failed — pick conflicts with another bracket pick",
    429: "429 Too Many Requests — back off",
    503: "503 Service Unavailable — back off (often follows invalid auth-code spam)",
    504: "504 Gateway Timeout — backend slow; may have completed, re-query later",
  }[status];
}

// Pull an event's human name out of a layout result, however it's nested.
function eventName(result) {
  if (!result) return null;
  return (
    result?.tournament_event?.name ??
    result?.event_name ??
    result?.name ??
    result?.tournament?.name ??
    null
  );
}

async function call(method, params, { post = false } = {}) {
  const qs = new URLSearchParams({ key: KEY, ...(post ? {} : params) });
  const url = `${BASE}/${method}/v1/?${qs.toString()}`;
  const init = post
    ? { method: "POST", body: new URLSearchParams({ key: KEY, ...params }) }
    : { method: "GET" };
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

// --- 1. SCAN: find event IDs and PRINT THEIR NAMES (key-only, public) -------
async function scan() {
  console.log(`\n=== SCAN GetTournamentLayout, events ${SCAN_FROM}..${SCAN_TO} ===`);
  console.log("(read the NAMES — pick the one that says Cologne 2026, don't just trust highest ID)\n");
  const hits = [];
  for (let event = SCAN_FROM; event <= SCAN_TO; event++) {
    const { status, json } = await call("GetTournamentLayout", { event });
    const r = json?.result;
    const hasData = status === 200 && r && (r.sections?.length || eventName(r) || Object.keys(r || {}).length > 1);
    if (hasData) {
      const name = eventName(r) ?? `(unnamed — ${r?.sections?.length ?? "?"} sections)`;
      hits.push({ event, name });
      console.log(`  event ${String(event).padStart(2)} : DATA  → ${name}`);
    } else {
      console.log(`  event ${String(event).padStart(2)} : ${status}${explain(status) ? "  " + explain(status) : ""}`);
    }
    await sleep(250); // polite
  }
  return hits;
}

// --- 2. LAYOUT dump for one event -------------------------------------------
async function layout(event) {
  console.log(`\n=== GetTournamentLayout (event ${event}) ===`);
  const { status, json } = await call("GetTournamentLayout", { event });
  if (status !== 200) {
    console.log(`  ${status} ${explain(status) ?? ""}`);
    return null;
  }
  console.log("  name:", eventName(json?.result) ?? "(none found)");
  console.log("  --- raw structure (first 6000 chars) ---");
  console.log(JSON.stringify(json?.result ?? json, null, 2).slice(0, 6000));
  return json?.result ?? null;
}

// --- 3. ITEMS = the write-viability test ------------------------------------
async function items(event) {
  console.log(`\n=== GetTournamentItems (event ${event}) — WRITE-VIABILITY TEST ===`);
  if (!STEAMID || !AUTH) {
    console.log("  skipped: set STEAMID64 and STEAM_AUTH_CODE to run this");
    return;
  }
  const { status, json } = await call("GetTournamentItems", {
    event, steamid: STEAMID, steamidkey: AUTH,
  });
  if (status !== 200) {
    console.log(`  ${status} ${explain(status) ?? ""}`);
    if (status === 403) console.log("  -> auth code wrong/expired/not for this event.");
    if (status === 404) console.log("  -> Pick'Em not open for this event id, or wrong id.");
    return;
  }
  const root = json?.result ?? {};
  const arr = Array.isArray(root.items) ? root.items
            : Array.isArray(root) ? root
            : [];
  const teamItems = arr.filter((i) => i?.type === "team" || i?.groupid != null || i?.pickid != null);
  console.log(`  total items returned: ${arr.length}`);
  console.log(JSON.stringify(arr.slice(0, 8), null, 2));
  if (arr.length === 0) {
    console.log("\n  VERDICT: NO items. Either no Viewer Pass on this account, or the");
    console.log("  third-party key can't see them. Build read + LOCAL picks; write likely gated.");
  } else if (teamItems.length) {
    console.log(`\n  VERDICT: ${teamItems.length} lockable item(s) present.`);
    console.log("  WRITE PATH IS LIKELY VIABLE — note the itemid/groupid/pickid fields above.");
  } else {
    console.log("\n  VERDICT: items returned but none look like team picks — inspect the fields above.");
  }
}

// --- 4. PREDICTIONS: read current picks -------------------------------------
async function predictions(event) {
  console.log(`\n=== GetTournamentPredictions (event ${event}) ===`);
  if (!STEAMID || !AUTH) {
    console.log("  skipped: set STEAMID64 and STEAM_AUTH_CODE to run this");
    return;
  }
  const { status, json } = await call("GetTournamentPredictions", {
    event, steamid: STEAMID, steamidkey: AUTH,
  });
  if (status !== 200) {
    console.log(`  ${status} ${explain(status) ?? ""}`);
    return;
  }
  const picks = json?.result?.picks ?? json?.result ?? [];
  const n = Array.isArray(picks) ? picks.length : "(see raw)";
  console.log(`  picks on record: ${n}  (0 is fine — means you haven't picked yet)`);
  console.log(JSON.stringify(json?.result ?? json, null, 2).slice(0, 3000));
}

// --- 5. WRITE EXPERIMENT (opt-in) -------------------------------------------
// Swiss stages upload ALL of a stage's picks in ONE call (indexed params).
// Playoffs are a separate ordered call (QFs, then SFs, then Final).
// itemid is documented-required (sticker lock) but flagged questionable — test both ways.
// Build PICKS[] from the layout dump + items output, then $env:ATTEMPT_WRITE="1".
async function writeTest(event) {
  console.log(`\n=== UploadTournamentPredictions (event ${event}) — WRITE EXPERIMENT ===`);
  const PICKS = [
    // { sectionid: 15, groupid: 29, index: 0, pickid: 57, itemid: 429500386 },
  ];
  if (!PICKS.length) {
    console.log("  skipped: populate PICKS[] from the layout + items dumps first");
    return;
  }
  const body = { event, steamid: STEAMID, steamidkey: AUTH };
  if (PICKS.length === 1) {
    Object.assign(body, PICKS[0]);
  } else {
    PICKS.forEach((p, i) => {
      const n = i + 1;
      body[`sectionid${n}`] = p.sectionid;
      body[`groupid${n}`] = p.groupid;
      body[`index${n}`] = p.index;
      body[`pickid${n}`] = p.pickid;
      if (p.itemid != null) body[`itemid${n}`] = p.itemid;
    });
  }
  const { status, json } = await call("UploadTournamentPredictions", body, { post: true });
  console.log(`  status ${status} ${explain(status) ?? ""}`);
  console.log(JSON.stringify(json, null, 2));
  if (status === 200) {
    console.log("  -> WRITE WORKS. Re-read predictions to confirm; note any returned itemids.");
    console.log("  -> Then try once WITHOUT itemid to learn if it's still required.");
  }
}

// --- main -------------------------------------------------------------------
(async () => {
  let target = EVENT_ID;
  if (!target) {
    const hits = await scan();
    if (!hits.length) {
      console.log("\nNo events returned data. Widen the range: $env:SCAN_FROM/$env:SCAN_TO.");
      return;
    }
    // Prefer a hit whose name mentions Cologne; else fall back to highest id.
    const cologne = hits.find((h) => /cologne/i.test(h.name || ""));
    target = (cologne ?? hits[hits.length - 1]).event;
    console.log(`\n>> Targeting event ${target}` +
      (cologne ? " (matched 'Cologne' by name)" : " (highest id — CONFIRM the name above is right)"));
    console.log("   Override anytime with: $env:EVENT_ID=\"<id>\"");
  }

  await layout(target);
  await items(target);
  await predictions(target);
  if (ATTEMPT_WRITE) await writeTest(target);

  console.log("\nDone. If items + predictions returned 200 with data, the premise holds.");
})();
