"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CLUBHOUSE_AVATARS, clubhouseAvatarPath, clubhouseSlugFromUrl } from "@/lib/clubhouse-avatars";

/**
 * PHA-5341: the Clubhouse avatar grid in Settings → Identity, local players only.
 * Tap one to save it straight away; the photo upload beside it still works and
 * an uploaded photo stays until the player picks an avatar here.
 */
export function ClubhouseAvatarPicker({ currentAvatarUrl }: { currentAvatarUrl: string | null }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(clubhouseSlugFromUrl(currentAvatarUrl));
  const [prevUrl, setPrevUrl] = useState(currentAvatarUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // follow the server value after a refresh (e.g. a photo upload clears the selection)
  if (currentAvatarUrl !== prevUrl) {
    setPrevUrl(currentAvatarUrl);
    setChosen(clubhouseSlugFromUrl(currentAvatarUrl));
  }

  async function choose(slug: string) {
    if (busy || slug === chosen) return;
    setBusy(slug);
    setError(null);
    try {
      const res = await fetch("/api/avatar/clubhouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Could not save");
      setChosen(slug);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details id="avatar" className="nf-chav" open={!currentAvatarUrl || !!chosen || undefined}>
      <summary>
        Clubhouse avatars
        {error ? <span className="err"> · {error}</span> : busy ? <span> · Saving…</span> : null}
      </summary>
      <ul className="nf-chav-grid" role="list">
        {CLUBHOUSE_AVATARS.map((a) => (
          <li key={a.slug}>
            <button
              type="button"
              onClick={() => choose(a.slug)}
              disabled={!!busy}
              aria-pressed={chosen === a.slug}
              title={a.name}
              className={`nf-chav-opt${chosen === a.slug ? " on" : ""}${busy === a.slug ? " busy" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={clubhouseAvatarPath(a.slug, 64)} alt={a.name} width={56} height={56} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
