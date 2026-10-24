"use client";

/**
 * Opening /phatt-id counts as reading the bell's "Your achievements from …" entry,
 * so it stops showing as new however the player got here.
 */

import { useEffect } from "react";

export function MarkWelcomeRead({ entryId }: { entryId: string }) {
  useEffect(() => {
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", entryId }),
    }).catch(() => {});
  }, [entryId]);
  return null;
}
