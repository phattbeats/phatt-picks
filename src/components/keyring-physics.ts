/**
 * The keyring's toy physics (PHA-5305).
 *
 * Charms hang from the steel ring on threads. You can pick one up, swing it,
 * let go and watch it fall back and knock the others around. Pure module: no
 * React, no DOM, no timers — the component owns the frame loop, this owns the
 * math — so the rules can be proven offline (scripts/verify-keyring-physics.ts).
 *
 * Integration is Verlet: a body keeps its current position and its previous
 * position, and velocity is the difference between them. That makes the
 * constraints (thread length, charm-on-charm contact) easy to satisfy without
 * ever solving a velocity constraint.
 */

export interface KeyringBody {
  key: string;
  /** Charm center, in stage pixels. */
  x: number;
  y: number;
  /** Previous position (Verlet). */
  ox: number;
  oy: number;
  /** The point on the ring this charm hangs from. */
  ax: number;
  ay: number;
  /** Thread length: how far the charm may hang below its anchor. */
  len: number;
  /** Contact radius for charm-on-charm collisions. */
  r: number;
  /** True while a pointer holds this charm. */
  grabbed: boolean;
  /** Pointer speed in px/s, sampled while dragging; used for the throw. */
  vx: number;
  vy: number;
}

/**
 * Where a charm's hardware loop sits in its square artwork. The physics body
 * represents this point — never the visual centre of the plush/model — so a
 * thread visibly terminates at the charm's actual keyring hardware.
 */
export interface CharmAttachment {
  /** Fraction of the artwork width, from its left edge. */
  x: number;
  /** Fraction of the artwork height, from its top edge. */
  y: number;
}

/**
 * Top-left artwork position that puts its attachment point at the physics
 * body. Keeping this pure lets the visual contract be checked without a DOM.
 */
export function charmTopLeft(
  body: Pick<KeyringBody, "x" | "y">,
  width: number,
  height: number,
  attachment: CharmAttachment,
): { x: number; y: number } {
  return {
    x: body.x - width * attachment.x,
    y: body.y - height * attachment.y,
  };
}

export interface PhysicsOpts {
  /** px/s². */
  gravity: number;
  /** Per-step velocity keep (1 = no drag). */
  damping: number;
  /** Bounciness of charm-on-charm contact. */
  restitution: number;
  /** Hard speed cap, px/s. */
  maxSpeed: number;
}

export const DEFAULT_PHYSICS: PhysicsOpts = {
  gravity: 1750,
  damping: 0.9955,
  restitution: 0.45,
  maxSpeed: 2600,
};

/** Fixed step: the loop feeds this, so the sim never changes character with frame rate. */
export const FIXED_DT = 1 / 120;

/** A body hanging straight down from its anchor. */
export function makeBody(key: string, ax: number, ay: number, len: number, r: number): KeyringBody {
  return {
    key,
    x: ax,
    y: ay + len,
    ox: ax,
    oy: ay + len,
    ax,
    ay,
    len,
    r,
    grabbed: false,
    vx: 0,
    vy: 0,
  };
}

/** Move a charm to a point (a drag), keeping its anchor fixed. */
export function placeBody(body: KeyringBody, x: number, y: number): void {
  body.x = x;
  body.y = y;
}

/**
 * Give a released charm the velocity of the throw.
 *
 * The pointer samples are px/s; Verlet stores velocity as a per-step delta, so
 * the previous position is pushed back by exactly one step of travel.
 */
export function throwBody(body: KeyringBody, dt: number = FIXED_DT): void {
  body.grabbed = false;
  body.ox = body.x - body.vx * dt;
  body.oy = body.y - body.vy * dt;
  body.vx = 0;
  body.vy = 0;
}

/** One fixed step: integrate, then satisfy the thread and the contacts. */
export function step(bodies: KeyringBody[], dt: number = FIXED_DT, opts: PhysicsOpts = DEFAULT_PHYSICS): void {
  for (const b of bodies) {
    if (b.grabbed) {
      // A held charm is driven by the pointer; keep its velocity reading honest.
      b.ox = b.x;
      b.oy = b.y;
      continue;
    }
    let vx = (b.x - b.ox) * opts.damping;
    let vy = (b.y - b.oy) * opts.damping;
    const speed = Math.hypot(vx, vy);
    if (speed > opts.maxSpeed) {
      const k = opts.maxSpeed / speed;
      vx *= k;
      vy *= k;
    }
    b.ox = b.x;
    b.oy = b.y;
    b.x += vx;
    b.y += vy + opts.gravity * dt * dt;
  }

  for (const b of bodies) enforceThread(b, opts);
  collide(bodies, opts);
}

/** The thread: a charm may not hang further than its thread is long. */
export function enforceThread(b: KeyringBody, opts: PhysicsOpts = DEFAULT_PHYSICS): void {
  if (b.grabbed) return;
  const dx = b.x - b.ax;
  const dy = b.y - b.ay;
  const d = Math.hypot(dx, dy);
  if (d <= b.len || d === 0) return;

  const nx = dx / d;
  const ny = dy / d;

  // Velocity before the pull, split into radial (killed) and tangential (kept).
  const vx = b.x - b.ox;
  const vy = b.y - b.oy;
  const radial = vx * nx + vy * ny;
  const tvx = vx - radial * nx;
  const tvy = vy - radial * ny;

  b.x = b.ax + nx * b.len;
  b.y = b.ay + ny * b.len;
  // The thread absorbs the radial part: a swinging charm loses a little energy.
  b.ox = b.x - tvx;
  b.oy = b.y - tvy;
  void opts;
}

/** Charm on charm: push apart and swap the normal component of the velocity. */
export function collide(bodies: KeyringBody[], opts: PhysicsOpts = DEFAULT_PHYSICS): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d === 0 || d >= min) continue;

      const nx = dx / d;
      const ny = dy / d;
      const overlap = (min - d) / 2;

      // A held charm does not get shoved aside; the other one takes the hit.
      const aFixed = a.grabbed;
      const bFixed = b.grabbed;
      if (aFixed && bFixed) continue;

      const push = aFixed ? 1 : bFixed ? -1 : 1;
      const move = overlap * push;
      if (!aFixed) {
        a.x -= nx * move;
        a.y -= ny * move;
      }
      if (!bFixed) {
        b.x += nx * move;
        b.y += ny * move;
      }

      // Velocity along the contact normal, with restitution.
      const avx = a.x - a.ox;
      const avy = a.y - a.oy;
      const bvx = b.x - b.ox;
      const bvy = b.y - b.oy;
      const rel = (bvx - avx) * nx + (bvy - avy) * ny;
      if (rel >= 0) continue; // already separating

      const impulse = (-(1 + opts.restitution) * rel) / 2;
      const ix = nx * impulse;
      const iy = ny * impulse;
      if (!aFixed) {
        a.ox -= ix;
        a.oy -= iy;
      }
      if (!bFixed) {
        b.ox += ix;
        b.oy += iy;
      }
    }
  }
}

/** The angle a charm hangs at, in radians, for drawing its thread. */
export function threadAngle(b: KeyringBody): number {
  return Math.atan2(b.y - b.ay, b.x - b.ax);
}
