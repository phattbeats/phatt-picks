"use client";

import { useEffect, useState } from "react";

/**
 * Opt-in toggle for pre-lock push reminders (handoff §8.5). Best-effort and
 * self-contained: if push is unsupported, blocked, or unconfigured, it explains
 * why instead of breaking. iOS only exposes push once the PWA is installed and
 * launched from the home screen, so we surface that hint when it applies.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "blocked"
  | "idle" // supported, not subscribed
  | "subscribed";

const btn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  borderRadius: "var(--radius-md)",
  padding: "12px var(--space-4)",
  fontFamily: "'Rajdhani', sans-serif",
  fontWeight: 700,
  fontSize: "0.9375rem",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  minHeight: 44,
  cursor: "pointer",
  border: "none",
  width: "100%",
};

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const isIos =
    typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari legacy flag
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const res = await fetch("/api/push/public-key");
        const { key } = (await res.json()) as { key: string | null };
        if (cancelled) return;
        if (!key) {
          setState("unconfigured");
          return;
        }
        setVapidKey(key);
        if (Notification.permission === "denied") {
          setState("blocked");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setState(existing ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    if (!vapidKey) return;
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "idle");
        if (permission === "default") setNote("Allow notifications when prompted to turn reminders on.");
        return;
      }

      // Decode the server's VAPID key up front. A quote-wrapped/truncated key
      // (a known Unraid env gotcha) fails here — call it out clearly rather than
      // letting it surface as a generic "subscribe failed" later.
      let appServerKey: Uint8Array;
      try {
        appServerKey = urlBase64ToUint8Array(vapidKey);
      } catch {
        setNote("Reminders are misconfigured on the server (bad notification key). We're on it.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      // Subscribe. If a stale subscription with a different key already exists
      // (e.g. the server's VAPID key was rotated), the browser throws
      // InvalidStateError — drop the old one and try once more.
      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Uint8Array is a valid BufferSource at runtime; the cast sidesteps the
          // SharedArrayBuffer-vs-ArrayBuffer strictness in lib.dom.
          applicationServerKey: appServerKey as BufferSource,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "InvalidStateError") {
          const stale = await reg.pushManager.getSubscription();
          await stale?.unsubscribe().catch(() => {});
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey as BufferSource,
          });
        } else {
          throw err;
        }
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) {
        // Saving the subscription failed — surface why so it's diagnosable. 401
        // means the session lapsed (sign in again); anything else is a server error.
        throw new Error(res.status === 401 ? "your session expired — sign in again" : `server error ${res.status}`);
      }
      setState("subscribed");
      setNote("Reminders on. You'll get a 24-hour and 1-hour warning before each stage locks.");
    } catch (err) {
      // Include the concrete reason: the generic message hid real failures
      // (blocked push service, bad key, lapsed session) and made this unfixable.
      const reason =
        err instanceof DOMException ? err.name : err instanceof Error ? err.message : "unknown error";
      setNote(`Couldn't enable reminders (${reason}). Try again, or check notification settings.`);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("idle");
      setNote("Reminders off.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; sent?: number; reason?: string };
      if (data.ok && (data.sent ?? 0) > 0) setNote("Test reminder sent — check your notifications.");
      else if (data.reason === "push-not-configured") setNote("Push isn't configured on the server.");
      else setNote("No active device to send to. Re-enable reminders and try again.");
    } catch {
      setNote("Couldn't send the test reminder.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <p style={{ color: "var(--text-low)", fontSize: "0.8125rem" }}>Checking notifications…</p>;
  }
  if (state === "unsupported") {
    return (
      <p style={{ color: "var(--text-low)", fontSize: "0.8125rem" }}>
        This browser can&apos;t do push reminders.
        {isIos && !isStandalone && " On iPhone, add phaTT Picks to your Home Screen first."}
      </p>
    );
  }
  if (state === "unconfigured") {
    return (
      <p style={{ color: "var(--text-low)", fontSize: "0.8125rem" }}>
        Push reminders aren&apos;t set up on the server yet.
      </p>
    );
  }
  if (state === "blocked") {
    return (
      <p style={{ color: "var(--closing-soon)", fontSize: "0.8125rem" }}>
        Notifications are blocked. Enable them for this site in your browser settings, then reload.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {isIos && !isStandalone && (
        <p style={{ color: "var(--closing-soon)", fontSize: "0.8125rem", margin: 0 }}>
          iPhone: add to Home Screen and open from that icon first, or reminders won&apos;t arrive.
        </p>
      )}
      {state === "idle" ? (
        <button
          onClick={subscribe}
          disabled={busy}
          style={{ ...btn, background: "var(--accent)", color: "#fff", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Enabling…" : "Enable pre-lock reminders"}
        </button>
      ) : (
        <>
          <button
            onClick={sendTest}
            disabled={busy}
            style={{ ...btn, background: "var(--bg2)", border: "1px solid var(--info)", color: "var(--info)", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Working…" : "Send a test reminder"}
          </button>
          <button
            onClick={unsubscribe}
            disabled={busy}
            style={{ ...btn, background: "transparent", border: "1px solid var(--bg3)", color: "var(--text-mid)", opacity: busy ? 0.6 : 1 }}
          >
            Turn off reminders
          </button>
        </>
      )}
      {note && <p style={{ color: "var(--text-mid)", fontSize: "0.8125rem", margin: 0 }}>{note}</p>}
    </div>
  );
}
