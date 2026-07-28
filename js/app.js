"use strict";

const SOON_DAYS = 15; // "expiring soon" threshold, matches earliest email reminder

const state = {
  benefits: [],
  people: {},
  filters: { search: "", category: "", card: "", status: "", sort: "expiration" },
};

const els = {
  board: document.getElementById("board"),
  stats: document.getElementById("stats"),
  emptyNote: document.getElementById("empty-note"),
  loadedAt: document.getElementById("loaded-at"),
  search: document.getElementById("search"),
  filterCategory: document.getElementById("filter-category"),
  filterCard: document.getElementById("filter-card"),
  filterStatus: document.getElementById("filter-status"),
  sortBy: document.getElementById("sort-by"),
  syncStatus: document.getElementById("sync-status"),
};

// state: "off" | "syncing" | "on" | "error"
function setSyncStatus(kind, tooltip) {
  if (!els.syncStatus) return;
  const labels = {
    off: "Sync: off (this device only)",
    syncing: "Sync: connecting…",
    on: "Sync: on",
    error: "Sync: error (using local copy)",
  };
  els.syncStatus.className = `sync-badge sync-${kind}`;
  els.syncStatus.textContent = labels[kind] || "Sync: off";
  els.syncStatus.title = tooltip || "";
}

const CATEGORY_META = {
  Travel: { class: "cat-travel", color: "var(--cat-travel)" },
  Dining: { class: "cat-dining", color: "var(--cat-dining)" },
  Hotel: { class: "cat-hotel", color: "var(--cat-hotel)" },
  "Hotel Night": { class: "cat-hotel-night", color: "var(--cat-hotel-night)" },
  Shopping: { class: "cat-shopping", color: "var(--cat-shopping)" },
  Wellness: { class: "cat-wellness", color: "var(--cat-wellness)" },
  Entertainment: { class: "cat-entertainment", color: "var(--cat-entertainment)" },
  Transport: { class: "cat-transport", color: "var(--cat-transport)" },
  Grocery: { class: "cat-grocery", color: "var(--cat-grocery)" },
  Cashback: { class: "cat-cashback", color: "var(--cat-cashback)" },
};

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function endOfMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0); // day 0 of next month = last day of this month
}

function isDateString(str) {
  return typeof str === "string" && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function addMonths(date, n) {
  const d = new Date(date.getTime());
  const targetDay = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < targetDay) d.setDate(0); // clamp to end of shorter month
  return d;
}

const STEP_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

// Returns the effective next deadline (a Date) for a benefit, or null if unknown.
// - one-time: the explicit date (or null)
// - recurring with an anchor date: roll that date forward one period at a time
//   until it is today or later (handles anniversary renewals on any date)
// - recurring without an anchor: end of the current calendar period
function effectiveDeadline(benefit) {
  const t = todayMidnight();
  const freq = benefit.frequency;

  if (freq === "one-time") {
    return isDateString(benefit.expiration) ? parseDate(benefit.expiration) : null;
  }

  const step = STEP_MONTHS[freq];
  if (!step) {
    return isDateString(benefit.expiration) ? parseDate(benefit.expiration) : null;
  }

  if (isDateString(benefit.expiration)) {
    let d = parseDate(benefit.expiration);
    let guard = 0;
    while (d < t && guard < 600) {
      d = addMonths(d, step);
      guard++;
    }
    return d;
  }

  const y = t.getFullYear();
  const m = t.getMonth(); // 0-11
  switch (freq) {
    case "monthly":
      return endOfMonth(y, m);
    case "quarterly":
      return endOfMonth(y, Math.floor(m / 3) * 3 + 2); // 2,5,8,11
    case "semiannual":
      return m < 6 ? endOfMonth(y, 5) : endOfMonth(y, 11);
    case "annual":
    default:
      return endOfMonth(y, 11);
  }
}

