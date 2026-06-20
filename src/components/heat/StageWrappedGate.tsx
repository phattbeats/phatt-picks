import { currentEventId } from "@/lib/events-core";
import { prepareStageWrappedAutoDeck, prepareMajorWrappedAutoDeck } from "@/lib/stage-wrapped-launch";
import { StageWrappedAnnounce } from "@/components/heat/StageWrapped";

/**
 * App-wide Stage Wrapped launcher (PHA-1051) + the Major Wrapped finale (PHA-1274).
 *
 * Mounted in `(app)/layout.tsx` next to `HowToPlayAnnounce` so the recap
 * auto-opens for every signed-in viewer on ANY page once a stage goes live —
 * not just when they happen to open `/reveal/[section]`. The client
 * `StageWrappedAnnounce` gates auto-open to once-per-stage via localStorage, so
 * each user is nagged exactly once.
 *
 * Two decks share the launcher:
 *   - the per-stage Swiss recap (`prepareStageWrappedAutoDeck`), and
 *   - the Major (Hotline) Wrapped finale (`prepareMajorWrappedAutoDeck`), which
 *     is HARD-GATED on the Grand Final champion — it returns null (renders
 *     nothing) until the final is decided, so it can never pop early.
 *
 * Inert until there's something to wrap (a single scoped `stageOutcome` query
 * per deck), so it costs ~nothing on every page the rest of the time.
 */
export async function StageWrappedGate({ playerId }: { playerId: string | null }) {
  const eventId = currentEventId();
  const [stageDeck, majorDeck] = await Promise.all([
    prepareStageWrappedAutoDeck(eventId, playerId),
    prepareMajorWrappedAutoDeck(eventId, playerId),
  ]);
  return (
    <>
      {stageDeck && stageDeck.slides.length > 0 && (
        <StageWrappedAnnounce
          stageKey={stageDeck.stageKey}
          eventId={stageDeck.eventId}
          sectionId={stageDeck.sectionId}
          slides={stageDeck.slides}
          title={stageDeck.title}
          resolved
        />
      )}
      {majorDeck && majorDeck.slides.length > 0 && (
        <StageWrappedAnnounce
          stageKey={majorDeck.stageKey}
          eventId={majorDeck.eventId}
          sectionId={majorDeck.sectionId}
          slides={majorDeck.slides}
          title={majorDeck.title}
          resolved
        />
      )}
    </>
  );
}
