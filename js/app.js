"use strict";

const SOON_DAYS = 15;
const CFG = window.CCB_CONFIG || {};
const API_URL = (CFG.apiUrl || "").trim();
const API_TOKEN = (CFG.apiToken || "").trim();
const USE_REMOTE = API_URL.length > 0;

const CATEGORIES = [
  "Travel", "Dining", "Hotel", "Hotel Night", "Shopping",
  "Wellness", "Entertainment", "Transport", "Grocery", "Cashback", "Other"
];
const FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual", "one-time"];
const SPEND_TYPES = ["New card spend", "Retention", "Other"];

const state = {
  view: "overview", // overview | benefits | spends
  benefits: [],
  spends: [],
  filters: { search: "", person: "", card: "", status: "", sort: "deadline" },
  editing: null, // { type, mode, item } | null
};

const els = {
  board: document.getElementById("board"),
  empty: document.getElementById("empty"),
  stats: document.getElementById("stats"),
  sync: document.getElementById("sync-status"),
  search: document.getElementById("search"),
  filterPerson: document.getElementById("filter-person"),
  filterCard: document.getElementById("filter-card"),
  filterStatus: document.getElementById("filter-status"),
  sortBy: document.getElementById("sort-by"),
  editor: document.getElementById("editor"),
  editorForm: document.getElementById("editor-form"),
  editorTitle: document.getElementById("editor-title"),
  editorFields: document.getElementById("editor-fields"),
  editorDelete: document.getElementById("editor-delete"),
  editorClose: document.getElementById("editor-close"),
  editorCancel: document.getElementById("editor-cancel"),
  btnAdd: document.getElementById("btn-add"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnPass: document.getElementById("btn-pass"),
};

const LS_PASS = "ccb_v2_pass";

// ---------------------------------------------------------------------------
// Dates / deadlines
// ---------------------------------------------------------------------------
function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(str) {
  if (str == null || str === "") return null;
  const s = String(str).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function toISODate(date) {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function endOfMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0);
}

function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

const STEP_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

function effectiveDeadline(b) {
  const t = todayMidnight();
  const freq = b.frequency || "one-time";
  if (freq === "one-time") return parseDate(b.expiration);

  const step = STEP_MONTHS[freq];
  if (!step) return parseDate(b.expiration);

  if (parseDate(b.expiration)) {
    let d = parseDate(b.expiration);
    let guard = 0;
    while (d < t && guard < 600) {
      d = addMonths(d, step);
      guard += 1;
    }
    return d;
  }

  const y = t.getFullYear();
  const m = t.getMonth();
  if (freq === "monthly") return endOfMonth(y, m);
  if (freq === "quarterly") return endOfMonth(y, Math.floor(m / 3) * 3 + 2);
  if (freq === "semiannual") return m < 6 ? endOfMonth(y, 5) : endOfMonth(y, 11);
  return endOfMonth(y, 11);
}

function daysUntil(date) {
  if (!date) return null;
  return Math.round((date - todayMidnight()) / 86400000);
}

function fmtDate(date) {
  if (!date) return "Not set";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function isBenefitUsed(b) {
  const d = effectiveDeadline(b);
  if (!d) return !!b.used_period;
  return b.used_period === toISODate(d);
}

function benefitStatus(b) {
  if (isBenefitUsed(b)) return "used";
  const days = daysUntil(effectiveDeadline(b));
  if (days === null) return "nodate";
  if (days < 0) return "expired";
  if (days <= SOON_DAYS) return "soon";
  return "available";
}

function spendStatus(s) {
  const goal = Number(s.goal) || 0;
  const spent = Number(s.spent) || 0;
  if (goal > 0 && spent >= goal) return "met";
  const days = daysUntil(parseDate(s.deadline));
  if (days !== null && days < 0) return "missed";
  if (days !== null && days <= SOON_DAYS) return "duesoon";
  return "ontrack";
}

const BENEFIT_STATUS_LABEL = {
  available: "Available",
  soon: "Expiring soon",
  expired: "Expired",
  used: "Used",
  nodate: "Date TBD",
};
const SPEND_STATUS_LABEL = {
  ontrack: "On track",
  duesoon: "Due soon",
  missed: "Missed",
  met: "Met",
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
function setSync(kind, tip) {
  const labels = {
    off: "Offline demo",
    syncing: "Syncing…",
    on: "Synced to Sheet",
    error: "Sync error",
  };
  els.sync.className = `sync-badge sync-${kind}`;
  els.sync.textContent = labels[kind] || labels.off;
  els.sync.title = tip || "";
}

async function api(action, params = {}) {
  if (!USE_REMOTE) throw new Error("No API configured");
  const pass = sessionStorage.getItem(LS_PASS) || "";
  const q = new URLSearchParams({
    action,
    token: API_TOKEN,
    _: String(Date.now()),
    ...params,
  });
  if (pass) q.set("passcode", pass);
  // Drop empty optional fields except passcode/used_period which may be intentionally blank
  for (const [k, v] of [...q.entries()]) {
    if (v === undefined || v === null) q.delete(k);
  }
  const res = await fetch(`${API_URL}?${q.toString()}`, { cache: "no-store" });
  const data = await res.json();
  if (!data || !data.ok) throw new Error((data && data.error) || "API error");
  return data;
}

async function loadAll() {
  if (!USE_REMOTE) {
    const demo = window.CCB_DEMO || { benefits: [], spends: [] };
    state.benefits = structuredClone(demo.benefits);
    state.spends = structuredClone(demo.spends);
    setSync("off", "Set apiUrl in js/config.js to connect your Sheet.");
    return;
  }
  setSync("syncing");
  try {
    const data = await api("list");
    state.benefits = data.benefits || [];
    state.spends = data.spends || [];
    setSync("on", "Connected to Google Sheets.");
  } catch (e) {
    console.error(e);
    setSync("error", String(e.message || e));
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Passcode — stored in Sheet Config tab when synced; config.js only for demo
// ---------------------------------------------------------------------------
async function ensureUnlocked() {
  if (!USE_REMOTE) {
    const pass = (CFG.passcode || "").trim();
    if (!pass) return true;
    if (sessionStorage.getItem(LS_PASS) === pass) return true;
    const entered = prompt("Enter passcode:");
    if (entered === pass) {
      sessionStorage.setItem(LS_PASS, entered);
      return true;
    }
    document.body.innerHTML =
      '<p style="font-family:sans-serif;padding:48px;text-align:center;color:#12201c">Incorrect passcode. Refresh to try again.</p>';
    return false;
  }

  // Ask the Sheet whether a passcode is required (token only)
  let locked = false;
  try {
    const q = new URLSearchParams({
      action: "gate",
      token: API_TOKEN,
      _: String(Date.now()),
    });
    const res = await fetch(`${API_URL}?${q}`, { cache: "no-store" });
    const data = await res.json();
    if (data && data.ok) locked = !!data.locked;
  } catch (e) {
    console.warn("gate check failed", e);
  }

  if (!locked) {
    sessionStorage.removeItem(LS_PASS);
    return true;
  }

  // Already unlocked this session?
  if (sessionStorage.getItem(LS_PASS)) {
    try {
      await api("list");
      return true;
    } catch (e) {
      if (String(e.message) !== "bad passcode") throw e;
      sessionStorage.removeItem(LS_PASS);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const entered = prompt(attempt === 0 ? "Enter site passcode:" : "Incorrect. Try again:");
    if (entered === null) break;
    sessionStorage.setItem(LS_PASS, entered);
    try {
      await api("list");
      return true;
    } catch (e) {
      sessionStorage.removeItem(LS_PASS);
      if (String(e.message) !== "bad passcode") {
        alert("Could not reach Sheet: " + (e.message || e));
        return false;
      }
    }
  }

  document.body.innerHTML =
    '<p style="font-family:sans-serif;padding:48px;text-align:center;color:#12201c">Incorrect passcode. Refresh to try again.</p>';
  return false;
}

async function changePasscode() {
  if (!USE_REMOTE) {
    alert("In demo mode, set passcode in js/config.js.\nOnce Sheets is connected, change it in the Config tab or with this button.");
    return;
  }
  const next = prompt(
    "New site passcode:\n\n• Type a new phrase to set/change it\n• Leave blank and OK to remove the passcode gate\n• Cancel to keep the current one"
  );
  if (next === null) return;
  try {
    await api("set_passcode", { passcode: next });
    if (next.trim()) {
      sessionStorage.setItem(LS_PASS, next.trim());
      alert("Passcode updated. You’ll need it next time you open the site.");
    } else {
      sessionStorage.removeItem(LS_PASS);
      alert("Passcode removed. The site is open (anyone with the URL can view it).");
    }
  } catch (e) {
    if (String(e.message) === "bad passcode") {
      alert("Current session passcode is wrong. Refresh and unlock first, then try again.");
    } else {
      alert("Could not update passcode: " + (e.message || e));
    }
  }
}

// ---------------------------------------------------------------------------
// Filters / sort / render
// ---------------------------------------------------------------------------
function currentList() {
  if (state.view === "benefits") return state.benefits;
  if (state.view === "spends") return state.spends;
  // overview: wrap items with kind so filters/sort know what they are
  return [
    ...state.benefits.map((b) => ({ ...b, _kind: "benefit" })),
    ...state.spends.map((s) => ({ ...s, _kind: "spend" })),
  ];
}

function statusOf(item) {
  if (item._kind === "spend" || (state.view === "spends" && !item._kind)) return spendStatus(item);
  if (item._kind === "benefit" || state.view === "benefits") return benefitStatus(item);
  // overview without kind shouldn't happen; fall through
  return item.goal != null && item.label != null && !item.benefit
    ? spendStatus(item)
    : benefitStatus(item);
}

/** Map mixed statuses onto overview filter buckets */
function overviewBucket(st) {
  if (st === "soon" || st === "duesoon") return "soon";
  if (st === "available" || st === "ontrack" || st === "nodate") return "available";
  if (st === "used" || st === "met") return "done";
  if (st === "expired" || st === "missed") return "overdue";
  return st;
}

function populateFilterOptions() {
  const list = currentList();
  const people = [...new Set(list.map((x) => x.person).filter(Boolean))].sort();
  const cards = [...new Set(list.map((x) => x.card).filter(Boolean))].sort();

  const fill = (sel, values, allLabel) => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      values.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
    sel.value = values.includes(cur) || cur === "" ? cur : "";
  };
  fill(els.filterPerson, people, "All people");
  fill(els.filterCard, cards, "All cards");

  if (state.view === "overview") {
    els.filterStatus.innerHTML = `
      <option value="">All statuses</option>
      <option value="available">Available / on track</option>
      <option value="soon">Due / expiring soon</option>
      <option value="done">Used / met</option>
      <option value="overdue">Expired / missed</option>`;
    els.sortBy.innerHTML = `
      <option value="deadline">Deadline (soonest)</option>
      <option value="deadline-desc">Deadline (latest)</option>
      <option value="card">Card</option>
      <option value="person">Person</option>
      <option value="kind">Type (benefit / spend)</option>`;
  } else if (state.view === "benefits") {
    els.filterStatus.innerHTML = `
      <option value="">All statuses</option>
      <option value="available">Available</option>
      <option value="soon">Expiring soon</option>
      <option value="used">Used</option>
      <option value="expired">Expired</option>`;
    els.sortBy.innerHTML = `
      <option value="deadline">Deadline (soonest)</option>
      <option value="deadline-desc">Deadline (latest)</option>
      <option value="card">Card</option>
      <option value="person">Person</option>`;
  } else {
    els.filterStatus.innerHTML = `
      <option value="">All statuses</option>
      <option value="ontrack">On track</option>
      <option value="duesoon">Due soon</option>
      <option value="met">Met</option>
      <option value="missed">Missed</option>`;
    els.sortBy.innerHTML = `
      <option value="deadline">Deadline (soonest)</option>
      <option value="remaining">Amount left</option>
      <option value="card">Card</option>
      <option value="person">Person</option>`;
  }
  if (![...els.filterStatus.options].some((o) => o.value === state.filters.status)) {
    state.filters.status = "";
  }
  if (![...els.sortBy.options].some((o) => o.value === state.filters.sort)) {
    state.filters.sort = "deadline";
  }
  els.filterStatus.value = state.filters.status;
  els.sortBy.value = state.filters.sort;
}

function applyFilters(list) {
  const f = state.filters;
  let out = list.filter((item) => {
    if (f.person && item.person !== f.person) return false;
    if (f.card && item.card !== f.card) return false;
    if (f.status) {
      const st = statusOf(item);
      if (state.view === "overview") {
        if (overviewBucket(st) !== f.status) return false;
      } else if (f.status === "available") {
        if (st !== "available" && st !== "soon" && st !== "nodate") return false;
      } else if (st !== f.status) {
        return false;
      }
    }
    if (f.search) {
      const hay = Object.values(item).join(" ").toLowerCase();
      if (!hay.includes(f.search.toLowerCase())) return false;
    }
    return true;
  });

  const deadlineOf = (item) => {
    if (item._kind === "spend" || (state.view === "spends" && !item.benefit)) {
      return parseDate(item.deadline);
    }
    return effectiveDeadline(item);
  };

  const byDeadline = (a, b) => {
    const da = deadlineOf(a);
    const db = deadlineOf(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  };

  const doneLast = (a, b) => {
    const done = (item) => {
      const st = statusOf(item);
      return st === "used" || st === "met" ? 1 : 0;
    };
    return done(a) - done(b);
  };

  const sorters = {
    deadline: byDeadline,
    "deadline-desc": (a, b) => -byDeadline(a, b),
    card: (a, b) => (a.card || "").localeCompare(b.card || "") || byDeadline(a, b),
    person: (a, b) => (a.person || "~").localeCompare(b.person || "~") || byDeadline(a, b),
    kind: (a, b) => (a._kind || "").localeCompare(b._kind || "") || byDeadline(a, b),
    remaining: (a, b) => {
      const ra = Math.max(0, (Number(a.goal) || 0) - (Number(a.spent) || 0));
      const rb = Math.max(0, (Number(b.goal) || 0) - (Number(b.spent) || 0));
      return rb - ra || byDeadline(a, b);
    },
  };

  const chosen = sorters[f.sort] || byDeadline;
  return out.sort((a, b) => doneLast(a, b) || chosen(a, b));
}

function renderStats() {
  const list = currentList();
  const counts = {};
  for (const item of list) {
    const st = statusOf(item);
    const key = state.view === "overview" ? overviewBucket(st) : st;
    counts[key] = (counts[key] || 0) + 1;
  }
  const cur = state.filters.status;
  const box = (status, num, cls, lbl) =>
    `<button type="button" class="stat ${cls}${cur === status ? " is-selected" : ""}" data-status="${status}">` +
    `<span class="num">${num}</span><span class="lbl">${lbl}</span></button>`;

  if (state.view === "overview") {
    els.stats.innerHTML = [
      box("", list.length, "all", "All"),
      box("available", counts.available || 0, "available", "Open"),
      box("soon", counts.soon || 0, "soon", "Soon"),
      box("overdue", counts.overdue || 0, "expired", "Overdue"),
      box("done", counts.done || 0, "used", "Done"),
    ].join("");
  } else if (state.view === "benefits") {
    const available = (counts.available || 0) + (counts.soon || 0) + (counts.nodate || 0);
    els.stats.innerHTML = [
      box("", list.length, "all", "All"),
      box("available", available, "available", "Available"),
      box("soon", counts.soon || 0, "soon", "Expiring soon"),
      box("expired", counts.expired || 0, "expired", "Expired"),
      box("used", counts.used || 0, "used", "Used"),
    ].join("");
  } else {
    els.stats.innerHTML = [
      box("", list.length, "all", "All"),
      box("ontrack", counts.ontrack || 0, "available", "On track"),
      box("duesoon", counts.duesoon || 0, "soon", "Due soon"),
      box("missed", counts.missed || 0, "missed", "Missed"),
      box("met", counts.met || 0, "met", "Met"),
    ].join("");
  }
}

function benefitCard(b, { showKind = false } = {}) {
  const st = benefitStatus(b);
  const used = isBenefitUsed(b);
  const deadline = effectiveDeadline(b);
  const days = daysUntil(deadline);
  const catClass = `cat-${(b.category || "other").toLowerCase().replace(/\s+/g, "-")}`;
  const expWord = b.frequency && b.frequency !== "one-time" ? "Resets" : "Expires";
  let countdown = "Set a date";
  let cdClass = "";
  if (used) countdown = "✓ Used this period";
  else if (days !== null) {
    if (days < 0) { countdown = `Expired ${Math.abs(days)}d ago`; cdClass = "hot"; }
    else if (days === 0) { countdown = "Ends today"; cdClass = "hot"; }
    else { countdown = `${days}d left`; cdClass = days <= SOON_DAYS ? "hot" : "ok"; }
  }
  const kind = showKind ? `<span class="kind-chip benefit">Benefit</span>` : "";

  return `
    <article class="card ${catClass} status-${st} ${used || st === "expired" ? "is-dim" : ""}" data-id="${escapeAttr(b.id)}" data-kind="benefit">
      <div class="card-top">
        <div>
          <div class="card-meta">${personBadge(b.person)}${escapeHtml(b.card)}${kind}</div>
          <div class="card-cat">${escapeHtml(b.category || "")}</div>
        </div>
        <span class="badge ${st}">${BENEFIT_STATUS_LABEL[st]}</span>
      </div>
      <h3 class="card-title">${escapeHtml(b.benefit)}${b.amount ? `<span class="card-amount">${escapeHtml(b.amount)}</span>` : ""}</h3>
      <div class="card-foot">
        <span>${expWord} <strong>${fmtDate(deadline)}</strong></span>
        <span class="${cdClass}">${countdown}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="btn" data-act="toggle-used">${used ? "↩ Unused" : "✓ Mark used"}</button>
        <button type="button" class="btn ghost" data-act="edit">Edit</button>
        <button type="button" class="btn ghost" data-act="delete">Del</button>
      </div>
    </article>`;
}

function spendCard(s, { showKind = false } = {}) {
  const st = spendStatus(s);
  const goal = Number(s.goal) || 0;
  const spent = Number(s.spent) || 0;
  const pct = goal > 0 ? Math.min(100, Math.round((spent / goal) * 100)) : 0;
  const left = Math.max(0, goal - spent);
  const deadline = parseDate(s.deadline);
  const days = daysUntil(deadline);
  let countdown = "No deadline";
  let cdClass = "";
  if (st === "met") countdown = "Goal met";
  else if (days !== null) {
    if (days < 0) { countdown = `Missed ${Math.abs(days)}d ago`; cdClass = "hot"; }
    else if (days === 0) { countdown = "Due today"; cdClass = "hot"; }
    else { countdown = `${days}d left`; cdClass = days <= SOON_DAYS ? "hot" : "ok"; }
  }
  const kind = showKind ? `<span class="kind-chip spend">Spend</span>` : "";
  const typeLabel = s.label || "Spend goal";
  const progressHot = st === "duesoon" || st === "missed" ? " is-hot" : "";

  return `
    <article class="card spend-card status-${st} ${st === "met" || st === "missed" ? "is-dim" : ""}" data-id="${escapeAttr(s.id)}" data-kind="spend">
      <div class="card-top">
        <div>
          <div class="card-meta">${personBadge(s.person)}${escapeHtml(s.card)}${kind}</div>
          <div class="card-cat">${escapeHtml(typeLabel)}</div>
        </div>
        <span class="badge ${st}">${SPEND_STATUS_LABEL[st]}</span>
      </div>
      <h3 class="card-title">${escapeHtml(s.card)} · ${escapeHtml(typeLabel)}</h3>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:6px">
          <strong>${money(spent)}</strong>
          <span style="color:var(--muted)">of ${money(goal)} · ${money(left)} left</span>
        </div>
        <div class="progress${progressHot}"><span style="width:${pct}%"></span></div>
      </div>
      <div class="card-foot">
        <span>By <strong>${fmtDate(deadline)}</strong></span>
        <span class="${cdClass}">${countdown}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="btn" data-act="log-spend">Update spent</button>
        <button type="button" class="btn ghost" data-act="edit">Edit</button>
        <button type="button" class="btn ghost" data-act="delete">Del</button>
      </div>
    </article>`;
}

function personBadge(code) {
  if (!code) return `<span class="person">?</span>`;
  return `<span class="person ${escapeAttr(code)}">${escapeHtml(code)}</span>`;
}

function render() {
  populateFilterOptions();
  renderStats();
  const list = applyFilters(currentList());
  const showKind = state.view === "overview";
  els.board.innerHTML = list.map((item) => {
    if (item._kind === "spend" || (state.view === "spends" && !item.benefit)) {
      return spendCard(item, { showKind });
    }
    return benefitCard(item, { showKind });
  }).join("");
  els.empty.hidden = list.length !== 0;
  if (state.view === "overview") els.btnAdd.textContent = "+ Add";
  else if (state.view === "benefits") els.btnAdd.textContent = "+ Add benefit";
  else els.btnAdd.textContent = "+ Add spend";
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
function field(label, name, value, type = "text", opts = null) {
  if (type === "select") {
    const options = opts.map((o) => {
      const v = typeof o === "string" ? o : o.value;
      const t = typeof o === "string" ? o : o.label;
      return `<option value="${escapeAttr(v)}" ${String(value) === String(v) ? "selected" : ""}>${escapeHtml(t)}</option>`;
    }).join("");
    return `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options}</select></div>`;
  }
  if (type === "textarea") {
    return `<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}">${escapeHtml(value || "")}</textarea></div>`;
  }
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${escapeAttr(value || "")}" /></div>`;
}

function openEditor(mode, item = null, forceType = null) {
  // Overview "+ Add" without forceType → chooser first
  if (mode === "new" && state.view === "overview" && !forceType) {
    state.editing = { type: "chooser", mode: "new", item: null };
    els.editorTitle.textContent = "What do you want to add?";
    els.editorDelete.hidden = true;
    els.editorFields.innerHTML = `
      <div class="add-chooser">
        <button type="button" class="btn" data-choose="benefit">
          Benefit
          <small>Credits, free nights, dining perks…</small>
        </button>
        <button type="button" class="btn" data-choose="spend">
          Spend goal
          <small>New card spend or retention threshold</small>
        </button>
      </div>`;
    document.getElementById("editor-save").hidden = true;
    if (typeof els.editor.showModal === "function") els.editor.showModal();
    else els.editor.setAttribute("open", "");
    return;
  }

  let kind = forceType;
  if (!kind && item) {
    if (item._kind) kind = item._kind;
    else if (Object.prototype.hasOwnProperty.call(item, "goal")) kind = "spend";
    else kind = "benefit";
  }
  if (!kind) kind = state.view === "spends" ? "spend" : "benefit";

  document.getElementById("editor-save").hidden = false;
  state.editing = { type: kind, mode, item };
  const isNew = mode === "new";
  els.editorTitle.textContent = isNew
    ? (kind === "benefit" ? "Add benefit" : "Add spend goal")
    : (kind === "benefit" ? "Edit benefit" : "Edit spend goal");
  els.editorDelete.hidden = isNew;

  if (kind === "benefit") {
    const b = item || {
      person: "C", card: "", benefit: "", category: "Dining", amount: "",
      frequency: "monthly", expiration: "", notes: ""
    };
    els.editorFields.innerHTML = `
      <input type="hidden" name="id" value="${escapeAttr(b.id || "")}" />
      <div class="field-row">
        ${field("Person", "person", b.person, "select", ["C", "H", ""])}
        ${field("Category", "category", b.category, "select", CATEGORIES)}
      </div>
      ${field("Card", "card", b.card)}
      ${field("Benefit", "benefit", b.benefit)}
      <div class="field-row">
        ${field("Amount label", "amount", b.amount)}
        ${field("Frequency", "frequency", b.frequency, "select", FREQUENCIES)}
      </div>
      ${field("Anchor / expiration (optional)", "expiration", b.expiration, "date")}
      ${field("Notes", "notes", b.notes, "textarea")}
      <p style="margin:0;font-size:0.78rem;color:var(--muted)">
        Leave date empty for calendar resets (end of month/quarter/year). Set a date for anniversary renewals.
      </p>`;
  } else {
    const rawLabel = (item && item.label) || "New card spend";
    const known = SPEND_TYPES.includes(rawLabel) ? rawLabel : "Other";
    const s = item || {
      person: "C", card: "", label: "New card spend", goal: "", spent: "0", deadline: "", notes: ""
    };
    els.editorFields.innerHTML = `
      <input type="hidden" name="id" value="${escapeAttr(s.id || "")}" />
      <div class="field-row">
        ${field("Person", "person", s.person, "select", ["C", "H", ""])}
        ${field("Deadline", "deadline", s.deadline, "date")}
      </div>
      ${field("Card", "card", s.card)}
      ${field("Type", "label", known, "select", SPEND_TYPES)}
      <div class="field-row">
        ${field("Goal ($)", "goal", s.goal, "number")}
        ${field("Spent so far ($)", "spent", s.spent, "number")}
      </div>
      ${field("Notes", "notes", s.notes, "textarea")}`;
  }

  if (typeof els.editor.showModal === "function") els.editor.showModal();
  else els.editor.setAttribute("open", "");
}

function closeEditor() {
  if (typeof els.editor.close === "function") els.editor.close();
  else els.editor.removeAttribute("open");
  state.editing = null;
}

function formValues() {
  const data = {};
  els.editorFields.querySelectorAll("[name]").forEach((el) => {
    data[el.name] = el.value;
  });
  return data;
}

async function saveEditor(e) {
  e.preventDefault();
  if (state.editing && state.editing.type === "chooser") return;
  const vals = formValues();
  const kind = state.editing && state.editing.type;
  try {
    if (kind === "benefit") {
      if (!vals.card || !vals.benefit) {
        alert("Card and benefit are required.");
        return;
      }
      if (USE_REMOTE) {
        const res = await api("benefit_upsert", vals);
        const idx = state.benefits.findIndex((b) => b.id === res.benefit.id);
        if (idx >= 0) state.benefits[idx] = res.benefit;
        else state.benefits.push(res.benefit);
      } else {
        const id = vals.id || `local-${Date.now()}`;
        const row = { ...vals, id, used_period: (state.editing.item && state.editing.item.used_period) || "" };
        const idx = state.benefits.findIndex((b) => b.id === id);
        if (idx >= 0) state.benefits[idx] = { ...state.benefits[idx], ...row };
        else state.benefits.push(row);
      }
    } else if (kind === "spend") {
      if (!vals.card || !vals.label) {
        alert("Card and type are required.");
        return;
      }
      if (!vals.deadline) {
        alert("Please set a deadline so due-soon colors can work.");
        return;
      }
      if (USE_REMOTE) {
        const res = await api("spend_upsert", vals);
        const idx = state.spends.findIndex((s) => s.id === res.spend.id);
        if (idx >= 0) state.spends[idx] = res.spend;
        else state.spends.push(res.spend);
      } else {
        const id = vals.id || `local-${Date.now()}`;
        const row = { ...vals, id, goal: Number(vals.goal) || 0, spent: Number(vals.spent) || 0 };
        const idx = state.spends.findIndex((s) => s.id === id);
        if (idx >= 0) state.spends[idx] = { ...state.spends[idx], ...row };
        else state.spends.push(row);
      }
    }
    closeEditor();
    render();
  } catch (err) {
    alert("Save failed: " + (err.message || err));
    setSync("error", String(err.message || err));
  }
}

async function deleteEditing() {
  const item = state.editing && state.editing.item;
  const kind = state.editing && state.editing.type;
  if (!item || kind === "chooser") return;
  if (!confirm("Delete this permanently?")) return;
  try {
    if (kind === "benefit") {
      if (USE_REMOTE) await api("benefit_delete", { id: item.id });
      state.benefits = state.benefits.filter((b) => b.id !== item.id);
    } else {
      if (USE_REMOTE) await api("spend_delete", { id: item.id });
      state.spends = state.spends.filter((s) => s.id !== item.id);
    }
    closeEditor();
    render();
  } catch (err) {
    alert("Delete failed: " + (err.message || err));
  }
}

async function toggleUsed(id) {
  const b = state.benefits.find((x) => x.id === id);
  if (!b) return;
  const period = toISODate(effectiveDeadline(b));
  const next = isBenefitUsed(b) ? "" : period;
  try {
    if (USE_REMOTE) {
      const res = await api("benefit_set_used", { id, used_period: next });
      Object.assign(b, res.benefit);
    } else {
      b.used_period = next;
    }
    render();
  } catch (err) {
    alert("Could not update used state: " + (err.message || err));
    setSync("error", String(err.message || err));
  }
}

async function logSpend(id) {
  const s = state.spends.find((x) => x.id === id);
  if (!s) return;
  const raw = prompt(`Spent so far toward ${money(s.goal)}:`, String(s.spent || 0));
  if (raw === null) return;
  const spent = Number(raw);
  if (Number.isNaN(spent) || spent < 0) {
    alert("Enter a valid number.");
    return;
  }
  const payload = { ...s, spent };
  try {
    if (USE_REMOTE) {
      const res = await api("spend_upsert", payload);
      Object.assign(s, res.spend);
    } else {
      s.spent = spent;
    }
    render();
  } catch (err) {
    alert("Update failed: " + (err.message || err));
  }
}

async function deleteItem(id, kind) {
  if (!confirm("Delete this permanently?")) return;
  try {
    if (kind === "spend") {
      if (USE_REMOTE) await api("spend_delete", { id });
      state.spends = state.spends.filter((s) => s.id !== id);
    } else {
      if (USE_REMOTE) await api("benefit_delete", { id });
      state.benefits = state.benefits.filter((b) => b.id !== id);
    }
    render();
  } catch (err) {
    alert("Delete failed: " + (err.message || err));
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/\n/g, " ");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.view = tab.dataset.view;
    state.filters.status = "";
    state.filters.sort = "deadline";
    render();
  });
});

els.search.addEventListener("input", (e) => { state.filters.search = e.target.value; render(); });
els.filterPerson.addEventListener("change", (e) => { state.filters.person = e.target.value; render(); });
els.filterCard.addEventListener("change", (e) => { state.filters.card = e.target.value; render(); });
els.filterStatus.addEventListener("change", (e) => { state.filters.status = e.target.value; render(); });
els.sortBy.addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });

els.stats.addEventListener("click", (e) => {
  const box = e.target.closest(".stat");
  if (!box) return;
  state.filters.status = box.dataset.status || "";
  render();
});

els.board.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest("[data-id]");
  const id = card && card.dataset.id;
  const kind = (card && card.dataset.kind) || (state.view === "spends" ? "spend" : "benefit");
  if (!id) return;
  const act = btn.dataset.act;
  if (act === "toggle-used") toggleUsed(id);
  else if (act === "log-spend") logSpend(id);
  else if (act === "edit") {
    const item = kind === "spend"
      ? state.spends.find((x) => x.id === id)
      : state.benefits.find((x) => x.id === id);
    openEditor("edit", item, kind);
  } else if (act === "delete") deleteItem(id, kind);
});

els.editorFields.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-choose]");
  if (!pick) return;
  openEditor("new", null, pick.dataset.choose);
});

els.btnAdd.addEventListener("click", () => openEditor("new"));
if (els.btnPass) els.btnPass.addEventListener("click", changePasscode);
els.btnRefresh.addEventListener("click", async () => {
  try {
    await loadAll();
    render();
  } catch (_) { /* badge already shows error */ }
});
els.editorClose.addEventListener("click", () => {
  document.getElementById("editor-save").hidden = false;
  closeEditor();
});
els.editorCancel.addEventListener("click", () => {
  document.getElementById("editor-save").hidden = false;
  closeEditor();
});
els.editorDelete.addEventListener("click", deleteEditing);
els.editorForm.addEventListener("submit", saveEditor);

async function boot() {
  if (!(await ensureUnlocked())) return;
  try {
    await loadAll();
  } catch (_) {
    // Keep empty board; sync badge shows error
  }
  render();
}

boot();
