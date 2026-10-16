# Trading Journal

A private futures trading journal for one trader: plan the day, record executions, review
them honestly, and get a coach that reads only your own records.

Everything hangs off three questions the app keeps asking:

1. **What was the plan?** A morning plan (loss limit, contracts, sessions, watched setups,
   levels) that is *locked* before you trade, with every later edit recorded as a change
   with a reason.
2. **What actually happened?** Trades recorded by hand or imported from a Tradovate CSV,
   with screenshots, and a stop that is honestly labelled as invented when the CSV had none.
3. **Was the plan followed?** End-of-day and per-trade execution reviews that produce a
   discipline score, which the analytics, insights and coach all read.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

That is enough to use the whole app. With no credentials it runs as a **local-only
journal** (data in this browser, no login) and shows a notice saying why. The AI coach
needs a server key, and cloud sync needs Supabase; both are optional.

```bash
npm test               # unit tests (vitest)
npm run e2e            # Playwright specs (starts its own dev server)
npm run lint           # tsc --noEmit
```

Requires Node `^20.19.0 || >=22.12.0` (Vite 8). The project uses **npm** — `package-lock.json`
is the source of truth.

---

## Environment variables

Copy `.env.example` to `.env.local` for local development. Never commit `.env*` (already
gitignored).

| Variable | Where it belongs | What it does |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Client (build-time) | Supabase project URL. Both Supabase vars present ⇒ login + cloud sync turn on. |
| `VITE_SUPABASE_ANON_KEY` | Client (build-time) | Supabase anon key. Safe to expose — RLS is what protects the data. |
| `GEMINI_API_KEY` | **Server only** | The coach's Gemini key. |
| `SUPABASE_URL` | Server only | Same project URL, no `VITE_` prefix, so the coach can verify a caller's session. |
| `SUPABASE_ANON_KEY` | Server only | Same anon key, no `VITE_` prefix. Safe to hold server-side; RLS protects the data. |
| `GEMINI_MODEL` | Server only, optional | First model tried. Defaults to a small chain of Flash models. |
| `COACH_RATE_LIMIT` | Server only, optional | Answers per signed-in user per hour (default 30). |
| `COACH_ANON_RATE_LIMIT` | Server only, optional | Answers per anonymous IP per hour (default 10). Only used when the server cannot authenticate. |
| `COACH_MAX_IN_FLIGHT` | Server only, optional | Answers one caller may have running at once (default 2). |
| `APP_URL` | Server only, optional | Where the applet is hosted. |

The two `SUPABASE_*` names are the same values as the `VITE_*` pair with the prefix
removed. Setting only the `VITE_*` pair still works — the endpoint falls back to them — but
a server deployment should set both, so it is obvious which secrets the function uses.

**Never prefix `GEMINI_API_KEY` with `VITE_`.** Vite inlines every `VITE_*` variable into
the client bundle, which would publish the key to anyone who opens devtools.

---

## Supabase setup

Run `supabase/schema.sql` once in the SQL editor. It is **safe to re-run** — everything is
`create ... if not exists` / `drop policy if exists` / `add column if not exists`.

It creates:

- `journal_snapshots` — one JSON document per user (`user_id` primary key, RLS so a user
  can only touch their own row), plus a `revision` column used for conflict detection.
- `coach_quota` and the `coach_consume_quota` function — the coach's shared rate-limit
  ledger, keyed on the signed-in user (see *The AI coach* below).
- The public `journal-media` Storage bucket for video clips, with per-user folder policies.

> **Upgrading an existing project:** re-run `supabase/schema.sql`. The `revision` column is
> what stops two devices from overwriting each other's journal. Until it exists, the app
> reports the problem instead of syncing (the error names the file to re-run).

If you would rather clips were never reachable by URL, flip the bucket's `public` flag to
`false` and switch `uploadMediaFile` to `createSignedUrl` — see the comment in
`schema.sql` and `src/lib/media/media-utils.ts`.

---

## Cloud sync

The journal is stored as **one snapshot per user** and saves are automatic: edit anything,
and it is written to the cloud a moment later. Sign in on another device and you get the
same journal, with no prompt to choose between copies.

Every save is conditional on the `revision` the client last read, but the app **resolves a
refusal itself** rather than handing it to the trader:

