/**
 * Electron main process — Runora desktop shell.
 *
 * Two modes:
 * - dev:   VITE_DEV_SERVER_URL is set → loads the Vite dev server (full HMR,
 *          identical to the browser workflow the project already uses).
 * - prod:  loads the built dist/index.html from the packaged app.
 *
 * The renderer is the same React app; the only native capability we expose is
 * a sandboxed file bridge over IPC (below), which replaces the web File
 * System Access API (blocked in embedded Chromium contexts).
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';

// Keep dev and packaged builds on the same userData folder (app name),
// so Addons lands in %APPDATA%\Runora\Addons in both cases.
app.setName('Runora');

/** Fixed-candidate ports: localStorage is scoped by origin, so the port
 * must stay stable between runs or user data would "vanish". */
const DIST_PORTS = [39102, 39103, 39104, 39105];

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 420,
    minHeight: 640,
    title: 'Runora — FSRS Flashcards',
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // native window.open (browser-like popups, no node in child windows):
      // required for the Google Identity Services login popup used by Drive sync
      nativeWindowOpen: true,
    },
  });

  // Only the Google OAuth popup may open as a new window; block everything else
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/')) return { action: 'allow' };
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
    return win;
  }

  // Production: serve dist/ over a tiny local HTTP server instead of file://
  // (ES module CORS blocks file:// modules in base Chromium builds).
  const express = require('express');
  const net = require('net');
  const serve = express();
  serve.use(express.static(path.join(__dirname, '..', 'dist'), { extensions: ['html'] }));
  serve.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));

  const probe = (port) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      s.listen(port, '127.0.0.1');
    });

  bindServer(win, serve, probe);
  return win;
}

/** Binds the local server on the first free port (localStorage depends on a
 * stable origin, so default ports are fixed) and loads the app. */
async function bindServer(win, serve, probe) {
  const candidates = [...DIST_PORTS, ...Array.from({ length: 10 }, (_, i) => 39110 + i)];
  for (const port of candidates) {
    if (!(await probe(port))) continue;
    serve.listen(port, '127.0.0.1', () => {
      win.loadURL(`http://127.0.0.1:${port}/`);
    });
    return;
  }
  console.error('No free port found for the local app server');
}

/* ── native save bridge ──────────────────────────────────────────────── */

ipcMain.handle('desktop:pick-save-path', async (_e, suggestedName, extFilters) => {
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName,
    filters: extFilters || [],
  });
  return canceled || !filePath ? { canceled: true } : { canceled: false, path: filePath };
});

ipcMain.handle('desktop:write-file', async (_e, filePath, bytes) => {
  try {
    await fs.promises.writeFile(filePath, Buffer.from(bytes));
    return { saved: true };
  } catch (err) {
    return { saved: false, error: String((err && err.message) || err) };
  }
});

/** Opens a native "choose folder" dialog (used e.g. to pick the addon export destination). */
ipcMain.handle('desktop:pick-directory', async (_e, title) => {
  const win = BrowserWindow.getAllWindows()[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: title || 'Escolher pasta',
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled || filePaths.length === 0 ? { canceled: true } : { canceled: false, path: filePaths[0] };
});

/* ── Addons folder bridge (rooted at userData/Addons) ─────────────────── */

function addonsRoot() {
  return path.join(app.getPath('userData'), 'Addons');
}

function safeAddonsPath(rel) {
  const root = addonsRoot();
  const clean = path.normalize(String(rel || '')).replace(/^(\.\.([/\\]|$))+/, '');
  const resolved = path.resolve(root, clean);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid addons path');
  }
  return resolved;
}

ipcMain.handle('desktop:addons-root', async () => {
  try {
    await fs.promises.mkdir(addonsRoot(), { recursive: true });
    return { ok: true, root: addonsRoot() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('desktop:addons-ensure', async () => {
  try {
    await fs.promises.mkdir(addonsRoot(), { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('desktop:addons-list', async () => {
  try {
    const root = addonsRoot();
    await fs.promises.mkdir(root, { recursive: true });
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return { ok: true, dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

async function walkFiles(dir, base, out) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) await walkFiles(full, rel, out);
    else out.push(rel);
  }
}

ipcMain.handle('desktop:addons-list-files', async (_e, rel) => {
  try {
    const root = safeAddonsPath(String(rel || ''));
    const out = [];
    await walkFiles(root, '', out);
    return { ok: true, files: out.sort() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('desktop:addons-exists', async (_e, rel) => {
  try {
    await fs.promises.access(safeAddonsPath(rel));
    return { ok: true, exists: true };
  } catch {
    return { ok: true, exists: false };
  }
});

ipcMain.handle('desktop:addons-read', async (_e, rel, encoding) => {
  try {
    const p = safeAddonsPath(rel);
    const buf = await fs.promises.readFile(p);
    const enc = encoding === 'base64' ? 'base64' : 'utf8';
    return { ok: true, found: true, encoding: enc, data: buf.toString(enc) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, found: false };
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('desktop:addons-write', async (_e, rel, encoding, data) => {
  try {
    const p = safeAddonsPath(rel);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const buf = encoding === 'base64' ? Buffer.from(String(data), 'base64') : Buffer.from(String(data), 'utf8');
    await fs.promises.writeFile(p, buf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('desktop:addons-remove', async (_e, rel) => {
  try {
    const p = safeAddonsPath(rel);
    await fs.promises.rm(p, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

app.whenReady().then(() => {
  // Create the Addons folder at startup so users can also drop addon folders
  // there manually, without using the Import button first.
  fs.promises
    .mkdir(addonsRoot(), { recursive: true })
    .then(() => console.log('[addons] folder ready:', addonsRoot()))
    .catch((err) => console.error('[addons] failed to create folder:', err));
  createWindow();
  app.on('activate', () => {
    // macOS: re-open a window when clicking the dock icon with no windows.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
