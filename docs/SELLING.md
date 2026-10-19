# Selling this: what to list, at what price, and with what words

This is the seller's page. It answers three questions in order: **what is actually for sale**,
**what each listing should say**, and **what still has to be done before money can be taken**.

The buyer-facing requirements live in [`BUYER-SETUP.md`](BUYER-SETUP.md); the licence grant
lives in [`LICENSING-AND-TERMS.md`](LICENSING-AND-TERMS.md). Those two are the source of truth
for *what the buyer must provide* and *what the buyer may do with it*. This page must not
contradict them — if a price or a promise here disagrees with them, they win.

---

## 1. What is for sale

Four listings, not ten. The app has ten tabs, but a tab is a screen inside a product, not a
product: selling "the Insights tab" on its own would mean shipping a build nobody can run
without the rest.

| # | Listing | What the buyer downloads | Status |
| --- | --- | --- | --- |
| 1 | **Chart Pattern Playbook** | `release/chart-pattern-playbook-<version>.zip` — static site + docs + EULA | **Ready to list today.** |
| 2 | **MES Indicator Level Tracker** | `release/mes-indicator-level-tracker-<version>.zip` — same shape | **Ready to list today.** |
| 3 | **Trading Journal** (journal + AI coach + Trading Memory) | Source code, buyer builds it with their own Supabase project and Gemini key | Ready as a product; needs a delivery decision (section 5) |
| 4 | **All-in-One** (1 + 2 + 3) | Every zip plus the full source | Ready as a product, same caveat |

**Do not sell the coach or the memory as their own downloads.** They are not separate builds:
both mount inside the same journal shell, read the same journal snapshot, and share
`supabase/schema.sql`. Split into their own SKUs they would each need their own build, their own
docs and their own support surface, and the buyer would have to run three apps to get one
workflow. They are features *of* the journal, priced as part of it.

---

## 2. Prices

One-time prices, no subscription. The comparison a buyer will make is a hosted journal at
$30–$50/month (Tradervue $29.95–$49.95/mo, TradeZella $35/mo, Edgewonk ~$197/year), so a
one-time price under about four months of a subscription reads as obviously cheap and still
pays for the work.

| Listing | Launch price | Later price | Why |
| --- | --- | --- | --- |
| Chart Pattern Playbook | **$29** | $39 | 20 illustrated setups with a study journal; static, zero setup, easy impulse buy. |
| MES Indicator Level Tracker | **$39** | $49 | Narrower audience (MES only) but a niche tool that replaces a spreadsheet; priced for that niche. |
| Trading Journal (journal + coach + memory) | **$149** | $199 | This is the real product: planning, executions, reviews, analytics, coach, memory. One-time, self-hosted. |
| All-in-One | **$199** | $259 | Everything, including both static tools. The bundle exists to make $199 the obvious choice over $149. |

Rules that keep the pricing honest:

- **Never claim it is a subscription.** It is not: the software runs on the buyer's accounts.
- **Never price the bundle so the two static products look free.** `$199 ≈ $149 + $50` is fine;
  `$149` for the bundle would poison every future sale.
- **Discount with coupons, not with a permanently low list price.** A launch coupon ("LAUNCH30")
  leaves room to raise the number later without looking like a price increase to existing buyers.
- **Refunds through the store.** State the refund window on the listing and honour it. A static
  zip cannot be un-shipped, so the promise is the only thing being kept.

---

## 3. Listing copy

Copy the blocks below into the store. Keep the "What it is not" and "You provide" paragraphs —
they are what keeps the refund rate down, because they set the expectation before the sale.

### 3.1 Chart Pattern Playbook — $29

**Short description**

> Twenty chart-pattern reference setups with staged, teachable illustrations and a private
> study journal. Runs entirely in your browser, offline, with no account.

**What is inside**