- Writes from this device are **serialised** — each queues behind the last and starts from
the revision the previous one landed on. The debounce does not cancel a write already in
flight, so without this a device could refuse its own save and report it as another
device's change, which is what the old "use the cloud copy" box actually was.
- A refusal that survives that is a real write from another device. It is resolved by
  saving this device's copy, because that is the copy being typed into. The copy it replaces
  is set aside first (below), so the choice is never final.

**Nothing a sync replaces is deleted.** When a save overwrites another device's copy, or
when adopting the cloud copy on sign-in would drop records this device holds, the displaced
journal is kept as a recovery copy and offered for download in **Settings → Account & Cloud
Sync**. The three most recent copies are held and each can be downloaded or discarded on its
own, so a device that syncs twice in a row cannot lose the earlier copy to the later one. None
is kept for a journal too large to store twice (one carrying chart screenshots), where
duplicating it would break later writes.

The two copies are still not merged: a deletion on one device is indistinguishable from a
record the other device never had, so a merge would quietly resurrect deleted trades. Cloud
wins on sign-in — the same copy-everywhere behaviour the app has always had — with the
losing side kept rather than discarded.

Signing out flushes a final save and only clears local data if that save succeeded, so the
next account on the same browser can never inherit a previous user's journal.

---

## The AI coach

`src/api/coach.ts` is a serverless function (deployed by Vercel from `api/coach.js`) that
turns a journal digest into a brief, weekly review, trade critique, pre-session prep or
post-close review. The client never sees the API key and never builds a prompt: it posts the
digest with the trader's session token and validates JSON comes back.

### Access control

The endpoint spends a paid key, so it only answers a caller it can identify:

1. **A signed-in session is required.** The `Authorization: Bearer <access_token>` the
   client sends is verified against Supabase's `/auth/v1/user` before Gemini is called at
   all. Checking with the auth server (rather than verifying a JWT locally) works with both
   legacy shared-secret tokens and the newer asymmetric signing keys. Missing, expired or
   unverifiable sessions get `401` and no model is ever contacted.
2. **Each caller is rate-limited**, keyed on their Supabase user id — which cannot be
   forged — with a much tighter per-IP ceiling for the anonymous fallback below. Requests
   are counted only once they would actually reach Gemini, so a malformed request cannot
   lock a trader out of their own coach, and a single caller cannot have more than
   `COACH_MAX_IN_FLIGHT` answers running at once.

**A signed-in trader's allowance is global, not per instance.** It is spent in the
`coach_quota` row for their user id, so every running instance counts against the same
ceiling and a cold start no longer resets it. The endpoint spends it with the caller's own
access token, so row-level security — not a service-role key — is what keeps a trader inside
their own row. `coach_consume_quota` locks that row while it counts, so two instances cannot
both read the same number and both spend one.

> **One thing is still per instance:** the `COACH_MAX_IN_FLIGHT` guard, and the whole
> anonymous per-IP path. Both are deliberate. In-flight is about how many model calls *this
> box* is running, so sharing it would cost a round-trip to guard a local resource; and the
> anonymous path only runs on a deployment with no Supabase project at all, which has no
> shared store to use. The health check says which one is in play.

If the server has **no Supabase credentials** it cannot identify anyone, and refusing
outright would break the documented local-only deployment. It then falls back to the tight
per-IP limit and says so: `GET /api/coach` reports `access.authRequired: false` plus a
warning. Set the two server-side Supabase variables to close that.

`api/coach.js` is a **generated, committed** plain-JS bundle:

```bash
npm run build:function   # after ANY change to src/api/coach.ts — commit both files
```

It is committed on purpose. The host's TypeScript function build repeatedly shipped a
function with no entry point; a pre-bundled, dependency-free ESM file removes the host's
compiler from the equation.

**Local development does not serve serverless functions**, so `npm run dev` reports the coach
as unavailable — that is expected, not a bug. To exercise it locally either run `vercel dev`,
or verify the handler and key in-process:

```bash
npm run verify:coach     # one real call, reports which model answered
```

On a deployment, `GET /api/coach` returns a small JSON health check:

