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
 * Owner-only admin section embedded in /settings. Lists every local-only Player
 * (isLocal && !steamId), with pick count and last-activity, plus a confirm
 * delete button per row. See #854 for the cleanup motivation.
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
    <section className="sec" id="admin">
      <div className="chap-h">
        <span className="n">Admin</span>
        <h2>Local players</h2>
        <p>Guest accounts that never paired Steam. Delete cascades to their picks; the leaderboard recovers on its own.</p>
      </div>

      {state.kind === "loading" && <p className="muted nf-small">Loading…</p>}

      {state.kind === "error" && state.message !== "hidden" && (
        <p className="nf-err">Couldn&apos;t load: {state.message}</p>
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <p className="muted nf-small">No local players to clean up.</p>
      )}

      {state.kind === "ready" && state.rows.length > 0 && (
        <ul className="list nf-admin-list">
          {state.rows.map((row) => (
            <li key={row.id} className="row">
              <div className="nf-admin-who">
                <div className="t">{row.displayName}</div>
                <div className="s mono">
                  {row.pickCount} pick{row.pickCount === 1 ? "" : "s"} · last active {formatRelative(row.lastActivity)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(row)}
                disabled={deleting === row.id}
                className="btn-ghost nf-btn-sm nf-danger"
              >
                {deleting === row.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
