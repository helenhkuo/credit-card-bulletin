#!/usr/bin/env python3
"""Email reminders for Card Desk v2.

Fetches benefits from the Google Apps Script API (same Sheet the website uses)
and emails when an unused benefit is 15 / 10 / 5 days from its next deadline.

Env:
  USAGE_API_URL / API_URL   Web app URL ending in /exec
  USAGE_API_TOKEN / API_TOKEN
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
  EMAIL_FROM                optional
  EMAIL_TO                  comma-separated recipients
  REMINDER_DAYS             default 15,10,5
  DRY_RUN=1                 print only
"""

from __future__ import annotations

import calendar
import json
import os
import re
import smtplib
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

STEP_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}


def end_of_month(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def parse_date(value) -> date | None:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def add_months(d: date, n: int) -> date:
    month_index = d.month - 1 + n
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def effective_deadline(b: dict, today: date) -> date | None:
    freq = b.get("frequency") or "one-time"
    anchor = parse_date(b.get("expiration"))
    if freq == "one-time":
        return anchor
    step = STEP_MONTHS.get(freq)
    if not step:
        return anchor
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
        return end_of_month(y, ((m - 1) // 3) * 3 + 3)
    if freq == "semiannual":
        return end_of_month(y, 6) if m <= 6 else end_of_month(y, 12)
    return end_of_month(y, 12)


def is_used(b: dict, today: date) -> bool:
    deadline = effective_deadline(b, today)
    used_period = (b.get("used_period") or "").strip()
    if not deadline:
        return bool(used_period)
    return used_period == deadline.isoformat()


def fetch_list() -> dict:
    url = (os.environ.get("USAGE_API_URL") or os.environ.get("API_URL") or "").strip()
    token = (os.environ.get("USAGE_API_TOKEN") or os.environ.get("API_TOKEN") or "").strip()
    if not url:
        print("ERROR: Set USAGE_API_URL (or API_URL) to your Apps Script /exec URL.", file=sys.stderr)
        sys.exit(1)
    full = f"{url}?action=list&token={urllib.parse.quote(token)}"
    with urllib.request.urlopen(full, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "bad API response")
    return data


def parse_recipients(raw) -> list[str]:
    parts = re.split(r"[,;]", str(raw or ""))
    return [p.strip() for p in parts if p.strip() and "example.com" not in p]


def find_due(benefits: list, reminder_days: set[int], today: date):
    due = []
    for b in benefits:
        if is_used(b, today):
            continue
        deadline = effective_deadline(b, today)
        if deadline is None:
            continue
        d = (deadline - today).days
        if d in reminder_days:
            due.append((b, d))
    due.sort(key=lambda x: x[1])
    return due


def build_email(due, spends_due):
    lines = ["Heads up from Card Desk:\n"]
    rows = []
    if due:
        lines.append("Benefits approaching deadline:")
        for b, d in due:
            tag = f"[{b.get('person')}] " if b.get("person") else ""
            amount = f" ({b['amount']})" if b.get("amount") else ""
            lines.append(f"  - [{d}d] {tag}{b.get('card')} — {b.get('benefit')}{amount}")
            rows.append(
                f"<tr><td style='padding:8px;color:#b91c1c;font-weight:700'>{d}d</td>"
                f"<td style='padding:8px'><b>{tag}{b.get('card')}</b><br>{b.get('benefit')}{amount}</td></tr>"
            )
    if spends_due:
        lines.append("\nSpend goals approaching deadline:")
        for s, d in spends_due:
            left = max(0, (float(s.get("goal") or 0) - float(s.get("spent") or 0)))
            tag = f"[{s.get('person')}] " if s.get("person") else ""
            lines.append(f"  - [{d}d] {tag}{s.get('card')} — {s.get('label')} (${left:,.0f} left)")
            rows.append(
                f"<tr><td style='padding:8px;color:#b91c1c;font-weight:700'>{d}d</td>"
                f"<td style='padding:8px'><b>{tag}{s.get('card')}</b><br>{s.get('label')} "
                f"(${left:,.0f} left)</td></tr>"
            )
    text = "\n".join(lines) + "\n"
    html = f"""<html><body style="font-family:Arial,sans-serif;color:#12201c">
      <h2>Card Desk reminder</h2>
      <table style="border-collapse:collapse;width:100%;max-width:640px">{''.join(rows)}</table>
    </body></html>"""
    return text, html


def spend_due(spends: list, reminder_days: set[int], today: date):
    out = []
    for s in spends:
        goal = float(s.get("goal") or 0)
        spent = float(s.get("spent") or 0)
        if goal > 0 and spent >= goal:
            continue
        deadline = parse_date(s.get("deadline"))
        if not deadline:
            continue
        d = (deadline - today).days
        if d in reminder_days:
            out.append((s, d))
    out.sort(key=lambda x: x[1])
    return out


def send_email(subject: str, text: str, html: str, to_addrs: list[str]) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]
    from_addr = os.environ.get("EMAIL_FROM", user)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(from_addr, to_addrs, msg.as_string())


def main() -> int:
    today = date.today()
    reminder_days = {
        int(x) for x in os.environ.get("REMINDER_DAYS", "15,10,5").split(",") if x.strip()
    }
    data = fetch_list()
    due = find_due(data.get("benefits") or [], reminder_days, today)
    spends = spend_due(data.get("spends") or [], reminder_days, today)
    if not due and not spends:
        print(f"[{today}] Nothing due at {sorted(reminder_days)} days.")
        return 0

    recipients = parse_recipients(os.environ.get("EMAIL_TO", ""))
    if not recipients:
        print("ERROR: Set EMAIL_TO to one or more addresses (comma-separated).", file=sys.stderr)
        return 1

    subject = f"Card Desk: {len(due) + len(spends)} item(s) approaching deadline"
    text, html = build_email(due, spends)
    if os.environ.get("DRY_RUN") == "1":
        print(f"[DRY_RUN] Would email {', '.join(recipients)}:\n{subject}\n\n{text}")
        return 0
    send_email(subject, text, html, recipients)
    print(f"[{today}] Sent to {', '.join(recipients)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