function daysUntilDate(date) {
  if (!date) return null;
  return Math.round((date - todayMidnight()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// "Used" state + usage history.
// If a Google Sheet backend is configured (js/config.js -> apiUrl), state syncs
// there across all devices and the reminder emails can read it. Otherwise it
// falls back to browser-only storage (localStorage).
// Used state is keyed per benefit PER PERIOD, so when a recurring offer rolls
// into a new period it automatically shows as available again.
// ---------------------------------------------------------------------------
const CFG = (typeof window !== "undefined" && window.CCB_CONFIG) || {};
const API_URL = (CFG.apiUrl || "").trim();
const API_TOKEN = (CFG.apiToken || "").trim();
const USE_REMOTE = API_URL.length > 0;

const LS_OVERRIDES = "ccb_overrides_v1";
const LS_HISTORY = "ccb_history_v1";

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn("localStorage read failed", e);
    return fallback;
  }
}

function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn("localStorage save failed", e);
  }
}

// key -> { used: bool }
let overrides = {};

async function loadOverrides() {
  if (USE_REMOTE) {
    setSyncStatus("syncing");
    try {
      const url = `${API_URL}?action=state&token=${encodeURIComponent(API_TOKEN)}&_=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!data || !data.ok || !data.state) throw new Error(data && data.error ? data.error : "bad response");
      overrides = {};
      for (const [k, v] of Object.entries(data.state)) overrides[k] = { used: !!v };
      saveJSON(LS_OVERRIDES, overrides); // keep an offline cache
      setSyncStatus("on", "Connected to your Google Sheet.");
      return;
    } catch (e) {
      console.warn("Remote state load failed; using local cache.", e);
      overrides = loadJSON(LS_OVERRIDES, {});
      setSyncStatus("error", String(e && e.message ? e.message : e));
      return;
    }
  }
  overrides = loadJSON(LS_OVERRIDES, {});
  setSyncStatus("off", "No backend configured (js/config.js). Changes stay in this browser.");
}

function usageKey(b) {
  const d = effectiveDeadline(b);
  const period = d ? toISODate(d) : b.frequency === "one-time" ? "once" : "nodate";
  return `${b.id}::${period}`;
}

function isUsed(b) {
  const ov = overrides[usageKey(b)];
  return ov ? ov.used : !!b.used;
}

function appendLocalHistory(b, used) {
  const d = effectiveDeadline(b);
  const history = loadJSON(LS_HISTORY, []);
  history.push({
    timestamp: new Date().toISOString(),
    action: used ? "used" : "unused",
    person: b.person || "",
    card: b.card,
    benefit: b.benefit,
    amount: b.amount || "",
    period: d ? toISODate(d) : "",
  });
  saveJSON(LS_HISTORY, history);
}

function sendRemoteSet(b, key, used) {
  const d = effectiveDeadline(b);
  const params = new URLSearchParams({
    action: "set",
    token: API_TOKEN,
    key,
    used: String(used),
    person: b.person || "",
    card: b.card,
    benefit: b.benefit,
    amount: b.amount || "",
    period: d ? toISODate(d) : "",
    _: String(Date.now()),
  });
  fetch(`${API_URL}?${params.toString()}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.ok) {
        console.warn("Remote save not ok:", data);
        setSyncStatus("error", "A change could not be saved to the Sheet.");
      } else {
        setSyncStatus("on", "Connected to your Google Sheet.");
      }
    })
    .catch((e) => {
      console.warn("Remote save failed (kept locally):", e);
      setSyncStatus("error", "A change could not be saved to the Sheet.");
    });
}

function toggleUsed(id) {
  const b = state.benefits.find((x) => x.id === id);
  if (!b) return;
  const key = usageKey(b);
  const next = !isUsed(b);
  overrides[key] = { used: next };
  saveJSON(LS_OVERRIDES, overrides); // cache/backup
  appendLocalHistory(b, next);
  render();
  if (USE_REMOTE) sendRemoteSet(b, key, next);
}