> - 20 setups — 10 reversal, 10 continuation — in the order of the reference sheet.
> - A staged illustration for every pattern: prior trend → formation → structure complete →
>   break → retest and measured move. Pause it, step through it, or replay it.
> - A full study guide per pattern: definition, market story, required structure, formation
>   sequence, confirmation, invalidation signs, targets, common mistakes, checklist.
> - Your own study journal: status, the pre-trade checklist, notes, and logged examples with
>   before/after screenshots.
> - Export and import, so notes move between devices or into the full Trading Journal.

**What it is not** *(keep verbatim)*

> No signals, no alerts, no predictions, no market data feed. Chart patterns are probabilistic
> and educational. A pattern is never called confirmed until a candle closes beyond the
> structure. Nothing in this product tells you to buy or sell.

**Requirements** *(required block)*

> **Nothing external is required.** No Supabase project, no API key, no server, no account. A
> static host is enough — or the included `serve` instructions. This product does not include
> the Trading Journal, AI Coach or Trading Memory.

**Licence** *(required block)*

> One person, personal use. The licence file is included in the download.

### 3.2 MES Indicator Level Tracker — $39

**Short description**

> A private, offline journal of the levels your MES indicator prints: log each line per session
> and per chart, then read what actually happened at it. No account, no server, no market data
> feed.

**What is inside**

> - Daily Log: six charts (1m, 3m, 5m, 15m, 30m, 1h), with price, side, how many times a line
>   was tested, how many held and how many broke, plus tags and notes.
> - Dashboard: reliability, strength (shrunk toward 50%), grade and a confidence dot counted in
>   decisive tests; notable levels by chart and side.
> - All Levels, Patterns and Timing views, with CSV export.
> - Full JSON backup and restore, and opt-in demo data.

**What it is not** *(keep verbatim)*

> No signals, no alerts, no predictions, no live quotes. A level's reliability describes the
> tests you logged — never a claim about the next test. When nothing decisive has happened, the
> app shows a dash instead of a zero.

**Requirements** *(required block)*

> **Nothing external is required.** No Supabase project, no API key, no server, no account, no
> live quote subscription. A static host is enough; the prices in it are the ones you type.
> This is the MES tracker only — the Trading Journal, AI Coach and Trading Memory are separate
> products and are not included.

### 3.3 Trading Journal (journal + AI coach + Trading Memory) — $149

**Short description**

> A private futures trading journal you run yourself: plan the day, record executions, review
> them honestly, and get a coach that reads only your own records. Source code included.

**What is inside**

> - **Today**: the session's levels, settings and routine, and the day's numbers.
> - **Trades**: hand entry or Tradovate CSV import, screenshots, honest provenance — an assumed
>   stop stays labelled as assumed, so R is never presented as real when it was not.
> - **Reviews and Analytics**: per-trade execution reviews and an end-of-day review producing a
>   discipline score, expectancy, R, drawdown and consistency, all read against that score.
> - **Insights and Coach**: patterns in your own record, and a coach given only your journal.
> - **Markets and Playbook**: the contract catalog (any futures contract, or stocks/ETFs by
>   their own point value and tick) and 20 chart-pattern studies.
> - **Trading Memory**: a private library of chart sightings, searchable by resemblance, with a
>   hard boundary — only a chart taken *before* the decision may ever be matched on.
> - **Cloud sync** with conflict recovery, so a device that overlaps another cannot silently
>   delete the older copy.

**Requirements** *(required block — do not soften it)*

> **You provide the services.** This purchase is the software, not a hosted account. Cloud
> sync and sign-in need your own Supabase project (URL + anon key); the AI coach and chart
> memory need your own Gemini API key, and memory also needs the Supabase `vector` extension and
> the private `journal-memory` bucket. The app runs local-only without either. Usage is billed to
> your accounts. The setup guide is included; the seller does not provide a database, API
> credits, hosting, or deployment work.

**Licence** *(required block)*

> One person, personal use. You may modify the code for your own trading. You may not resell,
> redistribute or republish it, or ship it as part of another product. The licence file is
> included.

### 3.4 All-in-One — $199

Same copy as 3.3, with two changes:

