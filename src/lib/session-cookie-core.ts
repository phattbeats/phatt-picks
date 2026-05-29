/**
 * Pure helper for the phatt_session cookie's `Secure` attribute (PHA-850).
 *
 * Pre-PHA-850 both auth routes set `secure: NODE_ENV === "production"`. The
 * Unraid container runs NODE_ENV=production but Brandon's LAN-IP access is
 * plain HTTP (http://10.0.0.100:3005), so browsers silently dropped the
 * Set-Cookie. That manifested as Steam OpenID loops and runaway local-player
 * duplicates because PHA-839's dedup only fires when the cookie survives the
 * round-trip.
 *
 * We instead key off the configured base URL's scheme. The owner sets
 * NEXTAUTH_URL per environment:
 *   https://pickems.phatt.vip       -> Secure   (prod via SWAG)
 *   http://10.0.0.100:3005          -> not Secure (LAN-IP)
 *   http://localhost:3000           -> not Secure (dev)
 *
 * Kept pure so the verify harness can exercise it without next/prisma.
 */

export function shouldUseSecureCookie(baseUrl: string | undefined | null): boolean {
  if (typeof baseUrl !== "string") return false;
  return baseUrl.startsWith("https://");
}
