import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * /profile used to be a settings dump that competed with the player card you
 * reach from the top-right avatar — two different "profiles" (PHA-1275). It's
 * now a thin redirect: signed in → your profile card (/players/{you}); signed
 * out → the sign-in surface on /settings. All settings live behind the gear
 * cog on the profile card. Kept as a route so old links / nav still resolve.
 */
export default async function ProfilePage() {
  const session = await getSession();
  redirect(session ? `/players/${session.playerId}` : "/settings");
}
