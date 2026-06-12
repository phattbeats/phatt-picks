/**
 * Pure resolver for the top-bar "You" chip (PHA-851).
 *
 * The home-page header used to render a literal "◎" glyph + the string "You"
 * regardless of session — Steam-authed users never saw their persona name or
 * avatar. This helper picks the chip variant from session + Player.avatarUrl so
 * the page component stays a thin shell and the variant logic is unit-testable
 * without spinning up Next.
 */

export interface TopbarSessionInput {
  displayName: string;
  steamId?: string | null;
  isLocal: boolean;
}

export type TopbarYouVariant =
  | { kind: "anonymous" }
  | { kind: "initials"; label: string; initials: string }
  | { kind: "avatar"; label: string; avatarUrl: string };

export interface TopbarYouInput {
  session: TopbarSessionInput | null;
  avatarUrl?: string | null;
}

export function resolveTopbarYou(input: TopbarYouInput): TopbarYouVariant {
  const session = input.session;
  if (!session) return { kind: "anonymous" };

  const label = (session.displayName || "").trim() || "You";
  const avatar = typeof input.avatarUrl === "string" ? input.avatarUrl.trim() : "";

  if (avatar.length > 0) {
    return { kind: "avatar", label, avatarUrl: avatar };
  }

  return { kind: "initials", label, initials: deriveInitials(label) };
}

export function deriveInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (firstChar(parts[0]) + firstChar(parts[1])).toUpperCase();
  }
  // Single token: take up to two leading characters (handles short handles).
  return Array.from(trimmed).slice(0, 2).join("").toUpperCase();
}

function firstChar(word: string): string {
  return Array.from(word)[0] ?? "";
}
