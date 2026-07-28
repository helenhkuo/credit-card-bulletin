# 💳 Credit Card Benefits Bulletin

A free, interactive bulletin-board website to track your credit card benefits
(hotel nights, dining credits, travel credits, cashback…). See what's **unused**,
**expiring soon**, and **expired**; **click to mark a benefit used** (with a
usage-history log); and get **automatic reminder emails** 15, 10, and 5 days
before anything expires.

Everything here is **100% free** and needs **no server to maintain**. An optional
Google Sheets backend adds cross-device sync.

| Piece | Technology | Cost |
| --- | --- | --- |
| Website (bulletin board) | Static HTML/CSS/JS | Free |
| Hosting | GitHub Pages | Free |
| Reminder emails | Python + GitHub Actions (daily cron) | Free |
| Benefit data | One `benefits.json` file | Free |
| Mark-used + history sync *(optional)* | Google Sheets + Apps Script | Free |

## Feature overview

- **Bulletin board** of color-coded cards, grouped by benefit category.
- **Search + filter** by category, card, and status; **sort** by deadline, card,
  category, or person.
- **Smart deadlines**: monthly / quarterly / semi-annual / annual / one-time
  benefits each compute their own next deadline, with a live countdown.
- **Click to mark used / unused** — no file editing required.
- **Auto-refresh**: recurring offers you mark used reappear automatically when
  the next period starts.
- **Usage history**: every click is logged; export it as CSV.
- **Reminder emails** 15/10/5 days before each deadline.
- **Optional Google Sheets sync** so used-state follows you across devices and
  the emails skip what you've used. A **Sync: on/off** badge shows the status.
- **Optional passcode** gate for light privacy.

---

## What it looks like

- A board of colored cards, one per benefit.
- Each card shows a **person initial** (C/H), the **credit card name**, the
  **category**, the **benefit** and amount, the **next deadline** with a live
  **countdown**, a **status badge** (Active / Expiring soon / Expired / Used /
  Date TBD), and a **✓ Mark used / ↩ Mark unused** button.
- Colors are keyed to categories (Travel, Dining, Hotel, Shopping, …).
- Top controls let you **search** and **filter by category / card / status** and
  **sort by deadline, card, category, or person**. A **Sync** badge in the
  header shows whether cloud sync is on. The footer has an **Export usage log
  (CSV)** link.

---

## Folder structure

```
Credit_Card_Bulletin/
├── index.html                     # the webpage
├── css/style.css                  # styling
├── js/app.js                      # loads data, renders the board, mark-used logic
├── js/config.js                   # ← optional: your Google Sheets URL/token/passcode
├── data/benefits.json             # ← YOUR DATA. Edit this file.
├── scripts/send_reminders.py      # sends the reminder emails
├── google-apps-script/Code.gs     # ← optional: Google Sheets backend (Part 5)
├── .github/workflows/reminders.yml# runs the script daily (free)
├── requirements.txt
├── .env.example                   # template for local email testing
└── README.md
```

---

## Part 1 — Edit your benefits

Open `data/benefits.json` and edit the `benefits` list. Each benefit looks like:

```json
{
  "id": "amex-plat-c-fhr",
  "person": "C",
  "card": "Amex Platinum",
  "benefit": "Fine Hotels + Resorts Credit",
  "category": "Hotel",
  "amount": "$300 / half",
  "frequency": "semiannual",
  "expiration": null,
  "used": false,
  "notes": "Prepaid FHR / Hotel Collection via Amex Travel."
}
```

Field notes:

- **id** — any unique text (used internally). No spaces is safest.
- **person** — `"C"` or `"H"` (two different people). Leave `""` for
  shared/unassigned. Names are set in the `people` block at the top of the file.
  Shown as a colored initial on each card and available as a **sort** option.
- **card** — the credit card name. Powers the "Card" filter.
- **benefit** — short description shown in bold.
- **category** — used for color. Built-in colors: `Travel`, `Dining`, `Hotel`,
  `Hotel Night`, `Shopping`, `Wellness`, `Entertainment`, `Transport`,
  `Grocery`, `Cashback`. Anything else gets a neutral color.
- **amount** — optional (e.g. `"$300 / half"`, `"1 night"`, `"5%"`).
- **frequency** — one of `monthly`, `quarterly`, `semiannual`, `annual`, or
  `one-time`.
- **expiration** — controls the deadline, and works together with `frequency`:
  - **one-time**: a date in **`YYYY-MM-DD`** format (e.g. `2026-12-31`), or
    `null` if unknown (shows as "Date TBD").
  - **recurring + `null`**: the app auto-computes the next *calendar* reset
    (end of month / quarter / Jun 30 / Dec 31 / year end). Good for Amex/Citi
    calendar-year credits.
  - **recurring + a real date**: the app treats that date as an *anchor* and
    rolls it forward one period at a time automatically. Use this for benefits
    that renew on a specific **anniversary date** — e.g. a free night that
    renews every Aug 22: set `frequency: "annual"` and `expiration:
    "2026-08-22"`, and it will keep advancing to 2027-08-22, etc., on its own.
