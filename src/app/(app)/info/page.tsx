import Link from "next/link";

export const metadata = { title: "Info · HOTLINE" };

/**
 * INFO (PHA-1283) — help & guides get their own home. The links used to be
 * folded into Settings, where most people never opened them; pulled out to a
 * first-class page so "how does this work?" has somewhere obvious to land. On
 * desktop it's a top-nav tab; on mobile it's reached from your profile and the
 * settings page (the bottom nav stays at five tabs — see the ticket note).
 */

type Guide = {
  href: string;
  title: string;
  blurb: string;
};

const GUIDES: Guide[] = [
  {
    href: "/how-to-play",
    title: "How it works",
    blurb: "New to Pick'Em? The whole thing, in plain language — what it is and what you actually do.",
  },
  {
    href: "/faq",
    title: "FAQ",
    blurb: "Scoring, Swiss buckets, the Viewer Pass, and the questions that come up most.",
  },
  {
    href: "/help/auth-code",
    title: "Steam sync & the auth code",
    blurb: "How linking Steam works, and where to find the auth code when you need it.",
  },
  {
    href: "/players",
    title: "Player directory",
    blurb: "Everyone playing this Major — tap through to any profile and their picks.",
  },
  {
    href: "/pwa",
    title: "Install HOTLINE",
    blurb: "Add it to your home screen so it opens like an app and notifications work.",
  },
];

export default function InfoPage() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="eyebrow-mono">INFO</span>
        <h1 className="font-display" style={{
          fontWeight: 800,
          fontSize: "clamp(28px, 5vw, 40px)",
          textTransform: "uppercase",
          lineHeight: 0.95,
        }}>
          Help &amp; guides
        </h1>
        <p style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Everything about how HOTLINE works — pick one to dig in.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {GUIDES.map((g) => (
          <Link
            key={g.href}
            href={g.href}
            className="brk"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              background: "var(--surf-1)",
              border: "1px solid var(--hair-2)",
              padding: "16px 18px",
              textDecoration: "none",
            }}
          >
            <span className="br-tr" />
            <span className="br-bl" />
            <span style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--ink-hi)" }}>
                {g.title}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-mid)" }}>
                {g.blurb}
              </span>
            </span>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--ink-mid)", flexShrink: 0 }} aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        ))}
      </div>
    </>
  );
}
