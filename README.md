# Pingbox — Free Email Validation Tool

Validate email addresses locally with real DNS, MX, and SMTP checks.
No signup, no cloud service — everything runs on your own machine and
your email list never leaves your computer.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The app itself — open this in your browser |
| `server.js` | The local server: DNS/MX/SMTP checks, scraping-based suggestions, file upload, image scanning |
| `lib/` | Server modules — typo correction, pattern detection, scraping, company lookup, upload parsing, OCR, card-text parsing |
| `package.json` | Two dependencies (see below) |
| `START-PINGBOX.bat` | Double-click to start the server (Windows) |

## Requirements

- **Node.js** (any recent version, 16+). Download it free from
  **https://nodejs.org** (pick the "LTS" version).
- Two npm dependencies — the only exceptions to "no dependencies,"
  both for things Node genuinely can't do on its own:
  - **`xlsx`**, for reading `.xlsx`/`.xls` files uploaded directly to
    the server (Excel's binary format can't be parsed natively).
  - **`tesseract.js`**, for reading text out of business-card photos
    (OCR). The first time you scan an image, it downloads a small
    (~5MB) language file once and caches it locally — after that it
    works fully offline.

  Run `npm install` once after downloading this folder, before starting
  the server for the first time.

## How to run it (Windows)

1. **Install Node.js** if you don't already have it — run the installer
   like any normal app, click through, done.
2. **Open a terminal in this folder and run `npm install`** (one-time
   setup — downloads the `xlsx` package into a local `node_modules`
   folder; nothing is sent anywhere).
3. **Double-click `START-PINGBOX.bat`.**
   - A black console window will open and start the server.
   - Keep that window open while you use Pingbox — closing it stops the
     server (the app still works without it, just with fewer checks —
     see below).
4. **Open `index.html`** in your browser (double-click it, or right-click
   → Open with → your browser of choice).
5. Look at the top-right of the page — it should say **"MX + SMTP live"**
   with a green dot. That means the server is connected and you're
   getting full validation (DNS + MX + SMTP).

That's it — paste an email, paste a list, drop a CSV/Excel file, scan
a business card image, or paste a Google Sheets/Dropbox link and go.
Each run validates up to **500 emails**.

## Suggestions for invalid emails

When an email comes back invalid, the server now tries to find a better
one automatically, in three ways:

1. **Typo correction** — catches misspelled domains (`gmial.com` →
   `gmail.com`) and misspelled local parts (`jhon` → `john`, `suport` →
   `support`), then re-validates the fix before suggesting it.
2. **Constructed from name + company** — if you give it a first/last
   name and a company name or website, it scrapes the company's public
   pages (homepage, `/contact`, `/about`, `/team`) to figure out their
   email convention (`firstname.lastname@`, `flastname@`, etc.), builds
   the likely address, and validates it.
3. **Scraped public emails** — real addresses found directly on the
   company's site, offered as a last-resort backup.

Each suggestion comes with a **confidence** (high/medium/low, based on
whether it was actually verified) and a **source** label. This needs a
name and a company name *or* website per row to do anything beyond typo
correction — without those it gracefully skips straight to "no
suggestion available."

This is fully wired into the UI:

- **Single Email** — an invalid result shows up to 3 suggested
  alternatives below the check, each with a one-click **"Use this"**
  button that drops it straight into the input.
- **Bulk Paste / Upload CSV** — the results table gets a **Suggestions**
  column with clickable chips (click to copy); a colored dot shows
  confidence at a glance.
- **Upload CSV / Excel** — when your file has more than one column,
  you'll see a **column mapper** instead of a simple picker: it
  auto-detects Email, First Name, Last Name, Full Name, Company, and
  Website columns by header name (or by scanning cell values if headers
  are missing/unlabeled), and you confirm or adjust before validating.
  Map First/Last Name *and* Company or Website to unlock constructed +
  scraped suggestions for that whole file; a plain list of emails (or a
  file with only an email column) still gets typo correction.

## Scan Card — extract contacts from business card photos

The **Scan Card** tab reads name/email/company/website straight off a
photo (or several at once):

1. Drop in one or more images — phone photos of business cards, a
   screenshot of an email signature, whatever has the info on it.
2. Each image is OCR'd and parsed into an editable card (First Name,
   Last Name, Email, Company, Website). OCR + the line-guessing that
   follows it is best-effort, not perfect — **review and correct
   anything wrong before validating**, that's exactly why every field
   is editable rather than locked in automatically.
3. Click **Validate All** to run every card through the same
   validation + suggestions pipeline as everywhere else in the app.

This needs the local server (OCR has to run somewhere, and there's no
browser API for it) — it's clearly labeled if the server isn't running.
Nothing about the image itself is sent anywhere outside your own
machine; the OCR model runs locally too.

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
