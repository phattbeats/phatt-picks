"use client";

import { useEffect, useState } from "react";

interface LocalPlayerRow {
  id: string;
  displayName: string;
  pickCount: number;
  createdAt: string;
  lastActivity: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; rows: LocalPlayerRow[] }
  | { kind: "error"; message: string };

/**
 * Owner-only admin section embedded in /profile. Lists every local-only Player
 * (isLocal && !steamId), with pick count and last-activity, plus a confirm
 * delete button per row. See PHA-854 for the cleanup motivation.
 *
 * Rendered unconditionally; the API gates by OWNER_STEAM_ID and returns 403
 * for non-owners — at which point the component shows nothing.
 */
export function AdminLocalPlayers() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [deleting, setDeleting] = useState<string | null>(null);

  async function fetchRows(): Promise<LoadState> {
    try {
      const res = await fetch("/api/players/local", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) return { kind: "error", message: "hidden" };
      if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` };
      const data = (await res.json()) as { players: LocalPlayerRow[] };
      return { kind: "ready", rows: data.players };
    } catch (err) {
      return { kind: "error", message: String(err) };
    }
  }

  async function reload() {
    setState({ kind: "loading" });
    setState(await fetchRows());
  }

  useEffect(() => {
    let cancelled = false;
    fetchRows().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDelete(row: LocalPlayerRow) {
    const msg = `Delete "${row.displayName}"?\n\n${row.pickCount} pick${row.pickCount === 1 ? "" : "s"} will be wiped. This cannot be undone.`;
    if (!confirm(msg)) return;
    setDeleting(row.id);
    try {
      const res = await fetch(`/api/players/local/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        alert(`Delete failed: ${body.message ?? body.error ?? res.statusText}`);
        return;
      }
      await reload();
    } finally {
      setDeleting(null);
    }
  }

  // Non-owner sessions get 403 → render nothing (the section is invisible).
  if (state.kind === "error" && state.message === "hidden") return null;

  return (
    <div
      style={{
        background: "var(--bg1)",
        border: "1px solid var(--bg3)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <p
        style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-low)",
          margin: 0,
        }}
      >
        Admin · Local players
      </p>
      <p style={{ color: "var(--text-mid)", fontSize: "0.8125rem", margin: 0, lineHeight: 1.4 }}>
        Guest accounts that never paired Steam. Delete cascades to their picks; leaderboard auto-recovers.
      </p>

      {state.kind === "loading" && (
        <p style={{ color: "var(--text-low)", fontSize: "0.8125rem", margin: 0 }}>Loading…</p>
      )}

      {state.kind === "error" && state.message !== "hidden" && (
        <p style={{ color: "var(--danger, #c33)", fontSize: "0.8125rem", margin: 0 }}>
          Couldn&apos;t load: {state.message}
        </p>
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <p style={{ color: "var(--text-low)", fontSize: "0.8125rem", margin: 0 }}>
          No local players to clean up.
        </p>
      )}

      {state.kind === "ready" && state.rows.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {state.rows.map((row) => (
            <li
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-2)",
                background: "var(--bg2)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ color: "var(--text-hi)", fontSize: "0.9375rem", fontWeight: 600, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.displayName}
                </p>
                <p style={{ color: "var(--text-low)", fontSize: "0.75rem", margin: "2px 0 0" }}>
                  {row.pickCount} pick{row.pickCount === 1 ? "" : "s"} · last active {formatRelative(row.lastActivity)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(row)}
                disabled={deleting === row.id}
                style={{
                  background: "transparent",
                  border: "1px solid var(--bg3)",
                  color: "var(--danger, #c33)",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 12px",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  minHeight: 32,
                  cursor: deleting === row.id ? "wait" : "pointer",
                  opacity: deleting === row.id ? 0.6 : 1,
                }}
              >
                {deleting === row.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
