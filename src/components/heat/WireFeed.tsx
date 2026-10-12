/* eslint-disable @next/next/no-img-element -- wire images are arbitrary external (RSS) URLs, validated by safeHttpUrl; next/image would need a remotePatterns allowlist. */

import { safeHttpUrl, timeAgo, type WireItem } from "@/lib/news-core";

/**
 * Wire feed (#857), Singapore skin (prototype 13). Pure presentational server
 * component: it takes already-resolved WireItems plus a server-stamped `now`,
 * computes the "time-ago" string server-side and renders static markup — no
 * "use client", so there is no Date.now() SSR/hydration mismatch (the trap
 * noted in #856).
 *
 * `variant`:
 *   "full"    — /news: the newest story as a full-bleed lead, the next two as
 *               photo cards ("Also breaking"), the rest as a hairline list.
 *   "compact" — dashboard Wire panel: dense hairline rows with a thumbnail.
 *
 * Empty state is the caller's concern (the /news page owns it); this component
 * assumes `items.length > 0`.
 *
 * Items without an image fall back to a stock Major photo (decorative only —
 * it never stands in for the story's own art), credited like every other
 * /public/wrapped still.
 */

const FALLBACK_PHOTOS = [
  "/wrapped/major-cathedral.jpg",
  "/wrapped/major-donk.jpg",
  "/wrapped/major-nations.jpg",
];

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
      <div className="sgc-wire-compact">
        {items.map((it) => (
          <WireRow key={it.externalId} item={it} now={now} />
        ))}
      </div>
    );
  }

  const [lead, ...rest] = items;
  const also = rest.slice(0, 2);
  const wire = rest.slice(2);

  return (
    <>
      <Lead item={lead} now={now} />
      {also.length > 0 && (
        <section className="chap">
          <div className="chap-h"><h2>Also breaking</h2></div>
          <div className="sgc-lead">
            {also.map((it, i) => (
              <AlsoCard key={it.externalId} item={it} now={now} fallback={FALLBACK_PHOTOS[(i + 1) % FALLBACK_PHOTOS.length]} />
            ))}
          </div>
        </section>
      )}
      {wire.length > 0 && (
        <section className="chap">
          <div className="chap-h"><h2>The wire</h2></div>
          <div className="sgc-wire">
            {wire.map((it) => (
              <WireLine key={it.externalId} item={it} now={now} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function meta(item: WireItem, now: number): string {
  return `${item.source} · ${timeAgo(item.publishedAt, now)}`;
}

/**
 * Link or non-link wrapper. Sink-side scheme guard (defense-in-depth): React
 * renders a javascript: href verbatim, so validate the scheme at the actual
 * sink, not just at ingest. A hostile/unsupported scheme falls back to a
 * non-link <div>. (#860)
 */
function Wrapper({
  href,
  className,
  children,
}: {
  href: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const safeHref = safeHttpUrl(href);
  return safeHref ? (
    <a href={safeHref} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

function Lead({ item, now }: { item: WireItem; now: number }) {
  // Sink-side scheme guard on the image too (#860).
  const img = safeHttpUrl(item.imageUrl);
  const href = safeHttpUrl(item.sourceUrl);
  return (
    <section className="bleed sgc-news-hero">
      <img src={img ?? FALLBACK_PHOTOS[0]} alt="" />
      {!img && <span className="credit">Photo · HLTV</span>}
      <div className="in">
        <span className="eyebrow rise">
          The wire · <b>{meta(item, now)}</b>
        </span>
        <h1 className="display rise d1">{item.headline}</h1>
        {item.summary && <p className="rise d2">{item.summary}</p>}
        {href && (
          <a className="btn-ghost rise d3" href={href} target="_blank" rel="noopener noreferrer">
            Read on {item.source} ↗
          </a>
        )}
      </div>
    </section>
  );
}

function AlsoCard({ item, now, fallback }: { item: WireItem; now: number; fallback: string }) {
  const img = safeHttpUrl(item.imageUrl);
  return (
    <Wrapper href={item.sourceUrl}>
      <img src={img ?? fallback} alt="" loading="lazy" />
      <span className="eyebrow">{meta(item, now)}</span>
      <span className="h">{item.headline}</span>
      {item.summary && <span className="s">{item.summary}</span>}
    </Wrapper>
  );
}

function WireLine({ item, now }: { item: WireItem; now: number }) {
  const linked = safeHttpUrl(item.sourceUrl) !== null;
  return (
    <Wrapper href={item.sourceUrl}>
      <span className="src">{meta(item, now)}</span>
      <span className="h">{item.headline}</span>
      <span className="ar" aria-hidden>{linked ? "↗" : ""}</span>
    </Wrapper>
  );
}

function WireRow({ item, now }: { item: WireItem; now: number }) {
  const img = safeHttpUrl(item.imageUrl);
  return (
    <Wrapper href={item.sourceUrl}>
      <span
        className="th"
        aria-hidden
        style={img ? { backgroundImage: `url(${JSON.stringify(img)})` } : undefined}
      />
      <span className="tx">
        <span className="m">{meta(item, now)}</span>
        <span className="h">{item.headline}</span>
      </span>
    </Wrapper>
  );
}
