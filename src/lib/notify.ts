/**
 * notify.ts — SERVER-ONLY Web Push transport (handoff §8.5).
 *
 * web-push + VAPID. Per-user subscriptions live in the DB (PushSubscription).
 * Pure scheduling/payload logic is in notify-core. Push is best-effort and must
 * never block or break core flows: every send is wrapped, dead subs are pruned,
 * and a missing VAPID config degrades to a no-op (isPushConfigured() === false).
 */

// Server-only: imported solely by API route handlers. web-push + prisma never reach the client.
import webpush, { WebPushError } from "web-push";
import { prisma } from "@/lib/db";
import { buildPreLockPayload, type PreLockPayload } from "@/lib/notify-core";

const PLACEHOLDERS = new Set(["", "dev", "REPLACE_ME"]);

function configured(): { subject: string; publicKey: string; privateKey: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@phatt.tech";
  if (PLACEHOLDERS.has(publicKey) || PLACEHOLDERS.has(privateKey)) return null;
  return { subject, publicKey, privateKey };
}

/** True when real VAPID keys are present; gates push UI + sends. */
export function isPushConfigured(): boolean {
  return configured() !== null;
}

/** The client needs the public key to subscribe. Null when push is disabled. */
export function getVapidPublicKey(): string | null {
  return configured()?.publicKey ?? null;
}

let vapidReady = false;
function ensureVapid(): boolean {
  const cfg = configured();
  if (!cfg) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidReady = true;
  }
  return true;
}

export interface SendOutcome {
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Send a payload to every subscription a player owns. Prunes subscriptions the
 * push service reports as gone (404/410). Never throws.
 */
export async function sendPushToPlayer(playerId: string, payload: PreLockPayload): Promise<SendOutcome> {
  const outcome: SendOutcome = { sent: 0, failed: 0, pruned: 0 };
  if (!ensureVapid()) return outcome;

  const subs = await prisma.pushSubscription.findMany({ where: { playerId } });
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    let keys: { p256dh: string; auth: string };
    try {
      keys = JSON.parse(sub.keys);
    } catch {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      outcome.pruned++;
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys }, body);
      outcome.sent++;
    } catch (err) {
      const status = err instanceof WebPushError ? err.statusCode : 0;
      if (status === 404 || status === 410) {
        // Subscription expired/unsubscribed — drop it so we stop retrying.
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        outcome.pruned++;
      } else {
        outcome.failed++;
      }
    }
  }
  return outcome;
}

/**
 * Send a sample pre-lock reminder to the current user — proves the opt-in →
 * delivery path end to end (DoD: "an opted-in user receives a test pre-lock push").
 */
export async function sendTestPreLockPush(playerId: string): Promise<SendOutcome> {
  const now = Date.now();
  const payload = buildPreLockPayload({
    stageName: "Stage I",
    lockAtMs: now + 60 * 60 * 1000, // 1 hour out → "locks in 1 hour"
    nowMs: now,
    url: "/picks",
  });
  payload.body = `Test reminder — ${payload.body}`;
  return sendPushToPlayer(playerId, payload);
}
