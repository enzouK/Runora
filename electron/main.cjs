/**
 * Electron main process — Anki 2.0 FSRS desktop shell.
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

/** Fixed-candidate ports: localStorage is scoped by origin, so the port
 * must stay stable between runs or user data would "vanish". */
const DIST_PORTS = [39102, 39103, 39104, 39105];

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 420,
    minHeight: 640,
    title: 'Anki 2.0 — FSRS Flashcards',
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    // macOS: re-open a window when clicking the dock icon with no windows.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
