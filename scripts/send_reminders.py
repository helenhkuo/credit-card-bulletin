#!/usr/bin/env python3
"""Send reminder emails for credit card benefits nearing their deadline.

Reads data/benefits.json and emails the owner when an *unused* benefit is
exactly 15, 10, or 5 days from its next deadline (configurable via
REMINDER_DAYS).

Deadlines are computed per benefit:
  * monthly     -> last day of the current calendar month
  * quarterly   -> last day of the current calendar quarter
  * semiannual  -> Jun 30 or Dec 31 (end of the current half-year)
  * annual      -> Dec 31 of the current year
  * one-time    -> the explicit "expiration" date (YYYY-MM-DD); skipped if null

Designed to run once per day (e.g. via GitHub Actions cron). Credentials are
read from environment variables so nothing secret lives in the repo:

    SMTP_HOST      e.g. smtp.gmail.com
    SMTP_PORT      e.g. 587
    SMTP_USER      the sending email account (login)
    SMTP_PASSWORD  app password / SMTP key (NOT your normal password)
    EMAIL_FROM     optional; defaults to SMTP_USER
    EMAIL_TO       optional; defaults to owner_email in benefits.json
    REMINDER_DAYS  optional; comma list, defaults to "15,10,5"
    DRY_RUN        optional; "1" prints emails instead of sending
    USAGE_API_URL  optional; Google Apps Script Web App URL. If set, the script
                   reads which benefits are marked used (per period) and skips
                   them, so you aren't reminded about offers you've already used.
    USAGE_API_TOKEN optional; shared secret matching the Apps Script TOKEN.
"""

from __future__ import annotations

import calendar
import json
import os
import smtplib
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "benefits.json"


def load_benefits() -> dict:
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


STEP_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}


