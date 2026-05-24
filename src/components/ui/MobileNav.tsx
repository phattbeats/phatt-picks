"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "⬡" },
  { href: "/picks", label: "Picks", icon: "◈" },
  { href: "/leaderboard", label: "Ranks", icon: "◆" },
  { href: "/news", label: "News", icon: "◉" },
  { href: "/profile", label: "You", icon: "◎" },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "72px",
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--bg1)",
        borderTop: "1px solid var(--bg3)",
        display: "flex",
        zIndex: 100,
      }}
    >
      {NAV_ITEMS.map(({ href, label, icon }) => {
        const active = pathname === href || (href !== "/" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "2px",
              textDecoration: "none",
              color: active ? "var(--accent)" : "var(--text-low)",
              minHeight: "44px",
              transition: `color var(--duration-fast) var(--ease-sharp)`,
            }}
          >
            <span style={{ fontSize: "1.25rem" }}>{icon}</span>
            <span
              style={{
                fontFamily: "'Rajdhani', sans-serif",
                fontSize: "0.625rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
