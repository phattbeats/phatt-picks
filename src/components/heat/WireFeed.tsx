import { timeAgo, type WireItem } from "@/lib/news-core";

/**
 * Mockup-17 wire feed (PHA-857). Pure presentational server component: it takes
 * already-resolved WireItems plus a server-stamped `now`, computes the
 * "time-ago" string server-side and renders static markup — no "use client", so
 * there is no Date.now() SSR/hydration mismatch (the trap noted in PHA-856).
 *
 * `variant`:
 *   "full"    — /news, larger cards with image slot + summary.
 *   "compact" — dashboard Wire panel, dense rows, thumbnail slot, no summary.
 *
 * Empty state is the caller's concern (the /news page owns the rich "No signal
 * yet" panel); this component assumes `items.length > 0`.
 */
export function WireFeed({
  items,
  now,
  variant = "full",
}: {
  items: WireItem[];
  now: number;
  variant?: "full" | "compact";
}) {
  if (variant === "compact") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it) => (
          <WireRow key={it.externalId} item={it} now={now} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((it) => (
        <WireCard key={it.externalId} item={it} now={now} />
      ))}
    </div>
  );
}

function MetaLine({ item, now }: { item: WireItem; now: number }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)",
      fontSize: 9,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--heat)",
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      <span>{item.source}</span>
      <span style={{ color: "var(--ink-low)" }}>·</span>
      <span style={{ color: "var(--ink-mid)" }}>{timeAgo(item.publishedAt, now)}</span>
    </div>
  );
}

/** Framed image slot — renders the photo, or the mockup-17 placeholder frame. */
function ImageSlot({
  url,
  size,
}: {
  url: string | null;
  size: { w: number | string; h: number };
}) {
  return (
    <div
      className="brk"
      style={{
        position: "relative",
        flex: "none",
        width: size.w,
        height: size.h,
        background: url
          ? `center/cover no-repeat url(${JSON.stringify(url)})`
          : "linear-gradient(135deg, var(--surf-2), var(--surf-1))",
        border: "1px solid var(--hair-2)",
        overflow: "hidden",
      }}
    >
      <span className="br-tr" />
      <span className="br-bl" />
      {!url && (
        <span style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 8,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-low)",
        }}>
          [ WIRE ]
        </span>
      )}
    </div>
  );
}

function Wrapper({
  href,
  children,
  style,
}: {
  href: string | null;
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  const baseStyle = { textDecoration: "none", color: "inherit", ...style };
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={baseStyle}>
      {children}
    </a>
  ) : (
    <div style={baseStyle}>{children}</div>
  );
}

function WireCard({ item, now }: { item: WireItem; now: number }) {
  return (
    <Wrapper
      href={item.sourceUrl}
      style={{
        display: "flex",
        gap: 16,
        padding: 14,
        background: "var(--surf-1)",
        border: "1px solid var(--hair)",
      }}
    >
      <ImageSlot url={item.imageUrl} size={{ w: 116, h: 92 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
        <MetaLine item={item} now={now} />
        <h3 className="font-display" style={{
          fontWeight: 800,
          fontSize: 17,
          lineHeight: 1.15,
          color: "var(--ink-hi)",
          margin: 0,
          textWrap: "pretty",
        }}>
          {item.headline}
        </h3>
        {item.summary && (
          <p style={{
            color: "var(--ink-mid)",
            fontSize: 13,
            lineHeight: 1.5,
            margin: 0,
            textWrap: "pretty",
          }}>
            {item.summary}
          </p>
        )}
      </div>
    </Wrapper>
  );
}

function WireRow({ item, now }: { item: WireItem; now: number }) {
  return (
    <Wrapper
      href={item.sourceUrl}
      style={{
        display: "flex",
        gap: 11,
        alignItems: "center",
        padding: "9px 11px",
        background: "var(--surf-1)",
        border: "1px solid var(--hair)",
      }}
    >
      <ImageSlot url={item.imageUrl} size={{ w: 48, h: 40 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <MetaLine item={item} now={now} />
        <span className="font-display" style={{
          fontWeight: 700,
          fontSize: 13,
          lineHeight: 1.2,
          color: "var(--ink-hi)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {item.headline}
        </span>
      </div>
    </Wrapper>
  );
}