> - **Includes both static products**: the Chart Pattern Playbook and the MES Indicator Level
>   Tracker, as ready-to-serve zips.
> - **Includes every built artifact and the full source**, plus the setup guide that walks
>   through Supabase, Gemini and hosting in order.

And the same "You provide the services" block. Never omit it: the bundle is the listing most
likely to attract a buyer who expects a hosted account.

---

## 4. What the store handles, and what it does not

Using [Payhip](https://payhip.com) (the flow already written for both static products in
`products/*/PAYHIP.md`):

- Payhip takes the payment, receipts, refunds, VAT/sales tax and the download delivery.
- Turn on **Generate unique license keys for each sale** for the two static products. Both apps
  check a key's shape and keep it in the buyer's browser; this is a receipt check, not DRM, and
  the activation screen says so.
- For the source product (3 and 4) the licence is the EULA. There is no server-side key check
  shipped in this repository, so say "licence: one person" and mean it as a licence, not as
  enforcement. Do not advertise copy protection the code cannot provide.

---

## 5. Before you collect revenue

Done already:

- [x] Both static products build, package and verify (`npm run package:chart-patterns`,
      `npm run package:mes`; the packager refuses a zip missing `index.html`, `INSTALL.md`,
      `LICENSE.txt`, `README.md` or `version.json`).
- [x] Both check a licence key offline and offer a 7-day trial.
- [x] Buyer install guides, EULA, licence page and the delivery matrix are written and linked
      from the README.
- [x] The journal runs local-only with no keys, so a buyer can evaluate it before configuring
      anything.
- [x] Ten-tab navigation works on desktop and on a phone (`e2e/navigation-history.spec.ts`).

Still to do before the first sale:

1. **A store account and tax details.** Payhip (or Lemon Squeezy / Gumroad) in the seller's own
   name, with payout and tax information complete. Without this there is nothing to collect
   revenue into.
2. **Create the four products** with the copy above, license keys enabled for the statics, and
   `LAUNCH30`-style coupons for the first customers.
3. **Decide how the source product is delivered.** Recommended: a zip of the repository without
   `.git`, `.env*`, `supabase/` secrets, `node_modules`, `dist` or `release`, plus `SETUP.md`
   (section 3 of `BUYER-SETUP.md`) and `LICENSE.txt`. State the Node version, and that the buyer
   must rebuild after adding their own keys.
4. **A demo.** The store converts far better with one. For the statics, host the built folder on
   Netlify Drop or Cloudflare Pages and link it. For the journal, host a local-only build (no
   Supabase env vars) as a read-only demo, and say that data lives in the visitor's browser.
5. **Screenshots.** 3–6 per listing: the grid and one open study guide (playbook); a Daily Log
   form and the Dashboard (MES); Today, Trades and the coach (journal); Trading Memory's library
   and a comparison (bundle).
6. **Support boundaries on every page.** One business day response, setup guide included, no
   deployment work, refunds through the store.
7. **The disclaimers.** Educational software, not financial advice; past results are not future
   results; the buyer's data and backups are their own responsibility.

Known limits to state, not to hide:

- The full journal is delivered as **source**; there is no hosted version, no managed database
  and no seller-run demo account.
- **Trading Memory does not work as a static site.** It needs a Supabase project with `vector`
  and a Gemini key. A buyer who only wants an offline journal should be told that up front.
- The MES tracker is **MES only**; the journal's catalog covers any contract the buyer adds.
- Licence enforcement for the source product is contractual, not technical.

---

## 6. One-paragraph answer

Sell **four listings**: the Chart Pattern Playbook at **$29**, the MES Indicator Level Tracker at
**$39**, the full Trading Journal (journal + AI coach + Trading Memory, source) at **$149**, and
an All-in-One bundle at **$199**. The first two are ready to upload today. The last two are
complete software with buyer docs and an EULA; what they still need is a store account, a demo
link, screenshots and a delivery zip for the source — not more code. Do not split the ten tabs
into ten products: the coach and the memory only exist inside the journal.
