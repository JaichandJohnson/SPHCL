// Google Drive backup via Google Identity Services (client-side)
// Requires REACT_APP_GOOGLE_CLIENT_ID env var.
// Supports one-time "Connect" that keeps a token in memory and localStorage-flag,
// silent token refresh, and automatic debounced sync after data mutations.

import { api } from "@/lib/api";

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const LS_CONNECTED = "sphcl_drive_connected";
const LS_FILE_ID = "sphcl_drive_file_id";
const LS_LAST_SYNC = "sphcl_drive_last_sync";
const BACKUP_FILENAME = "SPHCL_LabRecords_Backup.xlsx";
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let cachedToken = null;
let tokenExpiresAt = 0;
let tokenClient = null;
let syncTimer = null;
let listeners = new Set();

const now = () => Date.now();

export const isDriveConfigured = () => Boolean(CLIENT_ID);
export const isConnected = () =>
  Boolean(CLIENT_ID) && (localStorage.getItem(LS_CONNECTED) === "1");

export const getLastSync = () => {
  const v = localStorage.getItem(LS_LAST_SYNC);
  return v ? new Date(Number(v)) : null;
};

export const onSyncChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = (state) => listeners.forEach((fn) => { try { fn(state); } catch { /* noop */ } });

const loadGis = () =>
  new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      const iv = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(iv); resolve(); }
      }, 100);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.body.appendChild(s);
  });

const ensureTokenClient = async () => {
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => { /* set per-request */ },
    });
  }
  return tokenClient;
};

const requestToken = (interactive) =>
  new Promise(async (resolve, reject) => {
    if (!CLIENT_ID) return reject(new Error("Drive not configured"));
    if (cachedToken && now() < tokenExpiresAt - 30_000) return resolve(cachedToken);
    try {
      const client = await ensureTokenClient();
      client.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        cachedToken = resp.access_token;
        tokenExpiresAt = now() + (Number(resp.expires_in || 3600) * 1000);
        resolve(cachedToken);
      };
      client.requestAccessToken({ prompt: interactive ? "consent" : "" });
    } catch (e) { reject(e); }
  });

export const connectDrive = async () => {
  const token = await requestToken(true);
  localStorage.setItem(LS_CONNECTED, "1");
  emit({ connected: true });
  return token;
};

export const disconnectDrive = async () => {
  try {
    if (cachedToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(cachedToken, () => {});
    }
  } catch { /* noop */ }
  cachedToken = null;
  tokenExpiresAt = 0;
  localStorage.removeItem(LS_CONNECTED);
  localStorage.removeItem(LS_FILE_ID);
  emit({ connected: false });
};

const readBase64 = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

const buildMultipartBody = (metadata, base64Data, mimeType) => {
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const body =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n` +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    base64Data +
    closeDelim;
  return { body, headers: { "Content-Type": `multipart/related; boundary=${boundary}` } };
};

const driveFetch = async (url, opts) => {
  const token = await requestToken(false);
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Drive ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
};

// Upload arbitrary blob and return file metadata (creates new file)
export const uploadBlobToDrive = async (blob, filename, mimeType) => {
  if (!CLIENT_ID) throw new Error("Google Drive not configured");
  await requestToken(true); // interactive on first manual click
  const base64 = await readBase64(blob);
  const { body, headers } = buildMultipartBody({ name: filename, mimeType }, base64, mimeType);
  return driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    { method: "POST", headers, body }
  );
};

// Upsert the single backup file (create or overwrite content)
const upsertBackup = async (blob) => {
  const base64 = await readBase64(blob);
  const fileId = localStorage.getItem(LS_FILE_ID);
  if (fileId) {
    try {
      // Update existing file media
      await driveFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: "PATCH",
          headers: { "Content-Type": MIME },
          body: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
        }
      );
      return { id: fileId, updated: true };
    } catch (_e) {
      // fall through to create
      localStorage.removeItem(LS_FILE_ID);
    }
  }
  const { body, headers } = buildMultipartBody({ name: BACKUP_FILENAME, mimeType: MIME }, base64, MIME);
  const meta = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    { method: "POST", headers, body }
  );
  if (meta?.id) localStorage.setItem(LS_FILE_ID, meta.id);
  return { id: meta.id, updated: false };
};

// Fetch latest xlsx export from backend and upsert to Drive (single backup file)
const doSyncNow = async () => {
  emit({ syncing: true });
  const r = await api.get("/export", { params: { format: "xlsx" }, responseType: "blob" });
  await upsertBackup(r.data);
  localStorage.setItem(LS_LAST_SYNC, String(now()));
  emit({ syncing: false, lastSync: new Date() });
};

export const syncNow = async () => {
  if (!isConnected()) throw new Error("Drive not connected");
  await doSyncNow();
};

// Debounced auto-sync — call after any mutation
export const scheduleDriveSync = (delayMs = 5000) => {
  if (!isConnected()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    doSyncNow().catch((e) => {
      // On silent failure (e.g., token needs consent), mark not-syncing; keep connected flag
      emit({ syncing: false, error: e.message });
    });
  }, delayMs);
};
