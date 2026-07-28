// -----------------------------------------------------------------------------
// Website configuration. Edit the values below.
//
// Leave apiUrl EMPTY to run in browser-only mode (used-state saved only in this
// browser). Fill it in to sync used-state + history to your Google Sheet across
// all devices (see README "Part 5").
// -----------------------------------------------------------------------------
window.CCB_CONFIG = {
  // Paste your Google Apps Script Web App URL here (ends with /exec):
  apiUrl: "",

  // A shared secret you choose. Must match the TOKEN in google-apps-script/Code.gs.
  // Note: this file is public if your repo is public, so treat this as a light
  // deterrent, not strong security. Keep your site URL private.
  apiToken: "",

  // Optional: set a passcode to show a prompt before the board loads. This is a
  // light deterrent only (it can be bypassed by a technical user). Leave "" off.
  passcode: "",
};
