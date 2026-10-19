# Chart Pattern Playbook — installation

This is a **static web app**. It has no installer, no account and no server. Everything
runs in your browser.

## What you need

**Nothing external.** No Supabase project, no Gemini API key, no server, no account, no
subscription. Serve the folder and open it.

This purchase is the Chart Pattern Playbook only. It does **not** include the full Trading
Journal, the AI Coach or Trading Memory. Those are separate products, and they require
services you provide yourself — your own Supabase project and your own Gemini API key. None
of that is needed here.

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

## 3. Your data

Status, checklist ticks, notes and example screenshots are saved in this browser's local
storage. They stay on your device.

- **Export** (header) writes a JSON file with everything you have studied.
- **Import** reads that file back, or a full backup from the Trading Journal, so your notes
  can move between the two.

Export before clearing browser data, changing computers, or switching to a private window.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page | Opened with `file://` | Serve the folder over HTTP (step 1) |
| "That does not look like a license key" | Key was truncated or pasted with extra text | Paste only the key, like `WTKP4-66NL5-HMKQW-GFSCZ` |
| "This browser refused the save" | Storage is full or blocked | Export what you have, clear site data, import it back |
| Study notes disappeared | Browser data was cleared, or a different browser/device | Import your exported JSON, or re-enter the key and notes |

## Privacy

The playbook makes no network requests. It does not include analytics, tracking, or a market
data feed. Charts you attach are compressed and kept inline in this browser.

## Educational use

Chart patterns are probabilistic descriptions of price behaviour, not guarantees and not
signals. Nothing in this product tells you to buy or sell.
