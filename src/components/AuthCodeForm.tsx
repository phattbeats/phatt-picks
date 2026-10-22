"use client";

import { useState } from "react";

/**
 * Paste-and-save form for the Valve Game Authentication Code. Posts to
 * /api/auth/steam/authcode (M2), which encrypts it at rest and records the
 * Major it was saved for. Only rendered for signed-in Steam players; validates
 * the 4-5-4 shape before sending. A code saved for an earlier Major shows as
 * stale (each Major needs its own code; sync pauses) and asks for this Major's.
 * Styled by `.sg-authform` in sg-auth.css.
 */

const AUTH_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;

export function AuthCodeForm({
  initialStatus,
  majorName,
  staleFor,
}: {
  initialStatus: "none" | "current" | "stale";
  majorName: string;
  /** The Major a stale code was saved for, e.g. "IEM Cologne 2026". */
  staleFor: string | null;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const saved = status !== "none";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const normalized = value.trim().toUpperCase();
  const valid = AUTH_CODE_RE.test(normalized);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/steam/authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authCode: normalized }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        mirrored?: number;
        mirrorOk?: boolean;
      };
      if (res.ok && data.ok) {
        setStatus("current");
        setValue("");
        if (data.mirrorOk && (data.mirrored ?? 0) > 0) {
          setMsg(`Saved. Imported ${data.mirrored} pick${data.mirrored === 1 ? "" : "s"} from Steam.`);
        } else if (data.mirrorOk) {
          setMsg("Saved. No existing picks on Steam yet — start picking on /picks.");
        } else {
          setMsg("Saved. Couldn't pull existing picks from Steam right now; we'll retry on your next /picks visit.");
        }
      } else if (data.error === "steam_account_required") {
        setMsg("Sign in with Steam first — local players don't need a code.");
      } else {
        setMsg("That didn't look like a valid code. Check the 4-5-4 format and retry.");
      }
    } catch {
      setMsg("Couldn't save right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(null);
    try {
      await fetch("/api/auth/steam/authcode", { method: "DELETE" });
      setStatus("none");
      setMsg("Auth code removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sg-authform">
      {status === "current" && (
        <p className="saved">✓ Your {majorName} code is on file. You can replace it below.</p>
      )}
      {status === "stale" && (
        <p className="stale">
          {`Your code on file is from ${staleFor ?? "an earlier Major"}. Each Major needs its own code, so syncing is paused until you paste your ${majorName} code.`}
        </p>
      )}
      <div className="field">
        <label htmlFor="authCode">Paste your code</label>
        <input
          id="authCode"
          className={`input code${value && !valid ? " is-bad" : ""}`}
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(value && !valid)}
        />
      </div>
      <span className="hint">Format 4–5–4, with dashes</span>
      <button type="button" className="btn-solid" onClick={save} disabled={!valid || busy}>
        {busy ? "Saving…" : status === "current" ? "Replace code" : status === "stale" ? `Save ${majorName} code` : "Save code"}
      </button>
      {saved && (
        <button type="button" className="btn-ghost" onClick={remove} disabled={busy}>
          Remove code
        </button>
      )}
      {msg && (
        <p className="msg" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
