# Buyer setup: what we sell and what the buyer provides

This repository is sold as **software**, not as a hosted service. We do not run the buyer's
database, host their account, or pay for their model calls. Each product's page and install
guide must say what the buyer has to provide before they buy.

The two static mini-products need nothing external. The journal, coach, memory and bundle
products do: the buyer supplies their own Supabase project, their own Gemini API key and
their own hosting. This document is the source of truth for those requirements and the
instructions that ship with the code-based products.

---

## 1. Delivery matrix

| Product | What the buyer receives | What the buyer must provide |
| --- | --- | --- |
| **Chart Pattern Playbook** | Built static site (`index.html` + `assets/`) | A static host (Netlify Drop, Cloudflare Pages, GitHub Pages, or `npx serve`). Nothing else. |
| **MES Indicator Level Tracker** | Built static site | A static host. Nothing else. No market-data key. |
| **Trading Journal** | Source code + build, or a source-only tier | Node 20.19+ to build; a **Supabase project** (URL + anon key) if they want login and cloud sync. Without it the app runs local-only. Ships no data: the instrument catalog is editable and the journal starts empty. |
| **AI Coach** | Source code + `api/coach` function | The journal, plus a **Gemini API key** and a Node host that runs serverless functions (Vercel or equivalent). A Supabase project is required to require sign-in; without it the endpoint falls back to per-IP limits. |
| **Trading Memory** | Source code + `api/memory` function + SQL | A **Supabase project with the `vector` extension**, the private `journal-memory` bucket, and a **Gemini API key** for embeddings. It does not work as a static site. |
| **All-in-One Bundle** | Full source + every built product + SQL + setup guide | Everything above: Supabase, Gemini, a host with functions, and their own domain if they want one. |

**Never ship a built `dist/` as the only deliverable for the journal/coach/memory.** Vite
inlines `VITE_*` variables at build time, so a buyer cannot point a prebuilt bundle at their
own Supabase project without rebuilding. Those products ship **source + instructions**.

---

## 2. What the seller does not provide

State this on every product page:

- No Supabase project, database, storage bucket, or account.
- No Gemini API key, credits, or model quota.
- No hosting, serverless deployment, or domain.
- No ongoing operations, backups, or monitoring of the buyer's deployment.
- No custom deployment work beyond the written guide.

The buyer's Supabase and Google accounts are their own, and usage is billed to them.

---

## 3. Setup guide for a code-based product

This is the checklist to ship as `SETUP.md` with the journal/coach/memory/bundle. Keep it in
the product folder and include it in the zip.

### 3.1 Prerequisites

- Node `^20.19.0 || >=22.12.0` and npm.
- A Supabase account (free tier is enough to start).
- A Google AI Studio account with a Gemini API key (coach and memory only).
- A host that can run Vite's static build **and** Node serverless functions (Vercel is what
  this repository targets).

### 3.1.1 Create the accounts the software uses

None of these accounts are the seller's, and none are created for the buyer. Each takes a few
minutes and can be on a free tier to start.

**Supabase — database, sign-in and screenshot storage**

1. Go to <https://supabase.com/dashboard> and sign up (GitHub or email).
2. **New project**: pick an organisation, a name, a strong database password, and the region
   closest to the buyer.
3. Wait for provisioning, then open **Project Settings → API** and copy the **Project URL** and
   the **anon public** key. These are the two client values.
4. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and run it once.
   It creates the tables, the row-level-security policies, the `coach_quota` table, the `vector`
   extension and the private `journal-memory` bucket, and it is safe to re-run after upgrades.
5. Open **Authentication → Providers → Email** and decide whether to require email confirmation.
   For a personal single-user journal, turning confirmation off is the usual choice.

**Google AI Studio — the Gemini key for the coach and embeddings**

1. Go to <https://aistudio.google.com/apikey> and sign in with a Google account.
2. **Create API key**. Choose a Google Cloud project (a new one is fine).
3. Copy the key. It is shown once; store it in a password manager.
4. Treat it as server-only: never put it in a `VITE_*` variable, never commit it, never ship it
   in a static site. Billing and quota are on that Google account.

**Hosting — a static build plus the serverless functions**

1. Create a free account on the host named in the product guide (Vercel is what this repository
   targets).
