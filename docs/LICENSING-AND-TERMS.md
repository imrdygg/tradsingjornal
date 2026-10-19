# Licence, ownership and what a buyer may do

Short version: **you buy the right to use this software, not the right to sell it, share it or
republish it.** These are the terms that ship with every product; the product folders carry the
same terms as `LICENSE.txt`.

This page is written for the person selling the products as well as the person buying them, so
the wording on a listing and the wording in the zip cannot drift apart.

---

## 1. What the buyer gets

| Product | Grant |
| --- | --- |
| **Chart Pattern Playbook** | One person, non-exclusive, non-transferable licence to use the product on devices they own, for personal study. |
| **MES Indicator Level Tracker** | The same grant, for personal record-keeping. |
| **Trading Journal, AI Coach, Trading Memory, bundle** | The same grant, plus the right to run and modify the source for their **own trading**. Modifications are theirs; the underlying product is not. |

"One person" is the buyer. A prop firm, a trading group or a team needs one licence per person,
unless the listing says otherwise.

---

## 2. What the buyer may not do

- **Resell or redistribute** the product, its files or its source, in whole or in part.
- **Publish it as their own** product, template, course, or as part of one, whether free or paid.
- **Sublicence, rent, lend or share** their copy or their licence key.
- **Remove or alter** the copyright, licence or attribution notices.
- **Use the code to build a competing product** for sale. Reading it to learn is fine; shipping
  it, renamed, is not.
- **Publish the source** in a public repository, a gist, a file-sharing link or an AI training
  dataset.

They **may** change the code for their own use, keep a private fork, and move their own data in
and out with the export tools.

---

## 3. What the seller does not provide

State this on the listing as well as in the guide:

- No Supabase project, database, storage bucket or account.
- No Gemini API key, credits or model quota.
- No hosting, serverless deployment, domain or ongoing operations.
- No guarantee that the buyer's broker contract specs match the shipped defaults — the catalog is
  editable and the buyer is expected to correct it.

The buyer's Supabase and Google accounts are their own, and usage bills to them. This is a
software sale, not a subscription and not a hosted service.

---

## 4. How the protection actually works — and what it is not

Being plain about this is part of the terms, not a weakness in them:

- **The static products** check a licence key offline: format, a stored copy in the buyer's
  browser, and a seven-day trial. That is a receipt check, not DRM. It cannot confirm a key was
  actually sold, because a static zip has no server to ask.
- **The code-based products** can verify a key server-side, but only if the seller runs a
  verification endpoint. The repository does not ship one, and it does not contain a secret that
  would let a static product check a sale.
- **Minified code is not protection.** The source of the journal products is delivered as source
  by design, because the buyer must rebuild it with their own Supabase URL and Gemini key.
- **What actually protects the product** is copyright, the licence above, and the fact that the
  buyer is paying for a maintained, documented, working system rather than a file.

Do not claim encryption, licence servers or "unhackable" protection on a listing. A claim the
product cannot back up is worse than the copying it was meant to stop.

---

## 5. Third-party services and their terms

- **Supabase** — the buyer's own project, subject to Supabase's terms and pricing.
- **Google Gemini** — the buyer's own key, subject to Google's terms and usage pricing.
- **Chart provider and quote feeds** — used under the provider's terms; the app does not
  redistribute market data.
- **Payhip / the store** — handles the sale, receipts, refunds and tax. The seller's obligations
  there are separate from this licence.

---

## 6. Attribution and notices to keep

If the buyer modifies and self-hosts, keep the copyright line and this licence with the copy.
That is the whole requirement: no banner, no backlink, no runtime phone-home.

---

## 7. What to put on the listing

Use this block verbatim, or close to it:

> **Licence:** one person, personal use. You may modify the code for your own trading. You may
> not resell, redistribute or republish it, or ship it as part of another product. The licence
> file is included in the download.
>
> **You provide the services:** this is software, not a hosted account. Cloud sync, the AI coach
> and Trading Memory use **your own** Supabase project and Gemini API key. Usage is billed to
> your accounts. The setup guide is included; no database, API credits, hosting or deployment
> work is provided.

For the two static products, add:

> **Nothing external is required.** No Supabase project, no API key, no server. A static host is
> enough.
