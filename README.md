# Card Desk (v2)

A rebuild of the credit card bulletin — **Google Sheets is the database**, the
website is just the desk you sit at.

Add, edit, delete, and mark benefits used **on the site**. No more editing JSON
on GitHub for day-to-day changes. Spend goals (open bonus / retention) live
alongside benefits.

| Piece | Where it lives |
| --- | --- |
| Benefit list + used flags | Google Sheet → **Benefits** tab |
| Spend goals | Google Sheet → **Spends** tab |
| Website UI | GitHub Pages (static) |
| Reminder emails *(optional)* | GitHub Actions + Gmail |

v1 can stay as-is under `Credit_Card_Bulletin`. This folder is independent.

---

## What’s different from v1 (by design)

1. **No `benefits.json` for daily use** — the Sheet is the source of truth.
2. **No separate state / history tabs** — “used” is a `used_period` column on
   the benefit row. When a monthly credit rolls into a new month, last month’s
   mark no longer matches → it shows available again automatically.
3. **Add / edit / delete on the website** — `+ Add benefit` / `+ Add spend`.
4. **Spend goals** — type is **New card spend**, **Retention**, or **Other**.
5. **Overview tab** — benefits and spend goals on one board, sorted by deadline.
6. **Offline demo mode** — leave `apiUrl` empty and the UI loads sample data so
   you can try it before wiring Sheets.
7. **Fresh UI** (“Card Desk”) — Overview / Benefits / Spend goals tabs.

---

## Quick start (preview, no Sheets yet)

```bash
cd "/Users/kuoh2/coding projects/credit_card_bulletin_v2"
python3 -m http.server 8000
```

Open http://localhost:8000 — you’ll see demo cards. Add/edit works in-browser
only until Sheets is connected (refresh resets demo data).

---

## Connect Google Sheets (the real setup)

### 1. Create the Sheet + script
1. Create a blank spreadsheet at https://sheets.google.com  
   (name it e.g. `Card Desk`).
2. **Extensions → Apps Script**. Delete the starter code.
3. Paste everything from `google-apps-script/Code.gs`.
4. Change `TOKEN` near the top to a secret phrase you invent.
5. Save. Optional: select function **`seedDemoData`** → Run (loads a few sample
   rows so the board isn’t empty).

### 2. Deploy as a Web App
1. **Deploy → New deployment → Web app**
2. Execute as: **Me** · Who has access: **Anyone**
3. Deploy, approve permissions, copy the URL that ends in `/exec`.

### 3. Point the website at it
Edit `js/config.js`:

```js
window.CCB_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/..../exec",
  apiToken: "the-same-secret-as-TOKEN",
  passcode: "",   // optional site gate
};
```

Host on GitHub Pages (or keep using the local server). The badge should say
**Synced to Sheet**.

### Sheet columns (auto-created)

**Benefits:**  
`id | person | card | benefit | category | amount | frequency | expiration | used_period | notes`

**Spends:**  
`id | person | card | label | goal | spent | deadline | notes`

**Config:**  
`key | value` — put your site passcode in the row where `key` is `passcode`.  
Leave the value blank for no gate. Edit anytime; no GitHub upload needed.

You can still bulk-edit in Sheets anytime. The website is just the easier daily path.

---

## Migrating from v1

1. Open your old `data/benefits.json`.
2. For each benefit, click **+ Add benefit** on Card Desk (or paste rows into
   the Benefits tab — keep the header names above).
3. For anything already used this period, set `used_period` to that period’s
   deadline date (`YYYY-MM-DD`), or just click **Mark used** on the site.
4. Leave v1 up until you’re happy with v2.

---

## Optional: reminder emails

Same idea as v1, but the script now reads from the Sheet API (benefits *and*
spend goals).

1. Turn on Gmail 2-Step Verification + create an App Password *(or skip until ready)*.
2. Repo secrets:

| Secret | Value |
| --- | --- |
| `USAGE_API_URL` | Web app `/exec` URL |
| `USAGE_API_TOKEN` | same as `TOKEN` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail |
| `SMTP_PASSWORD` | app password |
| `EMAIL_FROM` | your Gmail |
| `EMAIL_TO` | `you@…, partner@…` (comma-separated OK) |

3. Actions → enable workflows → run **Card Desk Reminders** once to test.

Local dry run:

```bash
cp .env.example .env   # fill in
set -a; source .env; set +a
python3 scripts/send_reminders.py
```

---

## Day-to-day use

| Want to… | Do this |
| --- | --- |
| Add a new perk | **+ Add benefit** |
| Remove a perk forever | **Del** on the card (or delete the Sheet row) |
| Mark a credit used | **✓ Mark used** (writes `used_period`) |
| Undo | **↩ Unused** |
| Track open/retention spend | **Spend goals** tab → **+ Add spend** |
| Update progress | **Update spent** on the card |
| Bulk edit | Open the Google Sheet |

GitHub is only for **code/design** changes — not for every new Amex credit.

---

## Design notes / future ideas (open box)

Already in v2:
- Used marks on the benefit row (`used_period`)
- In-site CRUD
- Spend tracker
- Used / met items sink to the bottom
- Multi-recipient emails

Good next upgrades if you want them later:
- **Import from v1 JSON** button (one-click migration)
- **Inline spent +/-** chips ($100 / $500) instead of a prompt
- **Card library** (prefill common Amex/Chase benefits)
- **Calendar view** of upcoming deadlines
- Stronger auth (the token + optional passcode are light privacy only)

---

## Folder map

```
credit_card_bulletin_v2/
├── index.html
├── css/style.css
├── js/config.js          ← your Sheet URL + token
├── js/app.js
├── js/demo-data.js       ← offline preview only
├── google-apps-script/Code.gs
├── scripts/send_reminders.py
├── .github/workflows/reminders.yml
└── README.md
```
