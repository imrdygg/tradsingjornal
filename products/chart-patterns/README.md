# Chart Pattern Playbook

Twenty chart-pattern reference setups with staged, teachable illustrations and a private
study journal. Runs entirely in your browser, offline, with no account.

## Requirements

**Nothing external.** This is a static site: no Supabase database, no Gemini API key, no
server, no account. A static host (or `npx serve`) is the only thing needed.

Cloud sync and AI features belong to the full Trading Journal, the AI Coach and Trading
Memory. Those are separate products, and the buyer supplies their own Supabase project and
Gemini key for them. This product does not include or require either.

## What is inside

- **20 setups**, in the order of the source chart-pattern sheet: 10 reversal and 10
  continuation patterns.
- **A staged illustration for every pattern.** Prior trend → formation → structure complete →
  break → optional retest and measured move. Pause it, step through it, or replay it. With
  reduced motion on, it opens on the finished chart and only moves when you press Play.
- **A full study guide per pattern:** quick definition, market story, required structure,
  formation sequence, confirmation/trigger, invalidation signs, target concepts, common
  mistakes, and a pattern-specific checklist.
- **Your own study journal:** status (watching → forming → near breakout → confirmed → retest
  → failed → invalidated → completed), the universal pre-trade checklist, notes, and logged
  examples with before/after screenshots.
- **Stable links:** every pattern has its own URL (`#chart-patterns/<id>`), so a study page
  can be bookmarked.
- **Export and import.** Move your notes between devices, or into the full Trading Journal.

## What it is not

No signals, no alerts, no predictions, no market data feed. Chart patterns are described as
probabilistic and educational, and a pattern is never called confirmed until a candle
**closes** beyond the structure. The product says this on screen, not only in the small print.

## Technical

- React + Vite static build. One HTML file and one assets folder.
- No backend, no database, no API keys, no tracking.
- Study data lives in the browser's local storage under the same key the Trading Journal
  uses, which is what makes export/import work in both directions.
- License: offline key from Payhip, plus a 7-day trial.

## Files

```
index.html      the app
assets/         its JavaScript and CSS
INSTALL.md      how to serve it and activate it
LICENSE.txt     the end-user license
version.json    product id and version
```

See `INSTALL.md` before opening the app. Double-clicking `index.html` will not work; it has
to be served over HTTP.
