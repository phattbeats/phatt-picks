import { HeatHeader, type TopbarYouProps } from "@/components/heat/HeatHeader";
import { HeatBottomNav } from "@/components/heat/HeatBottomNav";
import { HowToPlayAnnounce } from "@/components/heat/HowToPlayAnnounce";
import { StageWrappedGate } from "@/components/heat/StageWrappedGate";
import { AnnouncePopup } from "@/components/heat/AnnouncePopup";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveTopbarYou } from "@/lib/topbar-you-core";
import { latestActiveAnnouncement } from "@/lib/announcements-core";

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
  const profileHref = session ? `/players/${session.playerId}` : "/settings";

  // Broadcast popup (PHA-1211) — the latest active announcement, shown once to
  // every signed-in player. Derived from the clock; null when none is live.
  // eslint-disable-next-line react-hooks/purity
  const announcement = session ? latestActiveAnnouncement(Date.now()) : null;

  return (
    <>
      <HeatHeader topbar={topbar} profileHref={profileHref} />
      <main className="shell with-nav">
        {session && <HowToPlayAnnounce />}
        {announcement && (
          <AnnouncePopup
            announcement={{
              id: announcement.id,
              icon: announcement.icon,
              title: announcement.title,
              body: announcement.body,
              href: announcement.href,
            }}
          />
        )}
        {/* Stage (Swiss) recap auto-open stays REMOVED (PHA-1269): it froze
            low-end Android on login. The Stage recap is on-demand only (reveal
            "Replay" button + ?wrapped=1 deep link).
            The MAJOR Wrapped finale (PHA-1274) DOES auto-open app-wide — Brandon's
            call, it's the big finish — but ironclad: hard-gated on the Grand Final
            champion (renders nothing until then), deferred to idle, once per
            viewer, behind an error boundary, no GPU blur, mobile-fit. */}
        {session && <StageWrappedGate playerId={session.playerId} />}
        {children}
      </main>
      <HeatBottomNav />
    </>
  );
}
