/**
 * invite-core — PURE, isomorphic invite-code helpers. No prisma, no node
 * builtins (crypto lives in invite.ts so this stays client-safe and loadable by
 * the offline verify harness). Invite codes are 12 lowercase hex chars, matching
 * the `randomBytes(6).toString("hex")` minted in the local-auth route.
 */

export const INVITE_CODE_LENGTH = 12;
const CODE_RE = /^[0-9a-f]{12}$/;

export function normalizeInviteCode(code: string): string {
  return code.trim().toLowerCase();
}

export function isValidInviteCode(code: string | null | undefined): boolean {
  return typeof code === "string" && CODE_RE.test(normalizeInviteCode(code));
}

/** Absolute invite URL for a code, e.g. https://pickems.phatt.vip/join/ab12cd34ef56 */
export function buildInviteUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/join/${normalizeInviteCode(code)}`;
}
