# Self-hosted team logos

The team's own logo mark, one PNG per layout `logo` slug (`navi.png`, `g2.png`, …).
Downloaded from Liquipedia by `scripts/build-team-marks.ts`, which also writes the
index `src/fixtures/team-marks.json`.

The logo cascade (`src/lib/logos-core.ts`):

```
team mark (here, if indexed)  →  ByMykel sticker  →  monogram
```

The ByMykel manifest (`src/fixtures/cologne-logos.json`, `scripts/build-logos.ts`)
maps each team to its tournament **sticker**. For Cologne that is a stained-glass
roundel with "Cologne 2026" lettered under the mark, which reads as a grey disc at
tile size. So a team with a mark here leads with it, and the sticker is the fallback.
A slug that isn't in the index never requests `/logos/<slug>.png`.

## Adding marks for the next Major

Once the new layout fixture lands:

```
node --experimental-strip-types scripts/build-team-marks.ts <layout-fixture-basename>
```

Fix any "No mark found" team with a `TITLE_OVERRIDES` / `FILE_OVERRIDES` entry in the
script. Marks accumulate across Majors, and the index is rebuilt from this directory.
