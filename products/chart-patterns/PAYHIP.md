# Payhip setup — Chart Pattern Playbook

This file is for the seller and is **not** included in the product zip.

## 1. Create the product

- Add a product → **Digital download**.
- Name: `Chart Pattern Playbook`.
- Upload `release/chart-pattern-playbook-1.0.0.zip` (built by
  `npm run package:chart-patterns`).
- Add 3–6 screenshots: the grid, one open study guide mid-animation, the study journal, and
  the activation screen.
- Use the copy in `README.md` for the description. Keep the "What it is not" section: it is
  the claim that protects the refund rate.

## 2. Turn on license keys

In the product's **Advanced Options**:

- Enable **Generate unique license keys for each sale**.
- Copy the **product secret key** for your records. It is only needed if you later verify
  keys server-side; the static playbook checks the key's shape offline and does not call
  Payhip.
- Do not upload a pre-generated list unless you intend to sign keys yourself.

The trial is built into the app (seven days, one per browser). Payhip does not need to know
about it.

## 3. Test the funnel before publishing

1. Create a 100% coupon.
2. Buy the product with it.
3. Confirm the order delivers the zip **and** a license key.
4. Unzip, serve the folder, paste the key, and save a note.
5. Refund the test order and confirm Payhip disables that key.

## 4. What not to upload

- Do not upload the source repository.
- Do not include `.env` files, `supabase/`, `api/`, or any `GEMINI_API_KEY`.
- The zip is the built site plus docs only; `npm run package:chart-patterns` verifies that no
  cloud client ships in the JavaScript.

## 5. Listing must state

- **Requires nothing external**: no Supabase project, no Gemini API key, no server, no
  account. A static host is enough.
- This is the **Chart Pattern Playbook only**. The Trading Journal, AI Coach and Trading
  Memory are separate products and are not included.
- Data lives in the buyer's browser; backups are the buyer's responsibility.

## 6. Support boundaries

State these on the product page so they are not discovered after purchase:

- Static product: no account, no sync, no server. Data lives in the buyer's browser.
- Backups are the buyer's responsibility; the app exports JSON.
- Educational material, not financial advice.
- Refunds and support through Payhip.
