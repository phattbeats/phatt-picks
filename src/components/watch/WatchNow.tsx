import Image from "next/image";
import type { EventBrand } from "@/lib/event-brand";

/**
 * #942 — "Watch Now" band for the dashboard. Nudges players toward the
 * current Major's official broadcasts, the organiser's own channels from
 * event-brand.ts (ESL for Cologne, PGL for Singapore). YouTube leads, with
 * Twitch and Kick alongside it.
 *
 * Pure server component: brand glyphs are inlined SVG (simple-icons paths), the
 * event lockup is the official PNG given a white treatment so it reads on the
 * dark theme. No client JS — every tile is just an external link, new-tab.
 * Singapore skin: a hairline chapter; styles live in styles/sg-home.css.
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

const platforms = ({ youtube, twitch, kick }: EventBrand["streams"]): Platform[] => [
  {
    name: "YouTube",
    handle: `@${youtube}`,
    href: `https://www.youtube.com/@${youtube}`,
    color: "#FF0000",
    glyph: YouTubeGlyph,
  },
  {
    name: "Twitch",
    handle: `/${twitch}`,
    href: `https://www.twitch.tv/${twitch}`,
    color: "#9146FF",
    glyph: TwitchGlyph,
  },
  {
    name: "Kick",
    handle: `/${kick}`,
    href: `https://kick.com/${kick}`,
    color: "#53FC19",
    glyph: KickGlyph,
  },
];

export function WatchNow({ brand }: { brand: EventBrand }) {
  return (
    <section className="chap watch" aria-label="Watch the official streams">
      <div className="chap-h row2">
        <div>
          <h2>Watch it live</h2>
          <p>
            Catch every map on the official <b>{brand.broadcast}</b> broadcast.
          </p>
        </div>
        <Image
          src={brand.logo.src}
          alt={brand.logo.alt}
          width={brand.logo.width}
          height={brand.logo.height}
          className={`watch-logo${brand.logo.height > brand.logo.width ? " tall" : ""}`}
          priority={false}
        />
      </div>

      <div className="watch-grid">
        {platforms(brand.streams).map((p) => (
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
    </section>
  );
}