- **used** — `true` once you've used it (dims the card, stops reminders). Set it
  back to `false` anytime to reinstate the benefit (full color, reminders resume).
- **notes** — optional tip shown on the card and in the email.

Also set `"owner_email"` near the top to the address that should receive
reminders (or override it later with a GitHub secret), and edit the `people`
block to use real names if you like (e.g. `"C": "Alice", "H": "Bob"`).

> **How reminders work with recurring credits:** because monthly/quarterly/etc.
> credits reset on calendar boundaries, you'll automatically get a 15/10/5-day
> reminder before each reset (e.g. before the end of every month for a monthly
> Uber credit). One-time items remind before their fixed date.

---

## Part 2 — See the website on your computer (optional preview)

Because the page loads a JSON file, opening `index.html` by double-clicking may
be blocked by the browser. Run a tiny local server instead:

```bash
cd /Users/kuoh2/Credit_Card_Bulletin
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser. Press `Ctrl+C` to stop.

---

## Part 3 — Put the website online for free (GitHub Pages)

You'll create a free GitHub account and upload this folder. No command line
required beyond the optional preview above.

### 3.1 Create a GitHub account and repository
1. Sign up at <https://github.com> (free).
2. Click **New repository**. Name it e.g. `credit-card-bulletin`.
3. Choose **Public** (required for free Pages + free Actions minutes).
4. Click **Create repository**.

### 3.2 Upload the files
Easiest (no terminal): on the new repo page click **uploading an existing
file**, then drag in everything from this folder and **Commit changes**.

Or, with git installed:
```bash
cd /Users/kuoh2/Credit_Card_Bulletin
git init
git add .
git commit -m "Initial credit card bulletin"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/credit-card-bulletin.git
git push -u origin main
```

### 3.3 Turn on GitHub Pages
1. In your repo go to **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Click **Save**.
4. Wait ~1 minute. Your site appears at:
   `https://YOUR_USERNAME.github.io/credit-card-bulletin/`

That URL is your live bulletin board. To update it later, just edit
`data/benefits.json` on GitHub (pencil icon → Commit) and it refreshes.

---

## Part 4 — Turn on automatic reminder emails

The email job is already written (`scripts/send_reminders.py`) and scheduled
(`.github/workflows/reminders.yml`, runs daily). You only need to give it a way
to send email. The simplest free option is a **Gmail App Password**.

