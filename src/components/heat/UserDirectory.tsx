"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { coinArtSrc, type ChallengeCoin } from "@/lib/challenge-coin-core";

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
  /** Finish at the last concluded Major, e.g. "Cologne 3rd". */
  lastMajor?: string | null;
  /** Challenge coin from the last concluded Major (synced players only). */
  challengeCoin?: ChallengeCoin | null;
};

type Filter = "all" | "synced" | "local";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "synced", label: "Synced" },
  { key: "local", label: "Local" },
];

function matches(r: DirRow, filter: Filter): boolean {
  if (filter === "synced") return r.synced && !r.isLocal;
  if (filter === "local") return r.isLocal;
  return true;
}

export function UserDirectory({ rows, signedIn }: { rows: DirRow[]; signedIn: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      synced: rows.filter((r) => matches(r, "synced")).length,
      local: rows.filter((r) => matches(r, "local")).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matches(r, filter)) return false;
      if (q && !r.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, filter]);

  return (
    <>
      <div className="pp-dir-bar">
        <div className="tabs" role="group" aria-label="Filter players">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? "on" : undefined}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} {counts[f.key]}
            </button>
          ))}
        </div>
        <input
          className="pp-search"
          type="search"
          placeholder="Find a player"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
      </div>

      <div className="pp-dir-list">
        {visible.length === 0 ? (
          <div className="pp-empty">No players match</div>
        ) : (
          visible.map((r) => (
            <Link
              key={r.playerId}
              href={`/players/${encodeURIComponent(r.playerId)}`}
              prefetch={false}
              className={`pp-dir-row${r.isSelf ? " me" : ""}`}
            >
              <span className="pp-dir-rk">{String(r.rank).padStart(2, "0")}</span>
              <span className="av pp-dir-av">
                {r.avatarUrl ? (
                  <Image src={r.avatarUrl} alt="" width={40} height={40} unoptimized />
                ) : (
                  r.displayName.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="pp-dir-who">
                <span className="pp-dir-nm">
                  <span className="pp-dir-name">{r.displayName}</span>
                  {r.isSelf && <span className="pp-you">You</span>}
                  {r.synced && !r.isLocal && <span className="sync">Synced</span>}
                  {r.coinTier && <span className={`coin-sticker ${r.coinTier}`} title={`${r.coinTier} coin`} />}
                </span>
                {r.lastMajor && <span className="pp-dir-m">{r.lastMajor}</span>}
              </span>
              <span className="pp-dir-coin">
                {r.challengeCoin && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coinArtSrc(r.challengeCoin.slug, r.challengeCoin.tier)}
                    alt={`${r.challengeCoin.name} coin, ${r.challengeCoin.tier}`}
                    title={`${r.challengeCoin.tier} coin`}
                    width={36}
                    height={36}
                    loading="lazy"
                  />
                )}
              </span>
              <span className="pp-dir-sc">
                {r.score}
                <small>pts</small>
              </span>
              <span className="pp-dir-go" aria-hidden="true">{r.isSelf ? "Profile" : "View →"}</span>
            </Link>
          ))
        )}
      </div>

      {!signedIn && (
        <p className="pp-note">
          <Link href="/login" prefetch={false}>Sign in</Link> to compare picks
        </p>
      )}
    </>
  );
}
