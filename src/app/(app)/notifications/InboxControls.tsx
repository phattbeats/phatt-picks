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

async function postMarkAll() {
  // "Mark all as read" means ALL of them, across every page — a single
  // watermark write (action: "readAll"), not one POST per visible row. The
  // previous per-id loop only marked the current page, so the unread count
  // snapped back from 0 to the other-page remainder after router.refresh(),
  // and it cost N requests instead of one.
  try {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "readAll" }),
    });
  } catch {
    /* will reconcile on next page load */
  }
}

export function InboxControls({ filter, unread, page }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticUnread, setOptimisticUnread] = useState(unread);

  // Keep the optimistic count in sync with the SSR pass when the user navigates
  // pages or toggles tabs. Adjust during render (the React-recommended pattern)
  // rather than in an effect — no cascading re-render, and the new count is used
  // on this very render instead of one frame late.
  const [seenUnread, setSeenUnread] = useState(unread);
  if (unread !== seenUnread) {
    setSeenUnread(unread);
    setOptimisticUnread(unread);
  }

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
    if (optimisticUnread === 0) return;
    startTransition(async () => {
      // Optimistic: every visible row loses its fresh state and the unread
      // count drops to 0 — readAll is a true all-pages mark, so 0 is accurate.
      const rows = document.querySelectorAll<HTMLLIElement>("li.inbox-row.fresh");
      rows.forEach((li) => {
        li.classList.remove("fresh");
        const dot = li.querySelector(".inbox-dot");
        if (dot) dot.remove();
        const link = li.querySelector("a.inbox-link");
        link?.removeAttribute("data-mark-on-click");
      });
      setOptimisticUnread(0);
      await postMarkAll();
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
