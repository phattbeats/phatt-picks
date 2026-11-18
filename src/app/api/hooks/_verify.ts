import { NextRequest } from "next/server";
import { parseHookSecrets, verifyHookSig } from "@/lib/phatt-id-core";

/** Arcade hook auth (PHA-4101): X-Arcade-Kid/-Ts/-Sig over `data`; secrets in ARCADE_HOOK_SECRETS={"kid":"secret"}. */
export function hookAuthorized(req: NextRequest, data: string): boolean {
  const h = req.headers;
  return verifyHookSig(
    parseHookSecrets(process.env.ARCADE_HOOK_SECRETS),
    h.get("x-arcade-kid"), h.get("x-arcade-ts"), h.get("x-arcade-sig"), data, Date.now(),
  );
}
