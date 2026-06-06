import Image from "next/image";

/**
 * PHA-942 — "Watch Now" band for the dashboard. Nudges players toward the
 * official IEM Cologne Major 2026 broadcasts (ESL's own channels). YouTube
 * leads, with Twitch and Kick alongside it. Channels verified live 2026-06-05
 * (ESLCS on all three).
 *
 * Pure server component: brand glyphs are inlined SVG (simple-icons paths), the
 * event lockup is the official PNG given a white treatment so it reads on the
 * dark theme. No client JS — every tile is just an external link, new-tab.
 */

type Platform = {
  name: string;
  handle: string;
  href: string;
  color: string;
  glyph: React.ReactNode;
};

// simple-icons brand paths (24×24 viewBox), official brand colors.
const TwitchGlyph = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="100%" height="100%">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
  </svg>
);
const YouTubeGlyph = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="100%" height="100%">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);
const KickGlyph = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="100%" height="100%">
    <path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z" />
  </svg>
);

const PLATFORMS: Platform[] = [
  {
    name: "YouTube",
    handle: "@ESLCS",
    href: "https://www.youtube.com/@ESLCS",
    color: "#FF0000",
    glyph: YouTubeGlyph,
  },
  {
    name: "Twitch",
    handle: "/eslcs",
    href: "https://www.twitch.tv/eslcs",
    color: "#9146FF",
    glyph: TwitchGlyph,
  },
  {
    name: "Kick",
    handle: "/eslcs",
    href: "https://kick.com/eslcs",
    color: "#53FC19",
    glyph: KickGlyph,
  },
];

export function WatchNow() {
  return (
    <section className="panel brk watch" aria-label="Watch the official streams">
      <span className="br-tr" />
      <span className="br-bl" />

      <div className="watch-head">
        <div>
          <div className="panel-title" style={{ marginBottom: 4 }}>
            [ Watch Live ]
          </div>
          <h2 className="font-display watch-title">Watch Now</h2>
          <p className="watch-sub">
            Catch every map on the official IEM Cologne Major 2026 broadcast.
          </p>
        </div>
        <Image
          src="/watch/iem-cologne.png"
          alt="Intel Extreme Masters · ESL Cologne Major 2026"
          width={1920}
          height={1013}
          className="watch-logo"
          priority={false}
        />
      </div>

      <div className="watch-grid">
        {PLATFORMS.map((p) => (
          <a
            key={p.name}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="watch-tile"
            style={{ ["--brand" as string]: p.color }}
          >
            <span className="watch-glyph">{p.glyph}</span>
            <span className="watch-meta">
              <span className="watch-name">{p.name}</span>
              <span className="watch-handle">{p.handle}</span>
            </span>
            <svg
              className="watch-go"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        ))}
      </div>

      <style>{`
        .watch-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }
        .watch-title {
          font-weight: 800;
          font-size: clamp(28px, 4.5vw, 40px);
          text-transform: uppercase;
          line-height: 0.92;
          letter-spacing: 0.01em;
          color: var(--ink-hi);
          margin: 0 0 6px;
        }
        .watch-sub {
          font-size: 14px;
          color: var(--ink-mid);
          margin: 0;
          max-width: 360px;
          text-wrap: pretty;
        }
        .watch-logo {
          height: 52px;
          width: auto;
          object-fit: contain;
          /* Official lockup is black+blue; flatten to white so it reads on dark. */
          filter: brightness(0) invert(1);
          opacity: 0.92;
          flex-shrink: 0;
        }
        .watch-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        @media (min-width: 640px) {
          .watch-grid { grid-template-columns: repeat(3, 1fr); }
        }
        .watch-tile {
          position: relative;
          display: flex;
          align-items: center;
          gap: 13px;
          padding: 15px 16px;
          background: var(--surf-1);
          border: 1px solid var(--hair-2);
          border-radius: var(--r-sm);
          text-decoration: none;
          color: var(--ink-hi);
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
        }
        .watch-tile:hover {
          border-color: var(--brand);
          background: var(--surf-2);
          transform: translateY(-2px);
        }
        .watch-glyph {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          color: var(--brand);
          flex-shrink: 0;
        }
        .watch-meta {
          display: flex;
          flex-direction: column;
          line-height: 1.15;
          min-width: 0;
        }
        .watch-name {
          font-weight: 700;
          font-size: 15px;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        .watch-handle {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--ink-mid);
        }
        .watch-go {
          width: 16px;
          height: 16px;
          margin-left: auto;
          color: var(--ink-low);
          flex-shrink: 0;
          transition: color 0.15s ease;
        }
        .watch-tile:hover .watch-go { color: var(--brand); }
      `}</style>
    </section>
  );
}