```json
{
  "ok": true,
  "service": "coach",
  "version": 21,
  "keyConfigured": true,
  "models": ["gemini-flash-lite-latest", "..."],
  "access": {
    "authRequired": true,
    "perUserPerHour": 30,
    "anonymousPerHour": 10,
    "maxInFlight": 2,
    "countersArePerInstance": false,
    "sharedQuota": "available"
  }
}
```

`countersArePerInstance` is false once a Supabase project is configured, and `sharedQuota`
says whether that project's ledger answered the last time it was asked: `"available"`, or
`"unavailable"` when the endpoint had to fall back to its own counter — the usual cause being
that `supabase/schema.sql` has not been re-run since the `coach_quota` table was added.

(The health check itself is deliberately unauthenticated and reveals nothing secret; it is
the one place to confirm whether a session is required and that the key is visible to the
function. If you get the app back instead, `api/coach` was not deployed with that build.)

### Coach guardrails

The prompt (`src/lib/ai/coach-prompt.ts`) is strict by design, and the rules are enforced in
tests: no market data or price commentary, no direction predictions, no invented facts, every
claim must quote a number from the journal, thin evidence must be called thin, and no generic
motivation. If you change the guardrails, `src/lib/ai/__tests__/coach-prompt.test.ts` is what
keeps them honest.

---

## Chart Patterns playbook

The **Playbook** tab has two libraries: *My setups* (the ones you trade) and *Chart
patterns* (the 20 reference setups from the chart-pattern sheet, in sheet order).

```
src/lib/playbook/
  pattern-types.ts         the entry shape + shared vocabulary (biases, statuses, checklist)
  patterns-reversal.ts     the 10 reversal entries
  patterns-continuation.ts the 10 continuation entries
  patterns.ts              the registry: order, lookups, filters, related setups
  pattern-animations.ts    one coordinate spec per pattern (geometry only)
  pattern-timeline.ts      phase windows, playback maths, card stagger
src/components/playbook/
  ChartPatternsView.tsx    grid, filters, study guide modal, journal
  PatternAnimation.tsx     the illustration engine (primitives, loop + player)
```

Conventions that matter if you add or edit a pattern:

- **Content is data, not components.** A pattern is one entry in `patterns-*.ts` plus one
  geometry spec in `pattern-animations.ts`. No per-pattern component exists.
- **`sourceName` is never rewritten.** Where the sheet's label disagrees with the drawing
  beside it (`Bullish Falling Village`, and the repeated `Descending Triangle` /
  `Symmetrical Expanding Triangle` labels), the label is preserved, the card carries a
  `sourceNote`, and duplicates get unique ids plus a disambiguating `displayName`.
- **The illustrations teach, so the timeline is behaviour.** Prior trend 0-20%, formation
  20-55%, structure completing 55-75%, break 75-90%, optional retest and measured move in
  the last 10%; about 5.6 s at 1x with a 1 s hold. Each annotation reveals when its own
  phase starts, so the drawing is built in sequence rather than wiggled.
- **Reduced motion is read synchronously** at first render, not in an effect: a
  reduced-motion reader opens on the finished chart, paused, and only ever animates when
  they press Play.
- **Every pattern has a stable URL:** `#chart-patterns/<patternId>`. The hash is written on
  open, cleared on close, and re-read on load, so a link can be bookmarked. It is validated
  inside the lazily loaded playbook chunk, so the pattern data never reaches the first paint.
- **Study data is per pattern, and only study data is persisted:** status, checklist, notes
  and logged examples (with before/after screenshots) live in
  `PatternStudy`, stored under `ptj_pattern_studies_v1` and included in export/import and
  cloud sync. The pattern explanations themselves ship with the build.
- **The playbook states what it is.** Chart patterns are described as probabilistic and
  educational, `Potential target concepts` never promises a level, and a shape is never
  called confirmed until a candle *closes* beyond the structure — the status picker spells
  that difference out.

---

## Trading Memory

The **Memory** tab is the journal's own market memory. The question it exists to answer is:

> **Have I seen this setup before, how similar was it, and what actually happened afterwards?**

It is *not* the picture search on the Playbook tab. That one asks a narrower question — "which of
my **trades** looks like this chart" — and answers it by handing the model the whole written record
and up to five recent screenshots, so what it can compare is bounded by what fits in one request and
the pictures are re-read from scratch every time. Trading Memory is built for the other question,
which is much bigger: it is a library of **observations**, most of which were never traded, and it is
designed to be searched by similarity over the whole collection rather than by whatever fits in a
prompt.

