"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export type DirRow = {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  isLocal: boolean;
  synced: boolean;
  coinTier: string | null;
  score: number;
  isSelf: boolean;
  rank: number;
};

type Filter = "all" | "synced" | "local";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "synced", label: "Synced" },
  { key: "local", label: "Local" },
];

const SearchIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

export function UserDirectory({ rows, signedIn }: { rows: DirRow[]; signedIn: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "synced" && !(r.synced && !r.isLocal)) return false;
      if (filter === "local" && !r.isLocal) return false;
      if (q && !r.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, filter]);

  return (
    <>
      <div className="dir-search">
        {SearchIcon}
        <input
          className="dir-input"
          placeholder="SEARCH PLAYERS"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
      </div>

      <div className="dir-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`dir-filter${filter === f.key ? " active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="dir-list">
        {visible.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--ink-low)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            No players match
          </div>
        ) : (
          visible.map((r) => (
            <Link key={r.playerId} href={`/players/${encodeURIComponent(r.playerId)}`} className={`dir-row${r.isSelf ? " me" : ""}`}>
              <span className="dir-rk">{String(r.rank).padStart(2, "0")}</span>
              <span className="dir-av">
                {r.avatarUrl ? (
                  <Image src={r.avatarUrl} alt="" width={34} height={34} unoptimized style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                ) : (
                  r.displayName.slice(0, 2).toUpperCase()
                )}
              </span>
              <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-hi)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.displayName}
                </span>
                {r.isSelf && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", color: "var(--heat)", textTransform: "uppercase", flexShrink: 0 }}>you</span>
                )}
                {r.synced && !r.isLocal && (
                  <span className="synced-pill" style={{ flexShrink: 0 }}>Synced</span>
                )}
              </span>
              {r.coinTier ? (
                <span className={`coin-sticker ${r.coinTier}`} title={`${r.coinTier} coin`} />
              ) : (
                <span />
              )}
              <span className="dir-sc">{r.score}</span>
            </Link>
          ))
        )}
      </div>

      {!signedIn && (
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-low)", textAlign: "center", margin: "6px 0 0" }}>
          <Link href="/login/auth" style={{ color: "var(--heat)" }}>Sign in</Link> to compare picks
        </p>
      )}
    </>
  );
}
