/**
 * Resolves which electron.exe to launch.
 *
 * IMPORTANT (Windows hardened environments): launching Chromium windows from
 * executables inside a "Downloads" folder is blocked by some security
 * suites — every BrowserWindow dies with 0xC0000005 before painting
 * (verified on real hardware; the same binary runs fine from
 * %LOCALAPPDATA%\Programs). If the project itself lives under Downloads,
 * we provision a copy of node_modules/electron/dist outside of it — once,
 * version-marked — and launch that. Packaged/installed apps are unaffected
 * (they are installed to %LOCALAPPDATA%\Programs or Program Files).
 */

const fs = require('fs');
const path = require('path');

const LOCAL_COPY_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
  'Programs',
  'runora-electron'
);

// One-time cleanup of the pre-rebrand provisioning folder (anki2-fsrs-electron),
// so no orphaned copy of the binary is left behind.
const LEGACY_COPY_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
  'Programs',
  'anki2-fsrs-electron'
);
try {
  if (fs.existsSync(LEGACY_COPY_DIR)) fs.rmSync(LEGACY_COPY_DIR, { recursive: true, force: true });
} catch {
  /* best-effort cleanup */
}

function isHostileLocation(dir) {
  // Downloads/Temp/Desktop: security suites on some Windows machines block
  // unsigned executables launched from user-writable folders — every
  // BrowserWindow dies or hangs before painting. Verified: the same binary
  // runs fine from %LOCALAPPDATA%\Programs.
  return /downloads|temp|desktop/i.test(dir);
}

/** @returns {Promise<string>} path to a usable electron.exe */
async function resolveElectronExe() {
  if (process.env.ELECTRON_EXE) return process.env.ELECTRON_EXE;

  const localDist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
  const exe = path.join(localDist, 'electron.exe');
  if (!isHostileLocation(path.normalize(__dirname))) return exe;

  const localVersion = require(path.join(
    __dirname,
    '..',
    'node_modules',
    'electron',
    'package.json'
  )).version;
  const marker = path.join(LOCAL_COPY_DIR, '.version');
  if (
    !fs.existsSync(path.join(LOCAL_COPY_DIR, 'electron.exe')) ||
    !fs.existsSync(marker) ||
    fs.readFileSync(marker, 'utf8').trim() !== localVersion
  ) {
    fs.rmSync(LOCAL_COPY_DIR, { recursive: true, force: true });
    fs.cpSync(localDist, LOCAL_COPY_DIR, { recursive: true });
    fs.writeFileSync(marker, localVersion);
  }
  return path.join(LOCAL_COPY_DIR, 'electron.exe');
}

module.exports = { resolveElectronExe, isHostileLocation, LOCAL_COPY_DIR };