### What is implemented today

- **The Observation library.** Record a market situation with a screenshot, a time, an instrument,
a timeframe, a session, a setup, a free-text read and optional notes — then edit it, filter it, and
later record **what happened afterwards**. A sighting is expected to be usable with almost none of
that filled in, and an outcome is expected to be missing for a while: it is what price did, and it
can only be written once you have watched it.
- **An observation does not need a trade.** This is the point of the whole thing. Limiting the
library to executed trades would only ever answer *"what happened the last times I took this"*,
never *"what happened the last times I saw this"* — and the second question is both bigger and free
of the selection bias the first carries. `no trade taken` is a first-class state, not a blank.
- **The rules that keep hindsight out.** Screenshots carry a **role**, and only `before-setup` and
`entry` may ever be matched against: `exit` and `after-setup` show candles that had not printed when
the decision was made, and `context`/`other` are excluded because an unlabelled picture cannot be
*shown* to be pre-decision. Separately, an observation is only knowable at a moment if its timestamp
is trustworthy — `upload-time` and `unknown` are recorded but never placed into a replay.
- **Market behaviour and execution are counted separately, always.** The market can continue upward
after a setup while your own trade loses money. They are two numbers, from two denominators, and
never one "success rate".
- **Unknown is a result.** A case with nothing recorded afterwards is counted as unknown and never as
a reversal, and a rate is withheld entirely — with the counts still shown — until its sample clears
a documented floor.
- **Private storage.** Screenshots go to a private `journal-memory` bucket, not the public one. The
record keeps the object's **path**, never a signed URL (which expires), and every upload is verified
by reading the object back before the inline copy is discarded. A failed upload never costs you the
picture.
- **Consent, off by default.** Nothing is sent anywhere until you turn it on, and the screen says
plainly what turning it on means. A picture saved without consent is stored privately and marked
`skipped`, so the library still says what is searchable and why.

### The five sections

The tab is a section switcher rather than one long scroll, in the order the work happens:

| Section | What it does |
| --- | --- |
| **Library** | Record, browse, filter, edit a sighting and record what happened afterwards. The consent switch and the display settings live here. |
| **Indexing** | Move a backlog of inline screenshots into private storage and give each one an embedding. Resumable, cancellable, and honest about not having finished. |
| **Find similar** | Upload a chart, get the closest pictures in the library, and read what the market did beside what the execution did. When nothing is close, the chart can be kept as a sighting in one action — with no outcome and no vector yet, because neither is known at that moment. |
| **Research** | How often each setup was **seen** against how often it was **taken**, with both outcome dimensions kept apart — and the setup's **whole trade log** beside them, so a setup traded far more often than it was photographed is not summarised by the two trades a sighting happens to point at. |
| **Retrieval quality** | Whether the search is actually finding the charts you judged similar — measured against your own verdicts, not asserted. |

### The pipeline

```
chart (browser) --compress--> POST /api/memory --> gemini-embedding-2 --> vector(768)
                                   |                                        |
                            GEMINI_API_KEY                          memory_images
                          (server, never the client)                      |
                                                                          v
chart -> embedding -> memory_match_images(...)  --cosine--> ranked resemblance -> screen
```

