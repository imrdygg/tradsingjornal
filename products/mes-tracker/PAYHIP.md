# Payhip setup — MES Indicator Level Tracker

This file is for the seller and is **not** included in the product zip.

## 1. Create the product

- Add a product → **Digital download**.
- Name: `MES Indicator Level Tracker`.
- Upload `release/mes-indicator-level-tracker-1.0.0.zip` (built by
  `npm run package:mes`).
- Screenshots: the Dashboard, a Daily Log form with a level being entered, the Patterns
  breakdown, and the Timing chart.
- Use the copy in `README.md`. Keep the "What it is not" section.

## 2. Turn on license keys

In the product's **Advanced Options**:

- Enable **Generate unique license keys for each sale**.
- Copy the **product secret key** for your records (only needed for a future server-verified
  product; this app checks the key's shape offline).
- Do not upload a pre-generated list unless you intend to sign keys yourself.

The 7-day trial is built in and per browser. Payhip does not need to know about it.

## 3. Test the funnel before publishing

1. Create a 100% coupon.
2. Buy the product with it.
3. Confirm the order delivers the zip **and** a license key.
4. Unzip, serve the folder, paste the key, log a level, reload, and export a backup.
5. Refund the test order and confirm Payhip disables that key.

## 4. What not to upload

- Do not upload the source repository.
- Do not include `.env` files, `supabase/`, `api/`, or any `GEMINI_API_KEY`.
- The zip is the built site plus docs only; `npm run package:mes` verifies that no cloud
  client ships in the JavaScript.

## 5. Listing must state

- **Requires nothing external**: no Supabase project, no Gemini API key, no server, no
  account, no live quote subscription. A static host is enough; prices are typed by the buyer.
- This is the **MES Indicator Level Tracker only**. The Trading Journal, AI Coach and Trading
  Memory are separate products and are not included.
- Data lives in the buyer's browser; backups are the buyer's responsibility.

## 6. Support boundaries

State these on the product page:

- Static product: no account, no sync, no server, no live market data.
- $MES only, six charts; the prices are the ones the buyer typed.
- Backups are the buyer's responsibility; the Data tab exports JSON and CSV.
- A reliability figure describes logged tests, not future outcomes.
- Refunds and support through Payhip.
