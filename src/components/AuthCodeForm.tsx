"use client";

import { useState } from "react";

/**
 * Paste-and-save form for the Valve Game Authentication Code. Posts to
 * /api/auth/steam/authcode (M2), which encrypts it at rest and records the
 * Major it was saved for. Only rendered for signed-in Steam players; validates
 * the 4-5-4 shape before sending. A code saved for an earlier Major shows as
 * stale (sync waits until Valve accepts it for this Major) and asks for this Major's.
 * Styled by `.sg-authform` in sg-auth.css.
 */

const AUTH_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;

export function AuthCodeForm({
  initialStatus,
  majorName,
  staleFor,
}: {
  initialStatus: "none" | "current" | "stale" | "rejected";
  majorName: string;
  /** The Major a stale code was saved for, e.g. "IEM Cologne 2026". */
  staleFor: string | null;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const saved = status !== "none";
  const [unchecked, setUnchecked] = useState(false);
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
        check?: "accepted" | "unchecked" | "rejected";
      };
      if (res.status === 422 && data.error === "code_rejected") {
        // Valve answered 403 for this code. Nothing was saved; keep what was there.
        setMsg(`Steam didn't accept that code for ${majorName}. Copy it again from Steam (all 14 characters, with dashes) and paste it here.`);
      } else if (res.ok && data.ok) {
        setStatus("current");
        setValue("");
        setUnchecked(data.check === "unchecked");
        if (data.check === "unchecked") {
          setMsg("Saved, but Steam can't confirm it yet (Pick'Em isn't open or Steam is busy). We'll check it when you sync.");
        } else if (data.mirrorOk && (data.mirrored ?? 0) > 0) {
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
      {status === "current" && !unchecked && (
        <p className="saved">✓ Your {majorName} code is on file. You can replace it below.</p>
      )}
      {status === "current" && unchecked && (
        <p className="stale">Your {majorName} code is on file, but Steam hasn&apos;t confirmed it yet. You can replace it below.</p>
      )}
      {status === "rejected" && (
        <p className="stale">
          {`Steam didn't accept the ${majorName} code on file, so syncing is paused. Copy a fresh code from Steam and paste it below.`}
        </p>
      )}
      {status === "stale" && (
        <p className="stale">
          {`Your code on file is from ${staleFor ?? "an earlier Major"}. If Steam gave you a new code for ${majorName}, paste it here. Otherwise, when Pick'Em opens, HOTLINE asks Valve once whether your old code still works: if it does, syncing carries on; if not, syncing stays paused until you paste a new one.`}
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
        {busy ? "Saving…" : status === "current" || status === "rejected" ? "Replace code" : status === "stale" ? `Save ${majorName} code` : "Save code"}
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