- **`api/memory.js` is a generated, committed bundle** like `api/coach.js` — run
`npm run build:function` after changing `src/api/memory.ts`. It is a **separate function from the
coach**, because the two spend different budgets: a backfill spends **one call per picture**, so a
library of two hundred charts would otherwise lock you out of your own coach for the rest of the
hour. Set `MEMORY_RATE_LIMIT` (default 600/hour) and `MEMORY_MAX_IN_FLIGHT` (default 2) to move its
ceiling; a `GET` to the endpoint reports the limits in force and whether the key is visible, and
`npm run verify:memory` makes one real embedding call per chart and reports the model, the width of
the vector it comes back with, and how alike two charts of the same prices in opposite order turn
out — the half of the pipeline a health check cannot reach. Note that a key fetched with
`vercel env pull` arrives as the literal `[SENSITIVE]` (Vercel will not decrypt a Sensitive
variable), which the check reports as a placeholder rather than letting the provider call it a bad
key.
- **The key stays on the server.** The browser posts a compressed picture to your own endpoint,
which forwards it with the server's key and returns numbers. Nothing in the client ever holds a
model key, and `src/lib/memory/embedding-wire.ts` holds the contract the two sides agree on —
deliberately separate from the client module, so the handler cannot drag a Supabase session into its
bundle.
- **One picture per request, deliberately.** The model **aggregates several inputs into a single
embedding** rather than returning one per input, so a batch would come back as one vector for a group
of charts — an embedding of none of them. Concurrency across calls is where the throughput comes
from.
- **A vector without its stamp is refused.** Model name, version and input size travel with every
embedding; the search passes the same triple and `memory_match_images` rejects any row that does not
match it, so two generations of embeddings can never be silently ranked against each other.
- **Interruption is a state, not a crash.** A run that stops — cancelled, out of patience with a
rate limit, or a closed tab — leaves every unfinished picture pending, and `status: 'processing'` is
treated as work to redo rather than as work in progress, so a picture cannot be stranded by an
interrupted run.
- **A search that finds nothing can keep the chart it was asked about.** The failure is the informative
case — *I have never kept this* — so the chart can be recorded as a sighting from that screen, in one
click and with nothing sent. It arrives in a `before-setup` role (the only kind a later search can
return), with no outcome and no vector, and the screen says both of those rather than letting the
next search silently omit it. Nothing is recorded without the click: recording every chart used as a
query would fill the library with queries.
- **A search that cannot answer does not run.** With nothing indexed, the button is disabled and the
reason is stated before the click, because the answer is knowable without spending a model call — the
trader used to learn their library was empty by waiting for an embedding to come back and say so.
- **Consent gates the query too.** The chart you search *with* is your own private chart, so with
consent off the search refuses and says so. "Not allowed to search" and "nothing similar found" are
different answers and the screen never renders the second for the first.

### What is *not* implemented yet

The Memory tab states all of this on screen, derived from real state, rather than offering controls
that do nothing:

- **Nothing imports your journal's existing screenshots into the memory library.** The engine reads
observations, so a chart attached to a trade, a session review or a lesson is never indexed — which
is why a journal with hundreds of screenshots can hold a memory library with nothing searchable in
it. The Indexing section says so on the panel rather than leaving the trader to conclude the feature
is broken. Importing them is a real feature, not a wiring detail: a picture attached to a trade
carries no statement of whether it was taken before the decision, and `before-setup`/`entry` are the
only roles a search may match, so an import has to bring them in as something unreviewed (or ask)
rather than assuming the chart was pre-decision. Guessing would put hindsight into the one feature
built to keep it out.
- **The vision re-ranking pass** is not built. `MemoryAiSettings.rerankEnabled` exists and is stored,
but nothing reads it; the ranking is the embedding distance alone.
- **The research dashboard reads the trade log now, but still not the Analytics and Insights screens.**
A setup's execution figures come from the journal's own trades logged under it — the whole log, not
only the ones a sighting points at — and the trades that cannot be joined to a sighting are counted
and named rather than dropped. What it still does not do is reuse those screens' aggregations: it
reads the journal directly, so its denominators are its own and are stated on the panel.
- **The memory schema has been applied, and the client is now checked against the file.** It has
been run against the project this journal syncs to, and it stays additive and re-runnable. What this
repository can verify on its own is that the two halves agree: `db.test.ts` parses
`supabase/schema.sql` and asserts every column and every RPC argument the code sends really exists,
so a name only the client knows fails a test instead of reaching the trader as a 400. Running it is
what made that check worth having — every saved search had been writing `memory_searches.updated_at`
to a table that has only ever had `searched_at`, and the write had been failing outright.
- **The memory endpoint's own rate limit is per instance.** Unlike the coach's, which shares a row in
`coach_quota`, this counter lives in the lambda's memory and resets on a cold start — a speed bump
rather than a quota. That is a deliberate trade: indexing is cheap per call and the real protection
is the session check, and sharing the coach's ledger would reintroduce the self-inflicted outage the
separate function exists to avoid.

### Engine layout

