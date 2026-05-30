"use client";

import { useState } from "react";

type QA = { q: string; a: React.ReactNode };
type Cat = { cat: string; items: QA[] };

const Chevron = (
  <svg className="faq-icon" viewBox="0 0 24 24">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function Item({ q, a }: QA) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq${open ? " open" : ""}`}>
      <button type="button" className="faq-q" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{q}</span>
        {Chevron}
      </button>
      <div className="faq-a">
        <div className="faq-a-inner">{a}</div>
      </div>
    </div>
  );
}

export function Faq({ categories }: { categories: Cat[] }) {
  return (
    <>
      {categories.map((c) => (
        <div key={c.cat}>
          <div className="faq-cat">{c.cat}</div>
          <div className="faq-list">
            {c.items.map((it) => (
              <Item key={it.q} q={it.q} a={it.a} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