### 4.1 Get a Gmail App Password
1. Your Google account must have **2-Step Verification** ON
   (<https://myaccount.google.com/security>).
2. Go to <https://myaccount.google.com/apppasswords>.
3. Create an app password (name it "Bulletin"). Google shows a **16-character
   code** — copy it. (It's NOT your normal Gmail password.)

### 4.2 Add secrets to your repo
In your repo: **Settings → Secrets and variables → Actions → New repository
secret**. Add these:

| Secret name | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your full Gmail address |
| `SMTP_PASSWORD` | the 16-character app password |
| `EMAIL_FROM` | your full Gmail address |
| `EMAIL_TO` | where reminders go. For **two (or more) people**, separate addresses with commas, e.g. `alice@gmail.com, bob@outlook.com` |

Optional: under the **Variables** tab add `REMINDER_DAYS` = `15,10,5` to change
which days trigger reminders.

### 4.3 Test it
1. Repo → **Actions** tab → enable workflows if prompted.
2. Click **Benefit Expiration Reminders → Run workflow** to run it now.
3. Check the run log. If a benefit is exactly 15/10/5 days out, you'll get an
   email. Otherwise it prints "Nothing to send" — that's normal.

After this, it runs automatically every day. When any unused benefit hits 15,
10, or 5 days before expiration, you get an email.

> **Tip:** To test end-to-end regardless of dates, temporarily set the
> `REMINDER_DAYS` variable to a number of days that matches one of your
> benefits, run the workflow, then set it back to `15,10,5`.

---

## Part 5 — Sync "used" clicks across devices with Google Sheets (optional)

By default, clicking **Mark used** saves only in the browser you clicked on, and
the reminder emails can't see those clicks. Connect a free Google Sheet and:
- your used-state + history sync across **all devices**, and
- the daily **emails skip offers you've marked used**.

### 5.1 Create the Sheet + script
1. Go to <https://sheets.google.com> and create a **blank spreadsheet** (name it
   anything, e.g. "Credit Card Bulletin").
2. In it, click **Extensions → Apps Script**. Delete any starter code.
3. Open `google-apps-script/Code.gs` from this project, copy the **entire** file,
   and paste it into the Apps Script editor.
4. Near the top, change `var TOKEN = "CHANGE_ME_TO_A_SECRET";` to your own secret
   phrase (any text you choose). Click the **Save** (disk) icon.

### 5.2 Deploy it as a Web App
1. Click **Deploy → New deployment**.
2. Click the gear ⚙ next to "Select type" → **Web app**.
3. Set **Execute as: Me**, and **Who has access: Anyone**. Click **Deploy**.
4. Approve the permissions prompt (it's your own script accessing your own sheet).
5. Copy the **Web app URL** (it ends in `/exec`).

### 5.3 Connect the website
Open `js/config.js` and fill in:
```js
window.CCB_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/....../exec",  // your Web app URL
  apiToken: "the-secret-you-set-in-Code.gs",
  passcode: "",   // optional: a prompt before the board loads
};
```
Commit/push and reload the site. The **Sync** badge in the header should turn
green (**Sync: on**). Clicks now read/write to your Sheet, and you'll see two
tabs appear in the spreadsheet: **state** (current used flags) and **history**
(every click, with timestamp). If the badge shows **Sync: error**, double-check
the URL ends in `/exec` and that `apiToken` matches `TOKEN` in `Code.gs`.

### 5.4 Let the reminder emails use it
In your GitHub repo, add two more **Actions secrets** (Settings → Secrets and
variables → Actions):

| Secret name | Value |
| --- | --- |
| `USAGE_API_URL` | the same Web app URL (ends in `/exec`) |
| `USAGE_API_TOKEN` | the same secret as in `Code.gs` |

That's it — the daily email now skips anything currently marked used.

> **Privacy note:** because a GitHub Pages site is public, treat `apiToken` as a
> light deterrent, not strong security — keep your site URL private, and
> optionally set a `passcode`. For true privacy you'd need a login-based backend
> (a bigger project we can do later).

---

## Testing reminders locally (optional, for the technically curious)

```bash
cd /Users/kuoh2/Credit_Card_Bulletin
cp .env.example .env          # then edit .env with your real values
set -a; source .env; set +a   # load the variables
DRY_RUN=1 python3 scripts/send_reminders.py   # prints instead of sending
```
Remove `DRY_RUN=1` to actually send. `.env` is git-ignored so it stays private.

---

## Hosting options compared (all free)

| Option | Best for | Website | Scheduled emails | Notes |
| --- | --- | --- | --- | --- |
| **GitHub Pages + GitHub Actions** ⭐ recommended | This project | ✅ | ✅ (cron, free 2,000 min/mo) | Everything in one place; used by this repo. |
| **Netlify** / **Vercel** | Fancier custom domains | ✅ | ⚠️ scheduled functions limited on free tier | Great hosting, but email cron is easier on Actions. |
| **Cloudflare Pages** | Speed + free custom domain | ✅ | ⚠️ Cron via Workers (separate setup) | Excellent, slightly more setup for email. |
| **Render / Railway** | If you later add a real backend/database | ✅ | ✅ cron jobs | Overkill for a static board; free tiers sleep. |

**Free domain names:** GitHub gives you `you.github.io/...` for free. If you want
a custom name, cheap options are **`.dev`/`.app`** (~$10–15/yr on Cloudflare
Registrar at cost), or genuinely free subdomains from **js.org** (for dev
projects) or **is-a.dev**. You can point any custom domain at GitHub Pages via
**Settings → Pages → Custom domain**.

---

## Frequently asked

**Do I need to keep my computer on?** No. GitHub runs the website and the daily
email job in the cloud.

**How do I mark a benefit as used?** Two ways:
- **On the website (no file editing):** click **✓ Mark used** on the card. It
  dims and its status becomes "Used". Click **↩ Mark unused** to reinstate it.
  These clicks are saved in **your browser** (localStorage) and are logged — use
  **Export usage log (CSV)** in the footer to download the history.
- **In the data file (the default / server-visible value):** set `"used": true`
  in `benefits.json`. This is what the daily reminder emails read.

**Recurring offers auto-refresh:** the website tracks "used" *per period*, so a
monthly credit you mark used in July automatically shows as available again in
August (and quarterly/annual similarly). One-time items stay used once marked.

**Browser-only vs. synced:**
- Without the Google Sheet backend (default), the "used" state is saved **only in
  the browser/device you clicked on**, and the daily reminder **emails can't see
  those clicks** (they use the `"used"` value in `benefits.json`).
- **Set up Part 5 (Google Sheets)** to make clicks sync across all devices *and*
  make the emails automatically skip offers you've marked used.

**How do I reinstate a used benefit (turn it back to unused)?** Click **↩ Mark
unused** on the card, or set `"used": false` in `benefits.json`. To find used
items quickly, set the **Status** filter to **Used**.

**Is my data private?** A public repo means `benefits.json` is publicly
readable. Keep only non-sensitive info there (card *names* and perks are fine;
never put full card numbers). Your email secrets are encrypted and never public.
If you want the data private, use a **private repo** — Pages still works, and
Actions still gets free minutes.

**Can I change the reminder schedule?** Edit the `cron` line in
`.github/workflows/reminders.yml` (uses UTC time).
