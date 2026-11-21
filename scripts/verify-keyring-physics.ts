/**
 * verify-keyring-physics — offline proof for the PHA-5305 keyring toys.
 *
 * The keyring is a toy: charms hang on threads, can be picked up and thrown,
 * and knock into each other. The rules that must not drift:
 *   • a charm never hangs further from its anchor than its thread is long;
 *   • a charm left alone comes to rest hanging straight down;
 *   • a thrown charm keeps its momentum and still ends up on its thread;
 *   • two charms never end a step overlapping;
 *   • a charm held by a pointer is not moved by gravity or by contact;
 *   • nothing runs away: speed stays capped and the sim stays finite.
 *
 * Pure only (no React, no DOM). Run: node scripts/verify-keyring-physics.ts
 */

import {
  DEFAULT_PHYSICS,
  FIXED_DT,
  collide,
  charmTopLeft,
  enforceThread,
  makeBody,
  placeBody,
  step,
  throwBody,
  type KeyringBody,
} from "../src/components/keyring-physics.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function hang(b: KeyringBody, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step([b], FIXED_DT, DEFAULT_PHYSICS);
}

console.log("verify-keyring-physics");

// 0. The thread's physics point is the charm's hardware loop, not its art centre.
{
  const b = makeBody("a", 100, 40, 78, 34);
  const attachment = { x: 0.5, y: 0.16 };
  const topLeft = charmTopLeft(b, 124, 124, attachment);
  check(
    "hardware attachment stays pinned to the physics point",
    Math.abs(topLeft.x + 124 * attachment.x - b.x) < 0.001 && Math.abs(topLeft.y + 124 * attachment.y - b.y) < 0.001,
    `topLeft=(${topLeft.x.toFixed(2)},${topLeft.y.toFixed(2)})`,
  );
}

// 1. A charm hangs at exactly its thread length and stays there.
{
  const b = makeBody("a", 100, 40, 78, 34);
  hang(b, 3);
  const d = Math.hypot(b.x - b.ax, b.y - b.ay);
  check("hanging charm stays on its thread", Math.abs(d - 78) < 0.5, `d=${d.toFixed(2)}`);
  check("hanging charm settles below its anchor", b.y > b.ay, `y=${b.y.toFixed(2)} ay=${b.ay}`);
  check("hanging charm comes to rest", Math.hypot(b.x - b.ox, b.y - b.oy) < 0.6, `v=${Math.hypot(b.x - b.ox, b.y - b.oy).toFixed(3)}`);
}

// 2. A thrown charm travels, then lands back on its thread.
{
  const b = makeBody("b", 100, 40, 78, 34);
  b.grabbed = true;
  placeBody(b, 220, 40);
  b.vx = 900;
  b.vy = -200;
  throwBody(b, FIXED_DT);
  hang(b, 0.4);
  const moved = Math.abs(b.x - 100) > 20;
  check("thrown charm travels", moved, `x=${b.x.toFixed(2)}`);
  hang(b, 4);
  const d = Math.hypot(b.x - b.ax, b.y - b.ay);
  check("thrown charm ends on its thread", Math.abs(d - 78) < 1, `d=${d.toFixed(2)}`);
  check("thrown charm does not fall forever", Number.isFinite(b.y) && Math.abs(b.y) < 1000, `y=${b.y.toFixed(2)}`);
}

// 3. Two charms never stay overlapped.
{
  const a = makeBody("a", 60, 40, 78, 34);
  const b = makeBody("b", 160, 40, 78, 34);
  placeBody(a, 100, 100);
  placeBody(b, 104, 100);
  for (let i = 0; i < 240; i++) step([a, b], FIXED_DT, DEFAULT_PHYSICS);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  check("overlapping charms push apart", d >= 67.9, `d=${d.toFixed(2)}`);
  check("pushed charms stay on their threads", Math.abs(Math.hypot(a.x - a.ax, a.y - a.ay) - 78) < 1.5);
}

// 4. A charm the pointer holds is not moved by gravity or contact.
{
  const a = makeBody("a", 100, 40, 78, 34);
  const b = makeBody("b", 100, 40, 78, 34);
  a.grabbed = true;
  placeBody(a, 140, 120);
  placeBody(b, 142, 120);
  step([a, b], FIXED_DT, DEFAULT_PHYSICS);
  check("held charm does not move", Math.abs(a.x - 140) < 0.01 && Math.abs(a.y - 120) < 0.01, `x=${a.x.toFixed(2)}`);
  check("held charm is not shoved by contact", Math.abs(a.x - 140) < 0.01);
  check("the other charm takes the push", Math.abs(b.x - 142) > 0.5, `x=${b.x.toFixed(2)}`);
}

// 5. The sim stays finite and bounded under abuse (speed cap, no NaN).
{
  const bodies = [makeBody("a", 0, 0, 78, 34), makeBody("b", 200, 0, 78, 34), makeBody("c", 400, 0, 78, 34)];
  bodies.forEach((b, i) => {
    b.grabbed = true;
    placeBody(b, i * 40, 10);
    throwBody(b, FIXED_DT);
    b.vx = 99999;
    b.vy = -99999;
    throwBody(b, FIXED_DT);
  });
  for (let i = 0; i < 600; i++) step(bodies, FIXED_DT, DEFAULT_PHYSICS);
  const finite = bodies.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  const bounded = bodies.every((b) => Math.abs(b.x) < 1e4 && Math.abs(b.y) < 1e4);
  check("no NaN under abuse", finite);
  check("positions stay bounded", bounded);
}

// 6. The thread rule holds on its own, without the step loop.
{
  const b = makeBody("a", 0, 0, 50, 10);
  placeBody(b, 300, 0);
  enforceThread(b, DEFAULT_PHYSICS);
  check("thread pull snaps the charm back", Math.abs(Math.hypot(b.x - b.ax, b.y - b.ay) - 50) < 0.01);
  collide([b], DEFAULT_PHYSICS);
  check("collide on one body is a no-op", Number.isFinite(b.x));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nall keyring physics checks passed.");
