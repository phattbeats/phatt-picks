"use client";

import { replayStageWrapped } from "./StageWrapped";

/**
 * Replay entry point for the Stage Wrapped deck (PHA-1054). The deck auto-opens
 * once per stage (localStorage-gated in `StageWrappedAnnounce`); this button lets
 * a viewer re-open it any time via the replay bus. Tiny client island so the
 * reveal page can stay a server component. No-ops harmlessly if the matching
 * launcher isn't mounted (e.g. an unauthored stage with an empty deck).
 */
export function StageWrappedReplay({ stageKey, label = "Replay the recap" }: { stageKey: string; label?: string }) {
  return (
    <button type="button" className="btn-ghost" onClick={() => replayStageWrapped(stageKey)}>
      {label}
    </button>
  );
}