def end_of_month(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def parse_date(value) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def add_months(d: date, n: int) -> date:
    month_index = d.month - 1 + n
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def effective_deadline(benefit: dict, today: date) -> date | None:
    """Return the next deadline date for a benefit, or None if unknown.

    one-time                -> explicit date (or None)
    recurring + anchor date -> roll the date forward one period at a time
    recurring, no anchor    -> end of the current calendar period
    """
    freq = benefit.get("frequency", "one-time")
    anchor = parse_date(benefit.get("expiration"))

    if freq == "one-time":
        return anchor

    step = STEP_MONTHS.get(freq)
    if step is None:
        return anchor  # unrecognized frequency

    if anchor is not None:
        d = anchor
        guard = 0
        while d < today and guard < 600:
            d = add_months(d, step)
            guard += 1
        return d

    y, m = today.year, today.month
    if freq == "monthly":
        return end_of_month(y, m)
    if freq == "quarterly":
        return end_of_month(y, ((m - 1) // 3) * 3 + 3)  # 3, 6, 9, 12
    if freq == "semiannual":
        return end_of_month(y, 6) if m <= 6 else end_of_month(y, 12)
    return end_of_month(y, 12)  # annual


def person_tag(benefit: dict, people: dict) -> str:
    code = benefit.get("person") or ""
    if not code:
        return ""
    name = people.get(code, code)
    return f"[{name}] "


def usage_key(benefit: dict, today: date) -> str:
    """Must match the website's usageKey() so used-state lines up per period."""
    d = effective_deadline(benefit, today)
    if d is not None:
        period = d.isoformat()
    elif benefit.get("frequency") == "one-time":
        period = "once"
    else:
        period = "nodate"
    return f"{benefit.get('id')}::{period}"


def fetch_usage_state() -> dict:
    """Fetch {key: used_bool} from the Google Sheet backend, or {} if not set."""
    url = os.environ.get("USAGE_API_URL", "").strip()
    token = os.environ.get("USAGE_API_TOKEN", "").strip()
    if not url:
        return {}
    full = f"{url}?action=state&token={urllib.parse.quote(token)}"
    try:
        with urllib.request.urlopen(full, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("ok") and isinstance(data.get("state"), dict):
            return data["state"]
        print(f"WARN: usage API returned: {data}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 - network/parse errors shouldn't break emails
        print(f"WARN: could not fetch usage state ({e}); using benefits.json 'used' only", file=sys.stderr)
    return {}


def is_used(benefit: dict, used_state: dict, today: date) -> bool:
    remote = used_state.get(usage_key(benefit, today))
    if remote is None:
        return bool(benefit.get("used"))
    return bool(remote)


def find_due(data: dict, reminder_days: set[int], today: date, used_state: dict) -> list[tuple[dict, int]]:
    due = []
    for b in data.get("benefits", []):
        if is_used(b, used_state, today):
            continue
        deadline = effective_deadline(b, today)
        if deadline is None:
            continue
        d = (deadline - today).days
        if d in reminder_days:
            due.append((b, d))
    due.sort(key=lambda x: x[1])
    return due


def build_email_body(due: list[tuple[dict, int]], people: dict) -> tuple[str, str]:
    lines_text = ["Heads up! These credit card benefits are approaching their deadline:\n"]
    rows_html = []
    for b, d in due:
        tag = person_tag(b, people)
        amount = f" ({b['amount']})" if b.get("amount") and b["amount"] != "-" else ""
        notes = f"\n     Note: {b['notes']}" if b.get("notes") else ""
        lines_text.append(
            f"  - [{d} days left] {tag}{b['card']} - {b['benefit']}{amount}{notes}"
        )
        notes_html = f"<div style='color:#666;font-size:13px'>{b['notes']}</div>" if b.get("notes") else ""
        rows_html.append(
            "<tr>"
            f"<td style='padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;color:#d9480f'>{d} days</td>"
            f"<td style='padding:10px 12px;border-bottom:1px solid #eee'><b>{tag}{b['card']}</b><br>{b['benefit']}{amount}{notes_html}</td>"
            f"<td style='padding:10px 12px;border-bottom:1px solid #eee;white-space:nowrap'>{b.get('frequency', '')}</td>"
            "</tr>"
        )

    text = "\n".join(lines_text) + "\n\nUse them before they reset or expire!"
    html = f"""\
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#222">
  <h2 style="margin:0 0 4px">Credit Card Benefit Reminder</h2>
  <p style="color:#555;margin:0 0 16px">The following benefits are approaching their deadline. Use them before they reset or expire!</p>
  <table style="border-collapse:collapse;width:100%;max-width:660px;border:1px solid #eee;border-radius:8px;overflow:hidden">
    <thead><tr style="background:#f5f6fa;text-align:left">
      <th style="padding:10px 12px">Left</th><th style="padding:10px 12px">Benefit</th><th style="padding:10px 12px">Type</th>
    </tr></thead>
    <tbody>{''.join(rows_html)}</tbody>
  </table>
</body></html>"""
    return text, html


def send_email(subject: str, text: str, html: str, to_addr: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]
    from_addr = os.environ.get("EMAIL_FROM", user)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(from_addr, [to_addr], msg.as_string())


def main() -> int:
    data = load_benefits()

    reminder_days = {
        int(x) for x in os.environ.get("REMINDER_DAYS", "15,10,5").split(",") if x.strip()
    }
    today = date.today()
    used_state = fetch_usage_state()
    due = find_due(data, reminder_days, today, used_state)

    if not due:
        print(f"[{today}] No benefits due at {sorted(reminder_days)} days. Nothing to send.")
        return 0

    to_addr = os.environ.get("EMAIL_TO") or data.get("owner_email")
    if not to_addr or "example.com" in to_addr:
        print("ERROR: No valid recipient. Set EMAIL_TO or owner_email in benefits.json.", file=sys.stderr)
        return 1

    subject = f"{len(due)} credit card benefit(s) approaching deadline"
    text, html = build_email_body(due, data.get("people", {}))

    if os.environ.get("DRY_RUN") == "1":
        print(f"[DRY_RUN] Would email {to_addr}:\nSubject: {subject}\n\n{text}")
        return 0

    send_email(subject, text, html, to_addr)
    print(f"[{today}] Sent reminder for {len(due)} benefit(s) to {to_addr}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
