/**
 * Desktop dev runner — Chrome-free equivalent of `npm run dev` for the
 * Electron shell: starts the Vite dev server, waits for it to answer, then
 * launches the Electron app pointed at it (full HMR, same as the browser).
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const URL_TO_POLL = 'http://localhost:3000/';

function isUp() {
  return new Promise((resolve) => {
    const req = http.get(URL_TO_POLL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitUntilUp() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (await isUp()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  // If a dev server is already answering, reuse it (two shells, one session).
  const serverAlreadyUp = await isUp();
  const vite = serverAlreadyUp
    ? null
    : spawn(/^win/i.test(process.platform) ? 'npm.cmd' : 'npm', ['run', 'dev'], {
        stdio: 'inherit',
        shell: false,
      });

  if (!(await waitUntilUp())) {
    console.error('Dev server did not come up on :' + new URL(URL_TO_POLL).port);
    vite?.kill();
    process.exit(1);
  }

  const electronExe = await require('./electronExe.cjs').resolveElectronExe();

  const electron = spawn(electronExe, ['electron/main.cjs'], {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, VITE_DEV_SERVER_URL: URL_TO_POLL, ELECTRON_START_URL: URL_TO_POLL },
  });

  electron.on('exit', () => {
    vite?.kill();
    process.exit(0);
  });
  vite?.on('exit', () => {
    electron.kill();
    process.exit(0);
  });
})();