2. Install its CLI or connect the Git repository.
3. The build command is `npm run build`; the output directory is `dist`. The `api/` folder is
   deployed as functions by the host automatically.
4. Add the environment variables from 3.3 in the host's dashboard, including the production
   domain so nothing points at localhost.

**What the buyer does not need**

- No account with the seller.
- No broker connection or API key. Fills are typed or imported from a CSV export.
- No market-data subscription. Quotes come from a keyless public endpoint; charts load from the
  provider's public embed.
- No Gemini key at all if they only want the journal, the playbook or the level tracker.

### 3.2 Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor** and run `supabase/schema.sql`.

   There is one schema file, not one per add-on: it creates the journal tables, the coach
   quota table, the memory tables, the `vector` extension and the private `journal-memory`
   bucket. Run the whole file even if the buyer only bought one module — it is additive and
   the extra tables cost nothing.
3. The schema is additive and safe to re-run. Re-run it after upgrading.
4. Read **Project Settings → API**:
   - Project URL
   - `anon` public key

The `anon` key is safe in the browser. The `service_role` key is **not** used by this app and
must never be put in the client or a `VITE_*` variable.

### 3.3 Configure the environment

Copy `.env.example` to `.env.local` and fill in the buyer's own values:

```bash
# Client (inlined at build time)
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon key>"

# Server only (never prefix with VITE_)
SUPABASE_URL="https://<project>.supabase.co"
SUPABASE_ANON_KEY="<anon key>"
GEMINI_API_KEY="<buyer's key>"

# Optional
GEMINI_MODEL="gemini-flash-lite-latest"
COACH_RATE_LIMIT=30
COACH_ANON_RATE_LIMIT=10
MEMORY_RATE_LIMIT=600
```

**Never** prefix `GEMINI_API_KEY` with `VITE_`. Vite publishes every `VITE_*` value to anyone
who opens devtools.

### 3.4 Run it locally

```bash
npm ci
npm run dev            # journal UI on http://localhost:3000
npm run lint
npm test
```

Local `npm run dev` does **not** serve serverless functions. To exercise the coach locally,
use `vercel dev`, or run the in-process checks:

```bash
npm run verify:coach    # one real Gemini call
npm run verify:memory   # one real embedding call
```

### 3.5 Deploy

1. Import the repository/folder into the host.
2. Set the production environment variables (the server-only ones must not be `VITE_`).
3. Run the schema against the production Supabase project.
4. If `src/api/*.ts` changed, regenerate the committed bundles:
   ```bash
   npm run build:function
   ```
   and deploy `api/coach.js`, `api/market.js`, `api/memory.js` with the build.
5. Open `/api/coach` and `/api/memory` on the deployment. Each returns a JSON health check
   saying whether its key is visible and whether sign-in is required.

### 3.6 Verify the buyer's own project

- Sign in, edit a trade, reload, sign in on a second device: the same journal should appear.
- `GET /api/coach` must report `keyConfigured: true` and `access.authRequired: true`.
- `GET /api/memory` must report its key visible before any chart is indexed.
- If `coach_quota` is missing, the health check reports `sharedQuota: "unavailable"`; re-run
  the schema.

---

## 4. Product-page copy (required)

Every listing for a code-based product must include a short block like this:

> **You provide the services.** This purchase is the software, not a hosted account. To run
> the cloud/AI features you need your own Supabase project (URL + anon key) and your own
> Gemini API key. Usage is billed to your accounts. The setup guide is included; the seller
> does not provide a database, API credits, hosting, or deployment work.

For the static products, the block is the opposite and must be explicit:

> **Nothing external is required.** No Supabase project, no API key, no server, no account.
> A static host is enough. This product does not include the Trading Journal, AI Coach or
> Trading Memory.

---

## 5. Security and cost notes to pass on

- Row-level security, not the anon key, is what protects a buyer's data. Do not suggest
  disabling it.
- The Gemini key stays on the server. A static site cannot hold one safely.
- Model calls are billed to the buyer's Google account; rate limits in the app are a guard,
  not a quota the seller pays for.
- If the buyer's Supabase project is deleted or paused, cloud sync and auth stop; the local
  journal still opens.
- Backups are the buyer's responsibility. The app exports JSON (and CSV where relevant).
