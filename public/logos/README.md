# Self-hosted team logos

This is the **second tier** of the M6 logo cascade (`src/lib/logos.ts`):

```
ByMykel manifest  →  self-host (here)  →  monogram
```

The primary source is `src/fixtures/cologne-logos.json`, built from ByMykel/CSGO-API
by `scripts/build-logos.ts`. As of the last build, all 32 IEM Cologne 2026 teams
resolve from ByMykel, so this directory is empty by design — it's the safety net.

## When you need it

Drop a file here named after the team's **`logo` slug** from `cologne-layout.json`:

```
public/logos/<logo>.svg     e.g. navi.svg, g2.svg, fut.svg
```

`<TeamLogo>` requests `/logos/<logo>.svg` only if the ByMykel image is missing or
fails to load. If this file is also absent, it falls through to a monogram badge —
so a missing file degrades cleanly, it never shows a broken image.

SVG is expected (`selfHostUrl()` in `src/lib/logos.ts`); change that helper if you
self-host a different format. Slugs: navi, liq, g2, astr, big, tyl, mibr, spir, furi,
nrg, vita, hero, pain, shrk, mouz, nine, gl, mont, mngz, lgcy, lynn, fq, aura, b8, bb,
fal, m80, pari, fut, gaim, sinn, thun.