```
src/lib/memory/
  eligibility.ts   what may be matched, and what was knowable when (the hindsight boundary)
  similarity.ts    distance -> normalised resemblance, banding, deterministic ranking
  outcomes.ts      the evidence arithmetic, with every denominator written down
  results.ts       matched cases -> the summary a screen displays
  indexing.ts      resumable backfill arithmetic: batching, capped backoff, retry rules
  backfill.ts      what a run over the existing library should send, and what it is leaving behind
  index-runner.ts  the loop that gives picture after picture an embedding, and stops honestly
  db.ts            the tables and the one similarity query, with the row mappers between them
  evaluation.ts    retrieval-quality measurement over hand-labelled examples
  eval-sources.ts  saved searches + your own verdicts -> the evaluation harness's inputs
  research.ts      seen against taken, per setup, plus that setup's whole trade log, with every
                   denominator written down
  embeddings.ts    the model, version, dimension and what makes a vector usable
  embedding-wire.ts  the request/response contract shared by the client and the handler
  embedding-api.ts the browser's half: post one picture, validate the numbers that come back
  use-memory-indexing.ts  the hook that wires the runner to the database, the bucket and the UI
  storage.ts       the private bucket: paths, checksums, verified uploads, signed URLs, migration
  settings.ts      consent and display settings, with their bounds
src/components/memory/
  TradingMemoryView.tsx       the tab: the section switcher, consent, readiness, settings
  ObservationLibrary.tsx      record, browse, filter, edit, and record what happened after
  MemoryImagePicker.tsx       the private-bucket screenshot picker + signed-URL preview
  MemorySearchView.tsx        pick a chart, search, and save what came back
  MemorySearchResults.tsx     the ranked results, the comparison view, the verdicts
  MemoryResearchView.tsx      where each setup's history goes
  MemoryEvaluationView.tsx    whether retrieval actually finds anything
```

The splitting follows the same rule as the rest of the app: `eligibility`, `similarity`,
`outcomes`, `results`, `indexing`, `backfill`, `index-runner`, `evaluation`, `eval-sources`,
`research` and `settings` are pure and unit-tested with no browser, no bucket and no model.
`storage.ts` is the only file that talks to Supabase Storage, and it is the only file that knows what
a memory screenshot's path looks like. `db.ts` is the only file that knows the tables' column names,
and `embedding-api.ts` is deliberately **not** re-exported from `index.ts`: it is the one module that
reaches the network on the browser's behalf, and keeping it out of that barrel is what stops a future
import dragging a Supabase session into the serverless bundle.

### Database

`supabase/schema.sql` now also creates, additively and safe to re-run:

- `journal-memory` — a **private** bucket (`on conflict ... do update set public = false`, so a
re-run can never hand public access back), with per-user folder policies.
- `trading_observations`, `memory_images`, `memory_outcomes`, `memory_searches`,
`memory_index_jobs` — all RLS-scoped to `auth.uid() = user_id`, keyed on the client's own record ids
so that a snapshot re-sync upserts instead of duplicating.
- `memory_images.embedding` as `vector(768)` with an HNSW cosine index.
- `memory_match_images(...)` — the similarity search, `SECURITY INVOKER` (so RLS applies to the rows
it reads) and with **no `user_id` parameter**: a caller cannot name whose library to search, only
supply their own embedding. Pre-decision roles, a matching model/version and a strict
`observed_at < cutoff` are enforced *in SQL*, so the exclusion is a property of the database rather
than of whichever screen happened to call it.
- `memory_prune_searches(days)` — the search-history retention policy, ninety days by default,
  matching `MEMORY_SEARCH_RETENTION_DAYS`. It is a function you call rather than a trigger: retention
  is a decision about your own history, so it stays something you can ask for and read the result of.

The embeddings themselves are deliberately **not** in the journal snapshot: a 768-dimension vector
per screenshot would turn a synced document that is meant to stay small into megabytes of numbers.
The snapshot keeps the *description* of an embedding — model, version, dimension, status — and the
vector stays in Postgres.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 3000 (host `0.0.0.0`). |
| `npm run build` | Production client build into `dist/`. |
| `npm run build:function` | Regenerates the committed `api/coach.js` bundle. |
| `npm run preview` | Serves the production build. |
| `npm test` | Unit tests (vitest, node environment, `src/**/__tests__`). |
| `npm run e2e` | Playwright specs in `e2e/` (desktop + Pixel 7 projects). |
| `npm run lint` | `tsc --noEmit`. |
| `npm run verify:coach` | Real coach call in-process, to check the key and models. |
| `npm run clean` | Removes `dist/` and `server.js`. |

