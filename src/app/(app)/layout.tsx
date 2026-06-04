import { HeatHeader, type TopbarYouProps } from "@/components/heat/HeatHeader";
import { HeatBottomNav } from "@/components/heat/HeatBottomNav";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveTopbarYou } from "@/lib/topbar-you-core";

export const dynamic = "force-dynamic";

/** Shell layout for main app pages: HOTLINE header + mobile bottom nav. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const playerRow = session
    ? await prisma.player.findUnique({
        where: { id: session.playerId },
        select: { avatarUrl: true },
      })
    : null;
  const topbar: TopbarYouProps = resolveTopbarYou({
    session,
    avatarUrl: playerRow?.avatarUrl,
  });
  // The top-right avatar opens your own player profile (Brandon). Anonymous →
  // the account/sign-in surface.
  const profileHref = session ? `/players/${session.playerId}` : "/profile";

  return (
    <>
      <HeatHeader topbar={topbar} profileHref={profileHref} />
      <main className="shell with-nav">{children}</main>
      <HeatBottomNav />
    </>
  );
}
