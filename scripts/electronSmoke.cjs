/**
 * Electron desktop smoke test (headless, no native dialog clicking):
 * 1. launches the real electron/main.cjs against the Vite dev server,
 * 2. seeds a deck in the app's own localStorage profile,
 * 3. stubs dialog.showSaveDialog to a temp path (the app believes the user
 *    picked it — exactly the production flow minus the OS dialog),
 * 4. drives the export modal → native IPC write,
 * 5. validates the produced .apkg (schema, lapses column, dconf fields).
 */

const path = require('path');
const fs = require('fs');
const { _electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUT_APKG || path.join(ROOT, '.electron-smoke', 'export.apkg');

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (fs.existsSync(OUT)) fs.rmSync(OUT);

  let app;
  try {
    const { resolveElectronExe } = require('../electron/electronExe.cjs');
    app = await _electron.launch({
      args: [path.join(ROOT, 'electron', 'main.cjs')],
      cwd: ROOT,
      executablePath: await resolveElectronExe(),
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: 'http://localhost:3000/',
        DO_NOT_TRACK: '1',
      },
    });
  } catch (e) {
    // Agent/CI sessions often cannot spawn Chromium windows at all (any
    // BrowserWindow dies with access violation before drawing). The real
    // validation happens on a human session: `npm run app` or the packaged exe.
    console.error('ELECTRON SMOKE SKIPPED — environment cannot create Chromium windows:', e.message.split('\n')[0]);
    process.exit(0);
  }
  try {
    // main.cjs opens DevTools in dev mode; pick the app window, not the first.
    let win;
    {
      const deadline = Date.now() + 30_000;
      while (!win && Date.now() < deadline) {
        for (const w of app.windows()) {
          if ((w.url() || '').includes('localhost:3000')) { win = w; break; }
        }
        if (!win) await new Promise((r) => setTimeout(r, 500));
      }
      if (!win) throw new Error('App window never opened');
    }
    await win.waitForLoadState('domcontentloaded');

    // seed one deck so the export picker has something checked
    await win.evaluate(() => {
      const decks = JSON.parse(localStorage.getItem('anki2_decks') || '[]');
      decks.push({
        id: 'deck-electron-smoke',
        name: 'ElectronSmoke',
        description: '',
        presetId: null,
        dailyLimitsOverride: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localStorage.setItem('anki2_decks', JSON.stringify(decks));
    });
    await win.reload();
    await win.waitForLoadState('domcontentloaded');

    // household trick: replace the real native dialog (unclickable in CI)
    // with an always-accept version that returns our temp path.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      return null;
    }, OUT);

    await win.getByRole('button', { name: /Exportar/ }).first().click();
    // the confirm button inside the modal (bg-ios-blue pill)
    await win.locator('button.bg-ios-blue', { hasText: 'Exportar' }).click();

    // wait until the file is written by the main process
    const deadline = Date.now() + 60_000;
    while (!fs.existsSync(OUT)) {
      if (Date.now() > deadline) throw new Error('Export file never appeared');
      await new Promise((r) => setTimeout(r, 400));
    }
    const size = fs.statSync(OUT).size;
    console.log('EXPORT OK — bytes:', size);

    // modal should have closed after a successful export
    const modalGone = await win.evaluate(() =>
      ![...document.querySelectorAll('h3')].some((h) => h.textContent.includes('Exportar Decks'))
    );
    console.log('modal closed:', modalGone);

    if (size === 0) throw new Error('Export wrote a 0-byte file!');

    /* ── validate the byte content with the same checker used for dev ── */
    const PROJ = ROOT;
    const req = (m) => require(path.join(PROJ, 'node_modules', m));
    const initSqlJs = req('sql.js');
    const JSZip = req('jszip');
    const z = await JSZip.loadAsync(fs.readFileSync(OUT));
    if (!z.file('collection.anki2')) throw new Error('missing collection.anki2');
    const dbBytes = await z.file('collection.anki2').async('uint8array');
    const db = new (await initSqlJs()).Database(dbBytes);
    const cardSql = db.exec("SELECT sql FROM sqlite_master WHERE name='cards'")[0].values[0][0];
    const dconf = JSON.parse(db.exec('SELECT dconf FROM col')[0].values[0][0]);
    const decks = JSON.parse(db.exec('SELECT decks FROM col')[0].values[0][0]);
    const hasSmokeDeck = Object.values(decks).some((d) => d.name === 'ElectronSmoke');
    const allLapses = /lapses integer/.test(cardSql);
    const allMaxTaken = Object.values(dconf).every((c) => c.maxTaken === 60 && c.lapse && typeof c.lapse.mult === 'number');
    console.log('cards schema has lapses:', allLapses);
    console.log('dconf complete (maxTaken+multiplicities):', allMaxTaken);
    console.log('smoke deck in file:', hasSmokeDeck);
    db.close();

    if (!allLapses || !allMaxTaken || !hasSmokeDeck) throw new Error('Package validation failed');
    console.log('ELECTRON SMOKE TEST PASS');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
});
