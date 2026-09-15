// Optional Google Drive AppData sync.
// When NOT signed in, this module does nothing and the app runs as before
// (single-device IndexedDB). When signed in, the weights table is kept in
// sync with a `weighttracker.json` file in the user's private appdata
// folder on Drive:
//   - local changes are uploaded automatically (debounced 3s)
//   - remote changes are pulled and merged in on every reconnect (page load
//     or silent session restore), on tab focus, and every 5 minutes while
//     the tab stays open — so two devices signed into the same account
//     converge without requiring a reload on either one.
// The merge is per-entry: for each date, whichever side has the newer
// `updatedAt` wins. This is safe to run silently and often (no "which do
// you want to keep" prompt needed) because it never discards a genuinely
// newer edit on either side.
//
// Design notes:
// - Sync metadata (OAuth client id, last-sync timestamp, tokens) lives in
//   localStorage, NOT in the DB. This avoids two problems: (1) writing the
//   timestamp would fire data-changed and cause a sync loop, and (2) each
//   device/deployment configures its own OAuth client id so it should not
//   sync as app data.
// - Every DB mutation fires `data-changed` (see db.js); this module debounces
//   those and schedules an upload. Uploads suppressed during hydration
//   (full-replace import), but NOT during a merge — a merge that pulls in
//   remote rows should still push the resulting union back to Drive so
//   other devices converge too.
// - Silent token refresh runs before each Drive call so an expired token
//   doesn't fail the operation.
//
const DRIVE_FILE_NAME = 'weighttracker.json';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

const LS_LAST_SYNC = 'weight_sync_last_sync';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_CLIENT_ID — the OAuth 2.0 Client ID that YOU (the app author)
// registered in Google Cloud Console for this deployment. When set, users just
// click "Sign in with Google" and never see a setup prompt.
//
// Client IDs are public identifiers (not secrets), so it's safe to commit this
// value to the repo and ship it in the browser bundle. The security boundary
// comes from the Authorized JavaScript origins you configured on the Client ID
// — Google will only issue tokens if the OAuth request originates from one of
// those origins.
//
// Setup: Google Cloud Console → APIs & Services → Credentials → Create
// Credentials → OAuth client ID → Web application → add this app's hosting
// URL under Authorized JavaScript origins → paste the Client ID below.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CLIENT_ID = '854238608874-bid7ldrjnjkd5a6r285gjuhtg5ld77n8.apps.googleusercontent.com'; // e.g. '1234567890-xxxxxxx.apps.googleusercontent.com'

// State exposed globally so the Alpine sync panel and any diagnostics can
// read it. UI subscribes to the 'sync-state-changed' custom event to react.
window.sync = {
  clientId: DEFAULT_CLIENT_ID,
  hasDefaultClientId: !!DEFAULT_CLIENT_ID,
  signedIn: false,
  userEmail: '',
  lastSyncedAt: null,       // ms since epoch
  lastError: '',
  syncing: false,
  pendingUpload: false,
  ready: false,             // Google SDK loaded and ready
  _tokenClient: null,
  _accessToken: '',
  _tokenExpiresAt: 0,
  _fileId: '',
  _debounceTimer: null,
  _hydrating: false,        // suppress uploads while replacing local from remote
  _initialized: false
};

function notifyState() {
  window.dispatchEvent(new CustomEvent('sync-state-changed'));
}

async function initSync() {
  if (window.sync._initialized) return;
  window.sync._initialized = true;

  window.sync.clientId = DEFAULT_CLIENT_ID || '';
  const lastSyncStr = localStorage.getItem(LS_LAST_SYNC);
  window.sync.lastSyncedAt = lastSyncStr ? Number(lastSyncStr) : null;

  // Wait for the Google Identity Services script to load, then try to restore
  // the previous sign-in silently (no popup) if the user granted consent before.
  await waitForGoogleSdk();
  window.sync.ready = true;
  notifyState();

  if (window.sync.clientId) {
    tryRestoreSession().catch(() => {}); // silent; user can click Sign in manually
  }

  window.addEventListener('data-changed', () => scheduleUpload());

  // Pull in whatever another device may have pushed since our last reconcile
  // — on tab focus (covers "switched back to an already-open tab") and on a
  // timer (covers "left the tab open in the foreground for a while").
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.sync.signedIn) reconcile().catch(() => {});
  });
  setInterval(() => {
    if (window.sync.signedIn) reconcile().catch(() => {});
  }, 5 * 60 * 1000);
}

function waitForGoogleSdk() {
  return new Promise(resolve => {
    if (window.google?.accounts?.oauth2) return resolve();
    const start = Date.now();
    const iv = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(iv); resolve(); }
      else if (Date.now() - start > 8000) { clearInterval(iv); resolve(); } // give up, let user retry
    }, 100);
  });
}