---

## Architecture

```
src/
  App.tsx                  view composition, modals, tab routing
  types.ts                 the data model (TradingDay, Trade, DailyReview, ...)
  components/              by feature: today, trades, history, analytics,
                           insights, coach, playbook, memory, settings, common, layout
  lib/
    storage/               localStorage persistence + date helpers + failure reporting
    journal/               useJournalStore (records) + useCloudSync (load/save/conflict)
    cloud-sync.ts          revision-checked Supabase snapshot read/write
    trading/               P&L, R, risk, scale-in grouping, Tradovate CSV import
    analytics/             aggregations, expectancy, drawdown, discipline, insights
    ai/                    digest, prompt, response validation, checkpoint cache
    memory/                observation eligibility, similarity, outcomes, private storage
    playbook/              chart-pattern content, registry, geometry, timeline, deep links
  api/coach.ts             the serverless handler (bundled to api/coach.js)
supabase/schema.sql        tables, RLS policies, storage bucket, coach quota
scripts/                   bundle + coach diagnostics
e2e/                       Playwright specs
```

Data flow: **localStorage is the working copy**; the cloud snapshot is a sync target, not a
source of truth. Every edit goes through `src/lib/storage/index.ts`, which is the only module
that touches storage keys, so a failed write is reported once, in one place.

A few conventions worth knowing before editing:

- **Imported trades keep their provenance.** `source`, `importId`, `positionId` and
  `riskSource` are not editable from the trade form. An imported trade stays an import, and a
  stop the importer invented stays labelled as assumed so its risk and R are never presented
  as real.
- **A trade stays on the day it was taken.** Editing an old trade's notes must not move it
  into today's session.
- Attaching a debt-free `updatedAt` to every entity is what the coach's "has this changed?"
  fingerprint and the checkpoint cache compare.
- Views are lazy-loaded per tab; `Today` is the only eagerly imported tab.

### Storage limits

Trade, playbook and chart-pattern **images are inlined as compressed JPEG data URLs** in the
snapshot (`src/lib/utils/image-utils.ts`), which is fine for a handful and dangerous at a few
hundred:
browsers give a site roughly 5 MB. **Videos are uploaded to Supabase Storage** instead and
referenced by URL (`src/lib/media/media-utils.ts`), because a clip is megabytes of base64.

**Trading Memory screenshots are the exception, deliberately.** They are the one kind of picture this
app expects to accumulate into the hundreds, so they are uploaded to the private `journal-memory`
bucket and referenced by path (`src/lib/memory/storage.ts`) — never inlined, in either the browser or
the snapshot. The migration helper `migrateObservationImages` moves any that were written inline
(which is what happens with no cloud to upload to) into the bucket, verifying each object before it
drops the original, and leaving the picture untouched when the move fails.

When a write fails — quota reached, storage blocked, stored JSON unreadable — the app now
shows a sticky warning on every tab naming what was lost and what to do, instead of failing
silently. If you add a large field to an entity, remember it lands in both localStorage and
every cloud save.

---

## Testing

- **Unit tests** (`npm test`) cover the calculation layer, the coach digest and prompt, the
  storage layer, the cloud save/resolve rules, and the chart-pattern content itself: all 20
  entries, their required sections, the geometry's direction matching each bias, and the
  timeline maths. They run in the node environment; a fake `localStorage` / `window` is
  installed per test, and cloud tests mock the Supabase client.
