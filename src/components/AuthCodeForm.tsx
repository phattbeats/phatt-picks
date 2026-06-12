"use client";

import { useState } from "react";

/**
 * Paste-and-save form for the Valve Game Authentication Code. Posts to
 * /api/auth/steam/authcode (M2), which encrypts it at rest. Only rendered for
 * signed-in Steam players; validates the 4-5-4 shape before sending.
 */

const AUTH_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;

export function AuthCodeForm({ initiallySet }: { initiallySet: boolean }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(initiallySet);
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
        setSaved(true);
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
      setSaved(false);
      setMsg("Auth code removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {saved && (
        <p style={{ color: "var(--correct)", fontSize: "0.8125rem", margin: 0 }}>
          ✓ An auth code is on file. You can replace it below.
        </p>
      )}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="ABCD-12345-WXYZ"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        style={{
          background: "var(--bg2)",
          border: `1px solid ${value && !valid ? "var(--accent)" : "var(--bg3)"}`,
          borderRadius: "var(--radius-md)",
          padding: "12px var(--space-3)",
          color: "var(--text-hi)",
          fontFamily: "monospace",
          fontSize: "1rem",
          letterSpacing: "0.1em",
          textAlign: "center",
          minHeight: 44,
        }}
      />
      <button
        onClick={save}
        disabled={!valid || busy}
        style={{
          background: valid ? "var(--accent)" : "var(--bg3)",
          color: valid ? "#fff" : "var(--text-low)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "12px",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 700,
          fontSize: "0.9375rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: valid && !busy ? "pointer" : "default",
          minHeight: 44,
        }}
      >
        {busy ? "Saving…" : saved ? "Replace code" : "Save code"}
      </button>
      {saved && (
        <button
          onClick={remove}
          disabled={busy}
          style={{
            background: "transparent",
            border: "1px solid var(--bg3)",
            color: "var(--text-mid)",
            borderRadius: "var(--radius-md)",
            padding: "10px",
            fontFamily: "'Rajdhani', sans-serif",
            fontWeight: 600,
            fontSize: "0.8125rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: "pointer",
            minHeight: 44,
          }}
        >
          Remove code
        </button>
      )}
      {msg && <p style={{ color: "var(--text-mid)", fontSize: "0.8125rem", margin: 0 }}>{msg}</p>}
    </div>
  );
}
