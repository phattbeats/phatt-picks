type QA = { q: string; a: React.ReactNode };
type Cat = { cat: string; id?: string; items: QA[] };

/** Stable in-page anchor for a category (explicit id wins). */
function anchorFor(c: Cat): string {
  return c.id ?? c.cat.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * FAQ (prototype 20): a sticky table of contents beside hairline sections of
 * native <details> disclosures. Native disclosures need no client JS, are
 * keyboard/screen-reader accessible out of the box, and are what the app's
 * cookieless analytics counts as "disclosure_open" (see app/layout.tsx).
 */
export function Faq({ categories }: { categories: Cat[] }) {
  return (
    <div className="sgc-faq">
      <nav className="sgc-toc" aria-label="FAQ sections">
        {categories.map((c) => (
          <a key={c.cat} href={`#${anchorFor(c)}`}>
            {c.cat}
          </a>
        ))}
      </nav>
      <div className="sgc-secs">
        {categories.map((c) => (
          <section key={c.cat} className="sgc-sec" id={anchorFor(c)}>
            <h2>{c.cat}</h2>
            {c.items.map((it) => (
              <details key={it.q}>
                <summary>{it.q}</summary>
                <div className="sgc-ans">{it.a}</div>
              </details>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