function getTokenClient() {
  // Recreate if client id has changed
  if (window.sync._tokenClient && window.sync._tokenClient._clientIdSnapshot === window.sync.clientId) {
    return window.sync._tokenClient;
  }
  window.sync._tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: window.sync.clientId,
    scope: SCOPES,
    callback: () => {} // overridden per-request
  });
  window.sync._tokenClient._clientIdSnapshot = window.sync.clientId;
  return window.sync._tokenClient;
}

async function tryRestoreSession() {
  return new Promise(resolve => {
    const client = getTokenClient();
    client.callback = async (resp) => {
      if (resp?.access_token) {
        await afterTokenIssued(resp);
        resolve(true);
      } else {
        resolve(false);
      }
    };
    // Empty prompt = silent; only succeeds if user has active Google session
    // AND has previously granted consent to this client.
    client.requestAccessToken({ prompt: '' });
  });
}

async function signIn() {
  if (!window.sync.clientId) {
    window.sync.lastError = 'Enter your Google OAuth Client ID first.';
    notifyState();
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    window.sync.lastError = 'Google sign-in library not loaded yet — try again in a moment.';
    notifyState();
    return;
  }
  return new Promise((resolve, reject) => {
    const client = getTokenClient();
    client.callback = async (resp) => {
      if (resp?.access_token) {
        await afterTokenIssued(resp);
        resolve();
      } else {
        window.sync.lastError = resp?.error_description || resp?.error || 'Sign-in was cancelled or failed.';
        notifyState();
        reject(new Error(window.sync.lastError));
      }
    };
    client.requestAccessToken({ prompt: 'consent' });
  });
}

async function afterTokenIssued(resp) {
  window.sync._accessToken = resp.access_token;
  window.sync._tokenExpiresAt = Date.now() + (Number(resp.expires_in || 3600) * 1000);
  window.sync.signedIn = true;
  window.sync.lastError = '';
  // Fetch the user email so the UI can display it
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + resp.access_token }
    });
    if (r.ok) {
      const info = await r.json();
      window.sync.userEmail = info.email || '';
    }
  } catch { /* non-fatal */ }
  notifyState();
  // Reconcile with Drive on every connect — fresh sign-in or a silently
  // restored session both need this, since another device may have pushed
  // changes since we last synced.
  await reconcile();
}

function signOut() {
  // We keep the client id in localStorage so signing back in doesn't require
  // re-typing it, and we keep local IndexedDB intact.
  if (window.sync._accessToken && window.google?.accounts?.oauth2?.revoke) {
    try { google.accounts.oauth2.revoke(window.sync._accessToken); } catch {}
  }
  window.sync.signedIn = false;
  window.sync._accessToken = '';
  window.sync._tokenExpiresAt = 0;
  window.sync.userEmail = '';
  window.sync._fileId = '';
  notifyState();
}

// Ensure the access token has at least ~1min of life left; refresh silently if
// not. Returns true when the caller can proceed with an authenticated request.
async function ensureFreshToken() {
  if (!window.sync.signedIn) return false;
  if (window.sync._tokenExpiresAt - Date.now() > 60000) return true;
  return new Promise(resolve => {
    const client = getTokenClient();
    client.callback = async (resp) => {
      if (resp?.access_token) {
        window.sync._accessToken = resp.access_token;
        window.sync._tokenExpiresAt = Date.now() + (Number(resp.expires_in || 3600) * 1000);
        resolve(true);
      } else {
        // Silent refresh failed — user needs to sign in again
        window.sync.signedIn = false;
        notifyState();
        resolve(false);
      }
    };
    client.requestAccessToken({ prompt: '' });
  });
}

