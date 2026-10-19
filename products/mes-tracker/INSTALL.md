# MES Indicator Level Tracker — installation

This is a **static web app**. It has no installer, no account and no server. Everything runs
in your browser.

## What you need

**Nothing external.** No Supabase project, no Gemini API key, no server, no account, no live
market-data subscription. The prices in the tracker are the ones you type. Serve the folder and
open it.

This purchase is the MES Indicator Level Tracker only. It does **not** include the full Trading
Journal, the AI Coach or Trading Memory. Those are separate products, and they require services
you provide yourself — your own Supabase project and your own Gemini API key. None of that is
needed here.

## 1. Put the folder online

The folder must be served over `http://` or `https://`. **Double-clicking `index.html` will
show a blank page** — browsers block the app's module scripts on `file://`.

Pick whichever is easiest:

**Netlify Drop (no account needed to try)**

1. Go to <https://app.netlify.com/drop>.
2. Drag this whole folder onto the page.
3. Open the URL it gives you. Bookmark it.

**Cloudflare Pages / GitHub Pages / any web host**

Upload the folder as-is. There is no build step and no environment variable to set.

**On your own machine**

```bash
npx serve .
```

Then open the address it prints (usually <http://localhost:3000>).

## 2. Activate

On first run the app asks for a license key.

- Paste the key from your Payhip receipt, or
- press **Try it for 7 days first**.

The key is checked and stored in this browser only. Nothing is sent anywhere. If you clear
your browser data, paste the key again — it is still in your receipt.

## 3. Start tracking

The app opens on **Dashboard**. To log a level:

1. Open **Daily Log**.
2. Set the session date.
3. Press **Add** on the chart the level belongs to (1m, 3m, 5m, 15m, 30m, 1h).
4. Enter the price, side, and what happened when price reached it.
5. **Save level.**

The form stays open and keeps the chart selected, so a run of levels can be keyed in without
reopening it. **Load demo data** on the Data tab fills the record with a few sample weeks if
you want to see the charts first.

## 4. Your data

Everything is stored in this browser's local storage under `ptj_mes_levels_v1`.

- **Data → Download JSON** writes a full backup.
- **Data → Download CSV** writes a spreadsheet copy.
- **Data → Restore from file** replaces the whole record from a JSON backup, after a
  confirmation. It also accepts a full Trading Journal backup, so levels can move between the
  two.

Export before clearing browser data, changing computers, or switching to a private window.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page | Opened with `file://` | Serve the folder over HTTP (step 1) |
| "That does not look like a license key" | Key was truncated or pasted with extra text | Paste only the key, like `WTKP4-66NL5-HMKQW-GFSCZ` |
| "This browser refused the save" | Storage is full or blocked | Export what you have, clear site data, import it back |
| Restore says the file has no MES levels | Wrong file | Use a tracker JSON backup or a full journal backup |
| Levels disappeared | Browser data was cleared, or a different browser/device | Restore your JSON backup |

## Privacy

The tracker makes no network requests. It does not include analytics, tracking, or a market
data feed. The prices in it are the ones you typed.

## Educational use

This is a record of what you observed. It is not financial advice, and a reliability figure
is a description of past tests, not a prediction.
