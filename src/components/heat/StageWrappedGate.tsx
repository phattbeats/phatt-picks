import { currentEventId } from "@/lib/events-core";
import { prepareMajorWrappedAutoDeck } from "@/lib/stage-wrapped-launch";
import { StageWrappedAnnounce } from "@/components/heat/StageWrapped";

/**
 * Major (Hotline) Wrapped auto-launcher (PHA-1274).
 *
 * Mounted in `(app)/layout.tsx`. This re-introduces an app-wide auto-open — but
 * ONLY for the Major Wrapped finale, and only in an ironclad form (Brandon:
 * "full on auto login popup ... but it needs to be ironclad"). The Stage (Swiss)
 * recap stays explicit-intent only, exactly as PHA-1269 left it — that's the one
 * that froze low-end Android on login, so it is NOT auto-opened here.
 *
 * HARD-GATED on the Grand Final: `prepareMajorWrappedAutoDeck` returns null until
 * a champion is crowned, so this renders nothing (a single scoped query) the
 * entire tournament and can never pop before the final. Once it does fire, the
 * deck opens deferred-to-idle, once per viewer, behind an error boundary, with
 * no GPU blur and mobile-fit — the freeze classes PHA-1269 hit are all closed.
 */
export async function StageWrappedGate({ playerId }: { playerId: string | null }) {
  const majorDeck = await prepareMajorWrappedAutoDeck(currentEventId(), playerId);
  if (!majorDeck || majorDeck.slides.length === 0) return null;
  return (
    <StageWrappedAnnounce
      stageKey={majorDeck.stageKey}
      eventId={majorDeck.eventId}
      sectionId={majorDeck.sectionId}
      slides={majorDeck.slides}
      title={majorDeck.title}
      resolved
      autoOpen
    />
  );
}
