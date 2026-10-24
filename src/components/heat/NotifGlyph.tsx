/**
 * Shared notification glyph (Singapore skin). One hairline icon per feed kind,
 * used by the inbox, the header-bell dropdown, the SSE toast stack and the
 * broadcast popup so every notification surface speaks the same language.
 *
 * The coin-earned kind shows the actual struck coin (the baked PNG under
 * /public/coins) instead of an icon. The feed entry id is `coin:{eventId}` and
 * its title leads with the tier label ("Gold challenge coin earned"), so the art
 * is derived from those — presentation only, no new data on the wire. Anything
 * unresolvable falls back to the hairline coin icon.
 */
import { getEventConfig } from "@/lib/events-core";
import { COIN_TIERS, coinArtSrc, type CoinTier } from "@/lib/challenge-coin-core";

export type NotifGlyphKind = "reaction" | "stage" | "recap" | "announcement" | "coin" | "achievement";

/** Resolve the struck-coin art for a coin-earned feed entry, or null. */
export function coinArtForEntry(id: string, title: string): { src: string; tier: CoinTier } | null {
  const m = /^coin:(\d+)$/.exec(id);
  if (!m) return null;
  const event = getEventConfig(Number(m[1]));
  if (!event) return null;
  const word = title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const tier = (COIN_TIERS as readonly string[]).includes(word) ? (word as CoinTier) : null;
  if (!tier) return null;
  return { src: coinArtSrc(event.slug, tier), tier };
}

function Icon({ kind }: { kind: NotifGlyphKind }) {
  switch (kind) {
    case "stage":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case "recap":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 15l7-7 7 7" />
        </svg>
      );
    case "reaction":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16v11H9l-5 4z" />
        </svg>
      );
    case "announcement":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10v4h3l6 4V6l-6 4z" />
          <path d="M17 9a4 4 0 010 6" />
        </svg>
      );
    case "achievement":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="10" r="6" />
          <path d="M9 15.2 8 21l4-2 4 2-1-5.8" />
        </svg>
      );
    case "coin":
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
  }
}

/**
 * The glyph box. `id`/`title` are only consulted for the coin kind (to find the
 * struck coin). `size` picks the inbox (lg) or dropdown/toast (sm) scale.
 */
export function NotifGlyph({
  kind,
  id = "",
  title = "",
  size = "lg",
}: {
  kind: string;
  id?: string;
  title?: string;
  size?: "lg" | "sm";
}) {
  const k: NotifGlyphKind =
    kind === "stage" || kind === "recap" || kind === "reaction" || kind === "announcement" || kind === "coin" || kind === "achievement"
      ? kind
      : "announcement";
  const art = k === "coin" ? coinArtForEntry(id, title) : null;
  const px = size === "lg" ? 44 : 32;
  return (
    <span className={`nf-ic nf-ic-${size} k-${k}${art ? " struck" : ""}`} aria-hidden="true">
      {art ? (
        // Baked coin PNGs are tiny and already sized — a plain <img> avoids the
        // next/image wrapper in the toast/dropdown hot path.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art.src} alt="" width={px} height={px} loading="lazy" decoding="async" />
      ) : (
        <Icon kind={k} />
      )}
    </span>
  );
}
