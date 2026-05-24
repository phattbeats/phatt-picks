/**
 * GetTournamentItems parsing — the itemid source for the write path.
 *
 * A user's lockable tournament items come back as `result.items[]`, each
 * `{ type, teamid, itemid }`. The write flow looks up the itemid for the team
 * being predicted and sends it to UploadTournamentPredictions (handoff §5).
 *
 * itemids are 17+ digit bigints (e.g. 17293822569790899385) — they MUST stay
 * strings (rule #2). Always feed the raw response through parseSafeJson (see
 * valve.ts) so the itemid is already a string by the time it reaches here; a
 * bare number means it was JSON.parse'd unsafely and has already lost precision.
 */

/**
 * Local digit-string guard (rule #2). Inline, with no runtime relative imports,
 * so this module stays loadable by the offline verify harness (mirrors the M4
 * pure cores and bigint.assertBigIntString).
 */
function assertDigitString(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^\d+$/.test(v)) {
    throw new Error(`${field} must be a digit string, got: ${JSON.stringify(v)}`);
  }
  return v;
}

/** One item as returned by GetTournamentItems. */
export interface RawItem {
  type: string; // "team" for the lockable team stickers the write path needs
  teamid: number;
  itemid?: string | number | null;
}

export interface ItemsEnvelope {
  result: { items?: RawItem[] };
}

/**
 * Build a teamid → itemid (digit string) map from an items envelope. Only
 * `type:"team"` items are kept (those are the picks' lockable stickers). A
 * number-typed itemid throws — it lost precision before reaching here (rule #2).
 */
export function buildItemIdMap(envelope: ItemsEnvelope): Map<number, string> {
  const map = new Map<number, string>();
  for (const item of envelope?.result?.items ?? []) {
    if (item.type !== "team") continue;
    const itemid = item.itemid;
    if (itemid === null || itemid === undefined || itemid === 0 || itemid === "0") continue;
    if (typeof itemid === "number") {
      throw new Error(
        `item itemid arrived as a number (${itemid}) for team ${item.teamid} — ` +
          `parse the raw response with parseSafeJson (rule #2)`,
      );
    }
    map.set(Number(item.teamid), assertDigitString(itemid, "itemid"));
  }
  return map;
}
