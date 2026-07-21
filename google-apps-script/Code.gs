/**
 * Credit Card Bulletin - Google Sheets backend (Google Apps Script Web App).
 *
 * Stores which benefits are "used" (per period) and a full history log in the
 * Google Sheet this script is bound to. The website reads/writes this, and the
 * daily reminder email script reads it so it can skip used offers.
 *
 * SETUP (see README "Part 5" for the full walkthrough):
 *   1. Create a blank Google Sheet.
 *   2. Extensions -> Apps Script, paste this whole file, and change TOKEN below.
 *   3. Deploy -> New deployment -> Web app:
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   4. Copy the Web app URL into js/config.js (apiUrl) and set apiToken to the
 *      same value as TOKEN below. Also add them as GitHub secrets for emails.
 *
 * All requests are GET (simplest + most reliable from a browser):
 *   ?token=SECRET&action=state
 *       -> { ok:true, state: { "<benefitId>::<period>": true/false, ... } }
 *   ?token=SECRET&action=set&key=...&used=true&card=...&benefit=...&person=...&amount=...&period=...
 *       -> { ok:true }
 */

var TOKEN = "CHANGE_ME_TO_A_SECRET";      // must match apiToken in js/config.js
var STATE_SHEET = "state";
var HISTORY_SHEET = "history";

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== TOKEN) {
    return jsonOut({ ok: false, error: "bad token" });
  }

  var action = p.action || "state";

  if (action === "state") {
    return jsonOut({ ok: true, state: getState() });
  }

  if (action === "set") {
    if (!p.key) return jsonOut({ ok: false, error: "missing key" });
    var used = String(p.used).toLowerCase() === "true";
    setState(p.key, used, p);
    return jsonOut({ ok: true });
  }

  return jsonOut({ ok: false, error: "unknown action" });
}

function getState() {
  var sh = getSheet(STATE_SHEET);
  var values = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < values.length; i++) {
    var key = values[i][0];
    if (!key) continue;
    var v = values[i][1];
    out[key] = v === true || String(v).toLowerCase() === "true";
  }
  return out;
}

function setState(key, used, p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet(STATE_SHEET);
    var values = sh.getDataRange().getValues();
    var now = new Date();
    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === key) {
        rowIndex = i + 1; // 1-based, plus header row already counted
        break;
      }
    }
    if (rowIndex > 0) {
      sh.getRange(rowIndex, 2).setValue(used);
      sh.getRange(rowIndex, 3).setValue(now);
    } else {
      sh.appendRow([key, used, now]);
    }

    var hs = getSheet(HISTORY_SHEET);
    hs.appendRow([
      now,
      used ? "used" : "unused",
      p.person || "",
      p.card || "",
      p.benefit || "",
      p.amount || "",
      p.period || "",
      key,
    ]);
  } finally {
    lock.releaseLock();
  }
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === STATE_SHEET) {
      sh.appendRow(["key", "used", "updated_at"]);
    } else if (name === HISTORY_SHEET) {
      sh.appendRow(["timestamp", "action", "person", "card", "benefit", "amount", "period", "key"]);
    }
  }
  return sh;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