// Pull the remote file (if any), merge it into local (newer `updatedAt` per
// date wins — see file header), then push the resulting union back to Drive
// so any local-only changes (e.g. made while offline or before sign-in)
// reach the other device too. Safe to call often: a no-op merge triggers no
// writes, so it doesn't spam Drive with redundant uploads.
async function reconcile() {
  if (!window.sync.signedIn) return;
  try {
    await ensureFileId();
    if (window.sync._fileId) {
      if (!await ensureFreshToken()) return;
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${window.sync._fileId}?alt=media`,
        { headers: { Authorization: 'Bearer ' + window.sync._accessToken } }
      );
      if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
      const payload = await res.json();
      await mergeFromRemote(payload.weights || []);
    }
  } catch (err) {
    window.sync.lastError = String(err.message || err);
    notifyState();
  }
  await uploadNow().catch(() => {}); // errors already surfaced via lastError inside uploadNow
}

async function mergeFromRemote(remoteWeights) {
  // Suppress the debounced auto-upload for these writes — reconcile() already
  // pushes the merged result explicitly right after this, so letting
  // scheduleUpload also fire here would just cause a redundant second upload.
  // The entry form / chart still refresh normally: they listen for
  // data-changed directly and don't check this flag.
  window.sync._hydrating = true;
  try {
    await db.transaction('rw', db.weights, async () => {
      for (const r of remoteWeights) {
        if (!r || !r.date) continue;
        const local = await db.weights.get(r.date);
        if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) {
          await db.weights.put({ date: r.date, weightKg: r.weightKg, updatedAt: r.updatedAt || 0 });
        }
      }
    });
  } finally {
    window.sync._hydrating = false;
  }
  window.sync.lastSyncedAt = Date.now();
  localStorage.setItem(LS_LAST_SYNC, String(window.sync.lastSyncedAt));
  notifyState();
}

async function ensureFileId() {
  if (!await ensureFreshToken()) return null;
  const q = encodeURIComponent(`name = '${DRIVE_FILE_NAME}'`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=${q}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + window.sync._accessToken } });
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const data = await res.json();
  const file = (data.files || [])[0];
  window.sync._fileId = file ? file.id : '';
  return file || null;
}

async function hydrateFromPayload(data) {
  // Same shape as the Export/Import format (see backup.js).
  window.sync._hydrating = true;
  try {
    await db.transaction('rw', db.weights, async () => {
      await db.weights.clear();
      if (data.weights?.length) await db.weights.bulkAdd(data.weights);
    });
  } finally {
    window.sync._hydrating = false;
  }
}

function scheduleUpload() {
  if (!window.sync.signedIn) return;
  if (window.sync._hydrating) return;
  window.sync.pendingUpload = true;
  clearTimeout(window.sync._debounceTimer);
  window.sync._debounceTimer = setTimeout(() => {
    uploadNow().catch(err => {
      window.sync.lastError = String(err.message || err);
      window.sync.syncing = false;
      notifyState();
    });
  }, 3000);
  notifyState();
}

async function buildPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    weights: await db.weights.toArray()
  };
}

async function uploadNow() {
  if (!window.sync.signedIn) return;
  if (!await ensureFreshToken()) return;
  window.sync.syncing = true;
  window.sync.pendingUpload = false;
  notifyState();
  try {
    const payload = await buildPayload();
    await ensureFileId(); // may already be cached
    const body = JSON.stringify(payload);
    const boundary = '-------boundary-' + Date.now();
    const metadata = window.sync._fileId
      ? { mimeType: 'application/json' }
      : { name: DRIVE_FILE_NAME, mimeType: 'application/json', parents: ['appDataFolder'] };
    const method = window.sync._fileId ? 'PATCH' : 'POST';
    const url = window.sync._fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${window.sync._fileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const multipart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      body + `\r\n` +
      `--${boundary}--`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + window.sync._accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body: multipart
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const created = await res.json();
    if (!window.sync._fileId && created.id) window.sync._fileId = created.id;
    window.sync.lastSyncedAt = Date.now();
    localStorage.setItem(LS_LAST_SYNC, String(window.sync.lastSyncedAt));
    window.sync.lastError = '';
  } finally {
    window.sync.syncing = false;
    notifyState();
  }
}

// Alpine component that renders the sign-in card on the Sync page. It mirrors
// window.sync's fields for reactivity and listens for 'sync-state-changed'
// events so buttons and labels stay live without polling.
function syncPanel() {
  return {
    ready: false,
    hasDefaultClientId: false,
    signedIn: false,
    userEmail: '',
    lastSyncedAt: null,
    lastError: '',
    syncing: false,
    pendingUpload: false,

    async init() {
      await initSync();
      this._read();
      window.addEventListener('sync-state-changed', () => this._read());
    },

    _read() {
      this.ready              = window.sync.ready;
      this.hasDefaultClientId = window.sync.hasDefaultClientId;
      this.signedIn           = window.sync.signedIn;
      this.userEmail          = window.sync.userEmail;
      this.lastSyncedAt       = window.sync.lastSyncedAt;
      this.lastError          = window.sync.lastError;
      this.syncing            = window.sync.syncing;
      this.pendingUpload      = window.sync.pendingUpload;
    },

    async signIn()  { await gSignIn().catch(() => {}); },
    signOut()       { gSignOut(); },
    async syncNow() { await gReconcile().catch(() => {}); },

    formatTime(ms) {
      if (!ms) return 'never';
      const d = new Date(ms);
      return d.toLocaleString();
    }
  };
}

window.initSync = initSync;
window.gSignIn = signIn;
window.gSignOut = signOut;
window.gUploadNow = uploadNow;
window.gReconcile = reconcile;
window.gBuildSyncPayload = buildPayload;
window.gHydrateFromPayload = hydrateFromPayload;
window.syncPanel = syncPanel;
