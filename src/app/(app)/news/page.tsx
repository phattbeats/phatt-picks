/* eslint-disable @next/next/no-img-element -- static editorial photo from /public/wrapped. */

import Link from "next/link";
import { getWireItems } from "@/lib/news";
import { WireFeed } from "@/components/heat/WireFeed";
import { PHOTOS } from "@/lib/photos";

export const metadata = { title: "Wire · HOTLINE" };
export const dynamic = "force-dynamic";

/**
 * The wire (#857), Singapore skin (prototype 13): lead story as a full-bleed
 * hero, then a hairline list. When the wire is dry it degrades to the honest
 * "No signal yet" state below: news was first on the handoff cut list ("mark
 * cancelled, don't silently drop"), and we never fabricate a headline to fill
 * the slot.
 */
export default async function NewsPage() {
  const items = await getWireItems(30);
  // Per-request server timestamp for relative "x ago" stamps — this is a
  // force-dynamic RSC that renders once per request, so Date.now is intentional.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="sgc-ed">
      {items.length > 0 ? (
        <WireFeed items={items} now={now} variant="full" />
      ) : (
        <EmptyWire />
      )}
    </div>
  );
}

function EmptyWire() {
  return (
    <section className="bleed">
      <img src={PHOTOS.newsHero} alt="" />
      <span className="credit">Photo · HLTV</span>
      <div className="in">
        <span className="eyebrow rise">
          The wire · <b>Scanning frequencies</b>
        </span>
        <h1 className="display rise d1">No signal yet</h1>
        <p className="rise d2">
          A match-news feed is still on the way. For now HOTLINE stays focused on{" "}
          <b>picks and the leaderboard</b>.
        </p>
        <div className="cta rise d3">
          <Link href="/picks" prefetch={false} className="btn-solid">
            Go make your picks
          </Link>
        </div>
      </div>
    </section>
  );
}
