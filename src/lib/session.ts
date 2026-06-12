/**
 * Session utilities — decode the phatt_session JWT and return player id.
 * All reads are server-side only; the JWT payload never reaches the client.
 */

import { jwtVerify } from "jose";
import { cookies } from "next/headers";

export interface Session {
  playerId: string;
  steamId?: string;
  displayName: string;
  isLocal: boolean;
}

function getSessionSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("phatt_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return {
      playerId: payload.sub as string,
      steamId: payload.steamId as string | undefined,
      displayName: payload.displayName as string,
      isLocal: (payload.isLocal as boolean) ?? false,
    };
  } catch {
    return null;
  }
}
