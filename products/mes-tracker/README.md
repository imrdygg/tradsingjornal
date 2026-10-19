# MES Indicator Level Tracker

A private, offline journal of the levels your MES indicator prints: log each line per session
and per chart, then read what actually happened at it. No account, no server, no market data
feed.

## Requirements

**Nothing external.** This is a static site: no Supabase database, no Gemini API key, no
server, no account, no live quote subscription. A static host (or `npx serve`) is the only
thing needed.

Cloud sync and AI features belong to the full Trading Journal, the AI Coach and Trading
Memory. Those are separate products, and the buyer supplies their own Supabase project and
Gemini key for them. This product does not include or require either.

## What is inside

- **Daily Log.** One session at a time, six charts (1m, 3m, 5m, 15m, 30m, 1h). Record price,
  support/resistance, how many times price tested the line, how many held and how many broke,
  the pattern tag, when it was hit and when it broke, and a note. A form stays open for a run
  of levels.
- **Dashboard.** Reliability (holds ÷ decided tests), strength (shrunk toward 50% so a
  one-test level cannot read 100%), a grade, and a confidence dot counted in decisive tests.
  Notable levels, by chart and by side.
- **All Levels.** Every row, filterable and sortable, with CSV export.
- **Patterns.** Grouped by setup tag and by chart × side, with the same denominators shown.
- **Timing.** When levels were reached and when they broke, bucketed by half hour.
- **Data.** Full JSON backup, CSV export, restore, and demo data.
- **Your own words.** Notes travel with the level; the CSV keeps them quoted so a comma
  cannot shift the columns.

## What it is not

No signals, no alerts, no predictions, no live quotes. A level's reliability is a description
of the tests you logged — never a claim about the next test. When nothing decisive has
happened, the app shows a dash instead of a zero, and confidence is shown beside every rate.

## Technical

- React + Vite static build. One HTML file and one assets folder.
- No backend, no database, no API keys, no tracking.
- One instrument: **$MES**. Six charts.
- Records live in the browser under `ptj_mes_levels_v1`, the same key the full Trading
  Journal uses, so a backup can move both ways.
- License: offline key from Payhip, plus a 7-day trial.

## Files

```
index.html      the app
assets/         its JavaScript and CSS
INSTALL.md      how to serve it and activate it
LICENSE.txt     the end-user license
version.json    product id and version
```

See `INSTALL.md` before opening the app. Double-clicking `index.html` will not work; it has to
be served over HTTP.
