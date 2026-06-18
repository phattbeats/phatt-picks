"use client";

/**
 * Inbox controls (PHA-1237): All/Unread tabs and Mark-all-read, plus
 * per-row click-to-mark-read via event delegation on the inbox page.
 *
 * The page is server-rendered; this client component owns the small set of
 * mutations that need to hit POST /api/notifications and the optimistic UI
 * updates that follow. It uses event delegation on `.inbox-link` so a
 * client-side navigation away is preserved while the per-item read fires in
 * the background.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";

interface Props {
  filter: "all" | "unread";
  unread: number;
  visibleIds: string[];
  page: number;
}

async function postMarkOne(entryId: string) {
  try {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", entryId }),
    });
  } catch {
    /* will reconcile on next page load */
  }
}

async function postMarkAll(ids: string[]) {
  // Server-side readAll already enumerates everything currently visible
  // (across all sources), but we also pass the visible ids so the bulk
  // mutation is scoped to this page and the unread tab does not get cleared
  // by accident when the player only wants to clear what they see.
  await Promise.all(
    ids.map((entryId) =>
      fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "read", entryId }),
      }).catch(() => undefined),
    ),
  );
}

export function InboxControls({ filter, unread, visibleIds, page }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticUnread, setOptimisticUnread] = useState(unread);

  // Keep optimistic count in sync with the SSR pass when the user navigates
  // pages or toggles tabs.
  useEffect(() => {
    setOptimisticUnread(unread);
  }, [unread]);

  // Per-item click delegation. The inbox page is server-rendered, so the
  // row <a> tags are present at mount time. We listen for clicks on the
  // delegated container, fire the read, optimistically flip the row, and
  // let the browser navigate naturally.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest<HTMLAnchorElement>("a.inbox-link");
      if (!link) return;
      if (link.dataset.markOnClick !== "true") return;
      const li = link.closest<HTMLLIElement>("li.inbox-row");
      const entryId = li?.dataset.entryId;
      if (!entryId) return;
      // Optimistic: remove the "fresh" class and dot so the user sees the
      // state change immediately, even though we don't block navigation.
      li?.classList.remove("fresh");
      const dot = li?.querySelector(".inbox-dot");
      if (dot) dot.remove();
      link.removeAttribute("data-mark-on-click");
      setOptimisticUnread((n) => Math.max(0, n - 1));
      void postMarkOne(entryId);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function onMarkAll() {
    if (visibleIds.length === 0) return;
    startTransition(async () => {
      // Optimistic: every visible row loses its fresh state; the unread count
      // drops to 0 (only the visible page's contribution is certain, but the
      // server's readAll will catch the rest on next page load).
      const rows = document.querySelectorAll<HTMLLIElement>("li.inbox-row.fresh");
      rows.forEach((li) => {
        li.classList.remove("fresh");
        const dot = li.querySelector(".inbox-dot");
        if (dot) dot.remove();
        const link = li.querySelector("a.inbox-link");
        link?.removeAttribute("data-mark-on-click");
      });
      setOptimisticUnread(0);
      await postMarkAll(visibleIds);
      // Refresh the server tree so the next page render is consistent with
      // the (now-persisted) read state — important for the "unread" tab
      // which hides items the player has marked.
      router.refresh();
    });
  }

  return (
    <div className="inbox-tabs">
      <div className="inbox-tabs-row" role="tablist" aria-label="Notifications filter">
        <Link
          href={`/notifications?page=${page}`}
          role="tab"
          aria-selected={filter === "all"}
          className={`inbox-tab${filter === "all" ? " active" : ""}`}
        >
          All
        </Link>
        <Link
          href={`/notifications?filter=unread&page=${page}`}
          role="tab"
          aria-selected={filter === "unread"}
          className={`inbox-tab${filter === "unread" ? " active" : ""}`}
        >
          Unread {optimisticUnread > 0 && <span className="inbox-tab-ct">{optimisticUnread}</span>}
        </Link>
        <div className="inbox-tabs-spacer" />
        <button
          type="button"
          className="inbox-markall"
          onClick={onMarkAll}
          disabled={pending || optimisticUnread === 0}
        >
          {pending ? "Marking…" : "Mark all as read"}
        </button>
      </div>
    </div>
  );
}
