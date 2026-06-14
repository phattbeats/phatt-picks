import { currentEventId } from "@/lib/events-core";
import { prepareStageWrappedAutoDeck } from "@/lib/stage-wrapped-launch";
import { StageWrappedAnnounce } from "@/components/heat/StageWrapped";

/**
 * App-wide Stage Wrapped launcher (PHA-1051).
 *
 * Mounted in `(app)/layout.tsx` next to `HowToPlayAnnounce` so the end-of-stage
 * recap auto-opens for every signed-in viewer on ANY page once a stage goes
 * live — not just when they happen to open `/reveal/[section]`. The client
 * `StageWrappedAnnounce` gates auto-open to once-per-stage via localStorage, so
 * each user is nagged exactly once per stage.
 *
 * Renders nothing until a stage is both resolved and authored, so it's inert
 * (a single `stageOutcome` query) the rest of the time.
 */
export async function StageWrappedGate({ playerId }: { playerId: string | null }) {
  const deck = await prepareStageWrappedAutoDeck(currentEventId(), playerId);
  if (!deck || deck.slides.length === 0) return null;
  return (
    <StageWrappedAnnounce
      stageKey={deck.stageKey}
      eventId={deck.eventId}
      sectionId={deck.sectionId}
      slides={deck.slides}
      title={deck.title}
      resolved
    />
  );
}