function exportHistoryCsv() {
  const history = loadJSON(LS_HISTORY, []);
  if (!history.length) {
    alert("No usage history recorded yet on this device.");
    return;
  }
  const headers = ["timestamp", "action", "person", "card", "benefit", "amount", "period"];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...history.map((h) => headers.map((k) => esc(h[k] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `credit-card-usage-log-${toISODate(todayMidnight())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function statusOf(benefit) {
  if (isUsed(benefit)) return "used";
  const days = daysUntilDate(effectiveDeadline(benefit));
  if (days === null) return "nodate";
  if (days < 0) return "expired";
  if (days <= SOON_DAYS) return "soon";
  return "active";
}

const STATUS_LABEL = {
  active: "Active",
  soon: "Expiring soon",
  expired: "Expired",
  used: "Used",
  nodate: "Date TBD",
};

function fmtDate(date) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function countdownText(benefit) {
  const date = effectiveDeadline(benefit);
  if (!date) return "Set a date";
  const days = daysUntilDate(date);
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Ends today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function personLabel(code) {
  if (!code) return "Unassigned";
  return state.people[code] || code;
}

async function loadData() {
  try {
    const res = await fetch("data/benefits.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.benefits = Array.isArray(data.benefits) ? data.benefits : [];
    state.people = data.people || {};
  } catch (err) {
    console.error("Failed to load benefits.json", err);
    els.board.innerHTML = `<p class="empty-note">Could not load <code>data/benefits.json</code>. If you opened this file directly, run a local server (see README) or view it on GitHub Pages.</p>`;
    return;
  }
  await loadOverrides();
  els.loadedAt.textContent = new Date().toLocaleString();
  populateFilters();
  render();
}

function passcodeGate() {
  const pass = (CFG.passcode || "").trim();
  if (!pass) return true;
  if (sessionStorage.getItem("ccb_unlocked") === "1") return true;
  const entered = prompt("Enter passcode to view your benefits:");
  if (entered === pass) {
    sessionStorage.setItem("ccb_unlocked", "1");
    return true;
  }
  document.body.innerHTML =
    '<p style="color:#eef0ff;font-family:sans-serif;padding:40px;text-align:center">Incorrect passcode. Refresh the page to try again.</p>';
  return false;
}

function populateFilters() {
  const cats = [...new Set(state.benefits.map((b) => b.category))].sort();
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    els.filterCategory.appendChild(opt);
  }

  const cards = [...new Set(state.benefits.map((b) => b.card))].sort();
  for (const card of cards) {
    const opt = document.createElement("option");
    opt.value = card;
    opt.textContent = card;
    els.filterCard.appendChild(opt);
  }
}

function renderStats() {
  const counts = { active: 0, soon: 0, expired: 0, used: 0, nodate: 0 };
  for (const b of state.benefits) counts[statusOf(b)] += 1;
  const available = counts.active + counts.soon + counts.nodate;
  const total = state.benefits.length;
  const cur = state.filters.status;
  const box = (status, num, cls, lbl) =>
    `<button type="button" class="stat ${cls}${cur === status ? " is-selected" : ""}" data-status="${status}">` +
    `<span class="num">${num}</span><span class="lbl">${lbl}</span></button>`;
  els.stats.innerHTML = [
    box("", total, "all", "All"),
    box("available", available, "active", "Available"),
    box("soon", counts.soon, "soon", "Expiring soon"),
    box("expired", counts.expired, "expired", "Expired"),
    box("used", counts.used, "used", "Used"),
  ].join("");
}

function applyFilters(list) {
  const f = state.filters;
  let out = list.filter((b) => {
    if (f.category && b.category !== f.category) return false;
    if (f.card && b.card !== f.card) return false;
    if (f.status) {
      const st = statusOf(b);
      if (f.status === "available") {
        if (st !== "active" && st !== "soon" && st !== "nodate") return false;
      } else if (st !== f.status) {
        return false;
      }
    }
    if (f.search) {
      const hay = `${b.card} ${b.benefit} ${b.category} ${personLabel(b.person)} ${b.notes || ""}`.toLowerCase();
      if (!hay.includes(f.search.toLowerCase())) return false;
    }
    return true;
  });

  const byDate = (a, b) => {
    const da = effectiveDeadline(a);
    const db = effectiveDeadline(b);
    if (!da && !db) return 0;
    if (!da) return 1; // no-date items sort last
    if (!db) return -1;
    return da - db;
  };
  const sorters = {
    expiration: byDate,
    "expiration-desc": (a, b) => -byDate(a, b),
    card: (a, b) => a.card.localeCompare(b.card) || byDate(a, b),
    category: (a, b) => a.category.localeCompare(b.category) || byDate(a, b),
    person: (a, b) => (a.person || "~").localeCompare(b.person || "~") || byDate(a, b),
  };
  const chosen = sorters[f.sort] || byDate;
  // Always push "used" items to the back. A refreshed offer (new period) is no
  // longer used, so it automatically rejoins the normal ordering.
  return out.sort((a, b) => {
    const ua = isUsed(a) ? 1 : 0;
    const ub = isUsed(b) ? 1 : 0;
    if (ua !== ub) return ua - ub;
    return chosen(a, b);
  });
}

function cardHtml(b) {
  const used = isUsed(b);
  const status = statusOf(b);
  const catClass = (CATEGORY_META[b.category] && CATEGORY_META[b.category].class) || "";
  const stateClass = used ? "is-used" : status === "expired" ? "is-expired" : "";
  const cd = countdownText(b);
  const cdClass = status === "expired" ? "expired" : status === "soon" ? "soon" : "";
  const amount = b.amount && b.amount !== "-" ? `<span class="card-amount">${escapeHtml(b.amount)}</span>` : "";
  const person = b.person
    ? `<span class="person-badge person-${escapeHtml(b.person)}">${escapeHtml(b.person)}</span>`
    : `<span class="person-badge person-none">?</span>`;
  const deadline = effectiveDeadline(b);
  const expLabel = deadline ? fmtDate(deadline) : "Not set";
  const expWord = b.frequency && b.frequency !== "one-time" ? "Resets" : "Expires";

  return `
    <article class="card ${catClass} ${stateClass}">
      <div class="card-top">
        <div class="card-top-left">
          <div class="card-card-name">${person}${escapeHtml(b.card)}</div>
          <div class="card-category">${escapeHtml(b.category)}</div>
        </div>
        <span class="status-badge ${status}">${STATUS_LABEL[status]}</span>
      </div>
      <div class="card-benefit">${escapeHtml(b.benefit)}${amount}</div>
      <div class="card-bottom">
        <div class="card-exp">${expWord} <span class="exp-date">${expLabel}</span></div>
        <div class="card-countdown ${cdClass}">${used ? "\u2713 Used" : cd}</div>
      </div>
      <button class="use-btn ${used ? "is-on" : ""}" type="button" data-id="${escapeHtml(b.id)}">${used ? "\u21A9 Mark unused" : "\u2713 Mark used"}</button>
    </article>`;
}

function render() {
  renderStats();
  const list = applyFilters(state.benefits);
  els.board.innerHTML = list.map(cardHtml).join("");
  els.emptyNote.hidden = list.length !== 0;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

els.search.addEventListener("input", (e) => { state.filters.search = e.target.value; render(); });
els.filterCategory.addEventListener("change", (e) => { state.filters.category = e.target.value; render(); });
els.filterCard.addEventListener("change", (e) => { state.filters.card = e.target.value; render(); });
els.filterStatus.addEventListener("change", (e) => { state.filters.status = e.target.value; render(); });
els.sortBy.addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });

els.stats.addEventListener("click", (e) => {
  const box = e.target.closest(".stat");
  if (!box) return;
  const status = box.dataset.status || "";
  state.filters.status = status;
  if (els.filterStatus) els.filterStatus.value = status;
  render();
});

els.board.addEventListener("click", (e) => {
  const btn = e.target.closest(".use-btn");
  if (btn) toggleUsed(btn.dataset.id);
});

const exportBtn = document.getElementById("export-log");
if (exportBtn) exportBtn.addEventListener("click", exportHistoryCsv);

if (passcodeGate()) loadData();