- **E2E tests** (`npm run e2e`) start the dev server with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` **stripped**, so the app boots in local-only mode (no auth screen)
  and the specs drive the journal UI directly.
- Nothing may live in `api/` except the generated bundle: the host turns every file in that
  directory into a function, so a stray test file there would be deployed as one.

---

## Deploying

Any host that serves a Vite build and Node serverless functions works; the checked-in
`vercel.json` sets a 60-second budget for `api/coach`. Before deploying:

1. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   and `GEMINI_API_KEY` in the host's environment for **Production** (the server-only vars
   must not be `VITE_`-prefixed).
2. Run `supabase/schema.sql` against the project (again, after any schema change).
3. Run `npm run build:function` if you touched `src/api/coach.ts`, and commit the result.
4. Confirm `GET /api/coach` reports `keyConfigured: true` and `access.authRequired: true`
   once deployed. If `authRequired` is false, the coach is answering anybody who finds the
   URL, limited only by IP. After one signed-in coach request, `access.sharedQuota` should
   read `"available"` — `"unavailable"` means the `coach_quota` table is missing, so step 2
   needs re-running and the per-user limit is only per instance until it is.

## Known gaps

- A signed-in trader's coach rate limit is global, but the per-IP ceiling for the anonymous
  fallback is still per function instance. That path only runs on a deployment with no
  server-side Supabase credentials, which has nowhere to share a count.
- Until `supabase/schema.sql` is re-run against a project, `coach_quota` does not exist and
  the endpoint silently falls back to its per-instance counter. `GET /api/coach` reports
  `sharedQuota: "unavailable"` once that has happened.
- A deployment with no server-side Supabase credentials falls back to per-IP limiting for
  the coach rather than refusing to serve it.
- Cloud sync resolves a clash by keeping this device's copy and setting the other aside,
rather than merging (see above). A copy replaced by a sync is downloadable from Settings,
but only the most recent one is kept.
- `npm run lint` is only `tsc --noEmit`; there is no ESLint config and no CI workflow.
- **Trading Memory's pipeline has never been run end to end.** The embedding endpoint, the indexing
runner, the vector search, the results screen, the research dashboard and the retrieval evaluation
are all built, and every rule inside them has unit tests — but the last step of the chain is a
network call this repository cannot make on its own. So `POST /api/memory`, `memory_match_images`,
the private bucket and the stored vectors have been exercised **only against fakes and against the
generated bundle's shape**, never against a live Supabase project or a live Gemini key. Expect the
first real run to find something: the most likely candidates are the embedding model's exact name
and its `outputDimensionality` support, the RPC's `vector` cast over PostgREST, and the storage
policies. Each of those fails loudly and says which one it was rather than degrading quietly, and
the endpoint's `GET` health check reports whether its key is visible before anything is sent.
- **`journal-media` is still public-read**, and `schema.sql` re-asserts it on every run. It holds
the videos already attached to trades and lessons, whose stored URLs are their canonical address, so
flipping the flag would break them with no way to identify which records were affected. Closing that
means re-pointing every stored video URL at a private bucket and switching the app to signed URLs —
a migration that has to run *before* the flag moves, which is why it is not bundled in with the new
private bucket. Until then, any video already attached to a record is reachable by anyone holding its
URL (paths carry a random suffix, so they cannot be guessed).

  That migration is scoped rather than guessed at, and deliberately not started half-way: a stored
  path with readers still expecting a URL would break every existing clip, which is the one outcome
  the public bucket currently avoids. What it takes, in order:

  - A private `journal-videos` bucket with the same per-user folder policies as `journal-memory`,
    created additively. The `journal-media` insert keeps re-asserting `public = true` until the flip,
    so a re-run cannot half-apply this.
  - `uploadMediaFile` stores the object **path** in `media` rather than the public URL, which is what
    lets a signature be minted per read instead of being baked into the record — the rule the memory
    pictures already follow.
  - Every reader of a video resolves one on demand: `TradeCard`, `TradeDetailModal`,
    `ImageLightboxModal`, `LessonsView`, `PlaybookView`, `YesterdayFocusBanner`, `LatestReviewCard`,
    `ImageUploader` and `journal-digest`, which excludes clips from the coach's prompt by the same
    test. `isVideoUrl` has to keep classifying a stored value throughout, because it is what tells a
    clip from a screenshot on all of those screens — so it must accept the old URL and the new path
    while the two coexist.
  - A migration routine in the shape of `migrateObservationImages` (prove the object is readable
    before dropping the old reference, report what moved, safe to re-run), and only after it has run
    against the real library does the bucket flag move.
- **The memory schema is applied, but not by this repository.** It has been run against the project
this journal syncs to. `db.test.ts` now checks every write's columns and the search's RPC arguments
against the schema file itself, so the client and the SQL cannot drift apart unnoticed — but nothing
here can prove that a live Supabase accepts the `vector` literal on the wire, or that the storage
policies admit the paths the uploader builds.
