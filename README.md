# Pingbox — Free Email Validation Tool

Validate email addresses locally with real DNS, MX, and SMTP checks.
No signup, no cloud service — everything runs on your own machine and
your email list never leaves your computer.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The app itself — open this in your browser |
| `server.js` | A small local server that does the real DNS/MX/SMTP checks |
| `START-PINGBOX.bat` | Double-click to start the server (Windows) |

## Requirements

- **Node.js** (any recent version, 16+) — that's it. No npm packages, no
  internet access needed beyond DNS/SMTP lookups for the emails you check.
  Download it free from **https://nodejs.org** (pick the "LTS" version).

## How to run it (Windows)

1. **Install Node.js** if you don't already have it — run the installer
   like any normal app, click through, done.
2. **Double-click `START-PINGBOX.bat`.**
   - A black console window will open and start the server.
   - Keep that window open while you use Pingbox — closing it stops the
     server (the app still works without it, just with fewer checks —
     see below).
3. **Open `index.html`** in your browser (double-click it, or right-click
   → Open with → your browser of choice).
4. Look at the top-right of the page — it should say **"MX + SMTP live"**
   with a green dot. That means the server is connected and you're
   getting full validation (DNS + MX + SMTP).

That's it — paste an email, paste a list, drop a CSV/Excel file, or
paste a Google Sheets/Dropbox link and go. Each run validates up to
**1,000 emails**.

## Running without the server

If you skip step 2 (no Node.js, or you just don't want to run the
server), the app still works — it falls back to syntax + disposable +
role-based checks done entirely in the browser. The status badge will
show **"MX offline"** in that case. You'll still get useful results,
just without the live mail-server verification.

## Uploading Excel files or sheet links

- **.xlsx / .xls files** work the same as CSV — drop them in or click
  to browse. This needs an internet connection the first time (it
  loads a small parsing library), but your spreadsheet data itself
  never leaves your computer.
- **Google Sheets / Dropbox links** — paste a link in the "Upload CSV"
  tab and click Fetch & Validate. The sheet must be shared as
  **"Anyone with the link can view"**. Your browser fetches the file
  directly; Pingbox never sees or stores the link.

## Notes

- Everything runs locally — no data is sent to any third-party server.
- Works on Mac/Linux too: just run `node server.js` from a terminal in
  this folder instead of double-clicking the `.bat` file, then open
  `index.html` as usual.

## Hosting a public demo on GitHub Pages

`index.html` is self-contained and detects when it's not running on
your own machine — it automatically switches to **Demo mode** (instant
browser-side checks, no attempt to reach a local server, no scary
"offline" warning). To publish it:

1. Push this folder to a GitHub repository.
2. In the repo: **Settings → Pages → Build and deployment → Source:
   "Deploy from a branch"** → pick `main` and `/ (root)` → **Save**.
3. GitHub gives you a URL like `https://yourname.github.io/pingbox/`
   within a minute or two — share that link.

Visitors to that link get syntax + disposable + role-based checks
only (no real MX/SMTP — that needs a backend, see below). That's
expected and clearly labeled in the UI as "Demo mode."

**Heads up if you later add a real backend:** right now this app's
whole pitch is "your data never leaves your computer." The moment you
point the hosted demo at a shared backend server (instead of each
visitor's own local `server.js`), every visitor's emails start
flowing through *your* server instead of staying local. That's a
deliberate decision to make later, not an accident — worth deciding
before wiring it up.
