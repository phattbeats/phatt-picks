"use client";

import { useEffect, useState } from "react";

/**
 * The signed-in user's shareable invite link (Singapore skin: a mono link
 * field + flat buttons).
 *
 * Share is the primary action — the native share sheet is the word-of-mouth
 * engine on mobile; copy is the desktop/manual fallback. Client-side so
 * /settings stays read-only on render (the code is minted lazily by the API on
 * first call).
 */
const SHARE_TEXT =
  "I'm calling the CS2 Major on HOTLINE — pick who goes 3-0, who busts, who lifts at PGL Major Singapore 2026. Get in:";

export function InviteLink() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/invite")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { url: string }) => {
        if (!cancelled) setUrl(d.url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — the field is selectable as a fallback
    }
  }

  async function share() {
    if (!url) return;
    const nav = navigator as Navigator & {
      share?: (d: { title: string; text: string; url: string }) => Promise<void>;
    };
    if (nav.share) {
      await nav.share({ title: "HOTLINE", text: SHARE_TEXT, url }).catch(() => {});
    } else {
      copy();
    }
  }

  if (error) {
    return <p className="nf-err">Couldn&apos;t load your invite link. Reload to retry.</p>;
  }

  return (
    <div className="nf-inv">
      <input
        readOnly
        className="nf-code"
        aria-label="Your invite link"
        value={url ?? "Generating link…"}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" onClick={copy} disabled={!url} className={`btn-solid${copied ? " is-copied" : ""}`}>
        {copied ? "Copied" : "Copy link"}
      </button>
      {/* Native share — the word-of-mouth driver on mobile. */}
      <button type="button" onClick={share} disabled={!url} className="btn-ghost">
        Share invite
      </button>
    </div>
  );
}
