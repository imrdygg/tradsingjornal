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
Sync**. Only the most recent copy is held, and none is kept for a journal too large to store
twice (one carrying chart screenshots), where duplicating it would break later writes.

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

> **These counters are per instance.** They live in the function's memory, so each running
> instance enforces its own ceiling and a cold start resets them. That cheaply makes a
> scraped endpoint useless, which is the risk being managed; it is not billing enforcement.
> A shared store would be the next step if you need a hard global quota.

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
  "version": 5,
  "keyConfigured": true,
  "models": ["gemini-flash-lite-latest", "..."],
  "access": {
    "authRequired": true,
    "perUserPerHour": 30,
    "anonymousPerHour": 10,
    "maxInFlight": 2,
    "countersArePerInstance": true
  }
}
```

The health check itself is deliberately unauthenticated and reveals nothing secret; it is
the one place to confirm whether a session is required and that the key is visible to the
function. If you get the app back instead, `api/coach` was not deployed with that build.

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
  App.tsx                  journal state, cloud sync, modals, tab routing
  types.ts                 the data model (TradingDay, Trade, DailyReview, ...)
  components/              by feature: today, trades, history, analytics,
                           insights, coach, playbook, settings, common, layout
  lib/
    storage/               localStorage persistence + date helpers + failure reporting
    cloud-sync.ts          revision-checked Supabase snapshot read/write
    trading/               P&L, R, risk, scale-in grouping, Tradovate CSV import
    analytics/             aggregations, expectancy, drawdown, discipline, insights
    ai/                    digest, prompt, response validation, checkpoint cache
    playbook/              chart-pattern content, registry, geometry, timeline
  api/coach.ts             the serverless handler (bundled to api/coach.js)
supabase/schema.sql        tables, RLS policies, storage bucket
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
   URL, limited only by IP.

## Known gaps

- Coach rate-limit counters are per function instance and reset on a cold start (see above);
  a shared store would be needed for a hard global quota.
- A deployment with no server-side Supabase credentials falls back to per-IP limiting for
  the coach rather than refusing to serve it.
- Cloud sync resolves a clash by keeping this device's copy and setting the other aside,
rather than merging (see above). A copy replaced by a sync is downloadable from Settings,
but only the most recent one is kept.
- `npm run lint` is only `tsc --noEmit`; there is no ESLint config and no CI workflow.
