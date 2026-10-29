/**
 * AnkiApkgExportService — writes a real Anki Deck Package (.apkg).
 *
 * Format choice: the legacy "collection.anki2" layout — a ZIP with a SQLite
 * database (schema 11: note types/decks/options stored as JSON inside `col`),
 * a `media` JSON index, and media files as "0","1","2",... entries.
 *
 * Why legacy instead of the modern collection.anki21b: the legacy shape needs
 * nothing beyond the SQLite we already use (our importer parses it too, so
 * this file is the mirror image of that code), it imports in every Anki
 * client ever released (desktop 2.0→25.x, AnkiDroid, AnkiMobile, AnkiWeb) and
 * current Anki upgrades it internally on import. anki21b would additionally
 * require a zstd *compressor* (we only ship decompression) plus protobuf
 * encoders, with no benefit besides file size.
 */

import JSZip from 'jszip';
import initSqlJs from 'sql.js';
// sql.js ships a wasm binary; Vite serves it as an asset URL
// @ts-ignore - vite/client provides '?url' module typing
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Card, Deck, Note, NoteType, Preset } from '../types/anki';
import { StorageService } from './storage';
import { MediaStore } from './mediaStore';
import { ExportImportService, type CollectionExportOptions } from './exportImport';

/** U+001F — Anki's field separator inside notes.flds */
const FIELD_SEP = '\u001f';

/** Legacy schema 11 — straight from Anki's legacy exporter. */
const LEGACY_SCHEMA = `
CREATE TABLE col (
    id integer primary key,
    crt integer not null,
    mod integer not null,
    scm integer not null,
    ver integer not null,
    dty integer not null,
    usn integer not null,
    ls integer not null,
    conf text not null,
    models text not null,
    decks text not null,
    dconf text not null,
    tags text not null);
CREATE TABLE notes (
    id integer primary key,
    guid text not null,
    mid integer not null,
    mod integer not null,
    usn integer not null,
    tags text not null,
    flds text not null,
    sfld integer not null,
    csum integer not null,
    flags integer not null,
    data text not null);
CREATE TABLE cards (
    id integer primary key,
    nid integer not null,
    did integer not null,
    ord integer not null,
    mod integer not null,
    usn integer not null,
    type integer not null,
    queue integer not null,
    due integer not null,
    ivl integer not null,
    factor integer not null,
    reps integer not null,
    lapses integer not null,
    [left] integer not null,
    odue integer not null,
    odid integer not null,
    flags integer not null,
    data text not null);
CREATE TABLE revlog (
    id integer primary key,
    cid integer not null,
    usn integer not null,
    ease integer not null,
    ivl integer not null,
    lastIvl integer not null,
    factor integer not null,
    time integer not null,
    type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_cards_nid_ord on cards (nid, ord);
`;

/* ── helpers ─────────────────────────────────────────────────────────── */

/** FNV-1a 32-bit — stable hash over string ids (deterministic across re-exports). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable base-91 guid — Anki merges notes by guid, so it must be deterministic. */
const GUID_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+,-./:;<=>?@[]^_`{|}~';
function stableGuid(seed: string): string {
  const a = BigInt(fnv1a('guid-a:' + seed));
  const b = BigInt(fnv1a('guid-b:' + seed));
  let n = ((a << 32n) | b) & 0x7fffffffffffffffn;
  let out = '';
  while (n > 0n) {
    out += GUID_ALPHABET[Number(n % BigInt(GUID_ALPHABET.length))];
    n /= BigInt(GUID_ALPHABET.length);
  }
  return out || '0';
}

function stripHtml(html: string): string {
  // <div>/<br> → newline keeps the sort field readable; everything else unwrapped
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|h[1-6]|li)>/gi, '\n');
  const el = document.createElement('div');
  el.innerHTML = text;
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

async function sha1Csum(text: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return parseInt(hex.slice(0, 8), 16);
}

/**
 * One assigned numeric Anki id per string id. Deterministic from the string
 * (same re-export → same ids, so Anki merges/updates instead of duplicating),
 * with collision resolution so each id is unique within the file.
 */
class AnkiIdAllocator {
  private used = new Set<number>();
  private memo = new Map<string, number>();
  forString(str: string): number {
    const cached = this.memo.get(str);
    if (cached !== undefined) return cached;
    let id = 100 + (fnv1a(str) % 999_999_900);
    while (this.used.has(id)) id++;
    this.used.add(id);
    this.memo.set(str, id);
    return id;
  }
}

/* ── the exporter ────────────────────────────────────────────────────── */

type DeckConfigJson = {
  id: number;
  name: string;
  mod: number;
  usn: number;
  maxIvl: number;
  maxTaken: number;
  dyn: boolean;
  autoplay: boolean;
  timer: number;
  replayq: boolean;
  new: { bury: boolean; delays: number[]; initialFactor: number; perDay: number; order: number; separate: boolean; ints: number[] };
  rev: { bury: boolean; ease4: number; fuzz: number; ivlFct: number; maxIvl: number; minSpace: number; perDay: number };
  lapse: { delays: number[]; leechAction: number; leechFails: number; minInt: number; mult: number };
  fsrsParams5?: number[];
};

export class AnkiApkgExportService {
  /**
   * Builds the full .apkg zip in memory (see exportDeckPackage for the
   * option semantics). Returns blob + suggested file name so the caller can
   * save it wherever it wants (save picker, downloads folder, etc).
   */
  public static async buildDeckPackage(
    options?: CollectionExportOptions
  ): Promise<{ blob: Blob; filename: string }> {
    const subset = ExportImportService.collectExportedSubset(options);
    const { decks, noteTypes, notes, cards, revlog } = subset;

    const includeScheduling = options?.includeScheduling !== false;

    /* ── numeric id allocators (deterministic on our stable string ids) ── */
    const deckIds = new AnkiIdAllocator();
    const modelIds = new AnkiIdAllocator();
    const dconfIds = new AnkiIdAllocator();
    const noteIds = new AnkiIdAllocator();
    const cardIds = new AnkiIdAllocator();

    const deckNumeric = new Map<string, number>(); // our deck id → Anki did
    for (const d of decks) deckNumeric.set(d.id, deckIds.forString(`deck:${d.id}`));
    const modelNumeric = new Map<string, number>(); // our noteTypeId → Anki mid
    for (const nt of noteTypes) modelNumeric.set(nt.id, modelIds.forString(`model:${nt.id}`));

    /* ── collection creation time = start of the current study day ── */
    const rolloverHour = StorageService.getRolloverHour();
    const now = new Date();
    const crtMs = (() => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rolloverHour, 0, 0, 0);
      if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
      return d.getTime();
    })();
    const crtSec = Math.floor(crtMs / 1000);
    const modSec = Math.floor(Date.now() / 1000);

    /* ── note types → models JSON ── */
    const models: Record<string, object> = {};
    for (const nt of noteTypes) {
      const mid = modelNumeric.get(nt.id)!;
      const fieldNames = nt.fields.map((f) => f.name);

      // req: which fields each template needs to generate a non-empty card.
      // "any" (mode 0) over the fields referenced by the question template.
      const req = nt.templates.map((t) => {
        const used = new Set<number>();
        for (const m of t.qfmt.matchAll(/\{\{([^}]+)\}\}/g)) {
          let token = m[1].trim();
          if (token.startsWith('#') || token.startsWith('/')) continue; // section start/end
          if (/^cloze:/i.test(token)) token = token.slice(6).trim();
          else token = token.replace(/^(?:type|hint|tts|text|audio|image)s?:/i, '').trim();
          const idx = fieldNames.indexOf(token);
          if (idx >= 0) used.add(idx);
        }
        return [t.ord, 0, used.size > 0 ? [...used] : [0]];
      });

      models[String(mid)] = {
        id: mid,
        name: nt.name,
        type: nt.isCloze ? 1 : 0,
        mod: modSec,
        usn: -1,
        sortf: 0,
        did: null,
        tmpls: nt.templates.map((t) => ({
          name: t.name,
          ord: t.ord,
          qfmt: t.qfmt,
          afmt: t.afmt,
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        })),
        flds: nt.fields.map((f, i) => ({
          name: f.name,
          ord: i,
          font: 'Arial',
          media: [],
          size: 20,
          sticky: false,
          rtl: false,
          plainText: false,
          description: '',
        })),
        css:
          nt.css ||
          '.card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n',
        latexPre:
          '<div class=latex>\n\\documentclass[12pt]{article}\n\\special{papersize=3in - 5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}\n</div>',
        latexsvg: false,
        req,
        tags: [],
        vers: [],
      };
    }
    const firstMid = noteTypes.length > 0 ? modelNumeric.get(noteTypes[0].id)! : 1592329216000;

    /* ── presets/anexos → dconf entries ── */
    const fsrsParams = StorageService.getFSRSSettings();
    const dconf: Record<string, DeckConfigJson> = {
      // group 1 is always present (Anki's built-in default)
      '1': {
        id: 1,
        name: 'Default',
        mod: modSec,
        usn: -1,
        maxIvl: fsrsParams.maximumInterval,
        maxTaken: 60,
        dyn: false,
        autoplay: true,
        timer: 0,
        replayq: true,
        new: { bury: true, delays: [1, 10], initialFactor: 2500, perDay: 20, order: 1, separate: true, ints: [1, 3, 7] },
        rev: {
          bury: false,
          ease4: 2.5,
          fuzz: fsrsParams.enableFuzz ? 0.05 : 0,
          ivlFct: 1,
          maxIvl: fsrsParams.maximumInterval,
          minSpace: 1,
          perDay: 200,
        },
        lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      },
    };
    // preset id → dconf number (only when includePresets is on)
    const presetConfNumeric = new Map<string, number>();
    if (subset.presets) {
      for (const p of subset.presets) {
        const id = dconfIds.forString(`dconf:${p.id}`);
        dconf[String(id)] = {
          id,
          name: p.name,
          mod: modSec,
          usn: -1,
          maxIvl: p.fsrsParams.maximumInterval,
          maxTaken: 60,
          dyn: false,
          autoplay: p.audioConfig.disableAutoplay ? false : true,
          timer: 0,
          replayq: true,
          new: {
            bury: true,
            delays: stepsOf(p.schedulerConfig.learningSteps),
            initialFactor: 2500,
            perDay: p.dailyLimits.newCardsPerDay,
            order: p.schedulerConfig.insertionOrder === 'random' ? 2 : 1,
            separate: true,
            ints: [1, 3, 7],
          },
          rev: {
            bury: false,
            ease4: 2.5,
            fuzz: fsrsParams.enableFuzz ? 0.05 : 0,
            ivlFct: 1,
            maxIvl: p.fsrsParams.maximumInterval,
            minSpace: 1,
            perDay: p.dailyLimits.maxReviewsPerDay,
          },
          lapse: {
            delays: p.schedulerConfig.relearningSteps ? stepsOf(p.schedulerConfig.relearningSteps) : [],
            leechAction: p.schedulerConfig.leechAction === 'tag' ? 1 : 0, // 0 suspend, 1 tag
            leechFails: p.schedulerConfig.leechThreshold,
            minInt: 1,
            mult: 0,
          },
          // Best-effort FSRS weights for modern Anki (safely ignored by
          // importers that don't understand them).
          fsrsParams5: fsrsParams.w,
        };
        presetConfNumeric.set(p.id, id);
      }
    }

    /* ── decks JSON (+ pseudo "Default") ── */
    const decksJson: Record<string, object> = {
      '1': this.mkLegacyDeck(1, 'Default', modSec),
    };
    for (const d of decks) {
      const did = deckNumeric.get(d.id)!;
      const stub = {
        ...this.mkLegacyDeck(did, d.name, modSec),
        desc: d.description || '',
      };
      if (d.dailyLimitsOverride) {
        // per-deck overrides get their own config group cloned from the preset
        const baseKey = d.presetId && presetConfNumeric.has(d.presetId) ? String(presetConfNumeric.get(d.presetId)) : '1';
        const clone = JSON.parse(JSON.stringify(dconf[baseKey])) as DeckConfigJson;
        const id = dconfIds.forString(`dconf-deck:${d.id}`);
        clone.id = id;
        clone.name = `${d.name} (ajustes)`;
        clone.new.perDay = d.dailyLimitsOverride.newCardsPerDay;
        clone.rev.perDay = d.dailyLimitsOverride.maxReviewsPerDay;
        dconf[String(id)] = clone;
        stub.conf = id;
      } else {
        stub.conf =
          d.presetId && subset.presets && presetConfNumeric.has(d.presetId)
            ? presetConfNumeric.get(d.presetId)!
            : 1;
      }
      decksJson[String(did)] = stub;
    }

    /* ── notes rows ── */
    type NoteRow = [number, string, number, number, number, string, string, string, number, number, string];
    const noteRows = new Map<string, NoteRow>(); // our note id → row
    for (const n of notes) {
      const mid = modelNumeric.get(n.noteTypeId);
      if (mid === undefined) continue; // note type not in the subset — skip
      const id = noteIds.forString(`note:${n.id}`);
      const nt = noteTypes.find((t) => t.id === n.noteTypeId)!;
      const flds = nt.fields.map((f) => n.fields[f.name] ?? '');
      const sfld = stripHtml(flds[0] || '');
      noteRows.set(n.id, [
        id,
        stableGuid(n.id),
        mid,
        Math.floor((n.updatedAt || Date.now()) / 1000),
        -1,
        (n.tags || []).join(' '),
        flds.join(FIELD_SEP),
        sfld,
        await sha1Csum(sfld),
        0,
        '',
      ]);
    }

    /* ── cards rows ── */
    type CardRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, string];
    const cardRows: CardRow[] = [];
    const newPositions = new Map<number, Set<number>>(); // did → used queue slots
    const nextNewPosition = (did: number, preferred?: number): number => {
      let set = newPositions.get(did);
      if (!set) {
        set = new Set();
        newPositions.set(did, set);
      }
      let pos = Math.max(1, Math.round(preferred ?? 0));
      while (set.has(pos)) pos++;
      set.add(pos);
      return pos;
    };

    for (const c of cards) {
      const nid = noteRows.get(c.noteId)?.[0];
      const did = deckNumeric.get(c.deckId);
      if (nid === undefined || did === undefined) continue; // dangling reference — skip

      const fs = c.fsrs as Card['fsrs'] | undefined;
      const state = (fs?.state ?? 0) as 0 | 1 | 2 | 3;
      const suspended = includeScheduling && !!c.suspended;

      let type = 0, queue = 0, due = 0, ivl = 0, factor = 0, left = 0;
      if (!includeScheduling) {
        // Anki's own "no scheduling" export: everything comes back as new
        type = 0;
        queue = 0;
        due = nextNewPosition(did, c.position);
      } else if (state === 2) {
        // review: due is a day index since the collection creation date
        type = 2;
        queue = suspended ? -1 : 2;
        ivl = Math.max(1, Math.round(fs?.scheduledDays || fs?.stability || 1));
        due = Math.floor((c.due - crtMs) / 86_400_000);
        factor = 2500;
      } else if (state === 1 || state === 3) {
        // learning/relearning: intraday due in epoch seconds, day-learning as day index
        type = state;
        const eff = StorageService.getEffectiveSchedulerConfig(c.deckId);
        const steps = state === 1 ? eff.learningSteps : eff.relearningSteps;
        left = Math.max(1000, (steps.length - Math.max(0, Math.round(c.learningStep ?? 0))) * 1000);
        if (c.due - Date.now() > 86_400_000) {
          queue = 3; // day learning
          due = Math.floor((c.due - crtMs) / 86_400_000);
          ivl = Math.max(1, Math.round(fs?.scheduledDays || 1));
        } else {
          queue = 1;
          due = Math.floor(Math.max(c.due, Date.now() + 30_000) / 1000);
        }
        if (suspended) queue = -1;
      } else {
        // new
        type = 0;
        queue = suspended ? -1 : 0;
        due = nextNewPosition(did, c.position);
      }

      cardRows.push([
        cardIds.forString(`card:${c.id}`),
        nid,
        did,
        Math.max(0, Math.round(c.templateOrd ?? 0)),
        modSec,
        -1,
        type,
        queue,
        due,
        ivl,
        factor,
        Math.round(fs?.reps ?? 0),
        Math.round(fs?.lapses ?? 0),
        left,
        0, // odue
        0, // odid
        0, // flags
        '',
      ]);
    }

    /* ── revlog rows (only when scheduling info is on) ── */
    type RevlogRow = [number, number, number, number, number, number, number, number, number];
    const revlogRows: RevlogRow[] = [];
    if (includeScheduling) {
      for (const r of revlog) {
        const cid = cardIds.forString(`card:${r.cardId}`);
        // Anki type: 0 learn, 1 review, 2 relearn, 3 cram
        const type = r.state === 2 ? 1 : r.state === 3 ? 2 : 0;
        revlogRows.push([
          Math.round(r.reviewTime || Date.now()),
          cid,
          -1,
          Math.max(1, Math.round(r.rating || 3)),
          Math.max(0, Math.round(r.scheduledDays ?? 0)),
          Math.max(0, Math.round(r.elapsedDays ?? 0)),
          2500, // legacy ease column (FSRS intervals live in ivl)
          0, // duration ms — not tracked by our FSRS history
          type,
        ]);
      }
    }

    /* ── collection conf ── */
    const colConf = {
      nextPos: 1,
      estTimes: true,
      activeDecks: [1],
      sortType: 'noteFld',
      timeLim: 0,
      sortBackwards: false,
      addToCur: true,
      curDeck: 1,
      newBury: true,
      newSpread: 0,
      dueCounts: true,
      curModel: String(firstMid),
      collapseTime: 1200,
    };

    /* ── write the SQLite database ── */
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const db = new SQL.Database();
    db.run(LEGACY_SCHEMA);
    db.run(
      'INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        1,
        crtSec,
        modSec,
        modSec,
        11,
        0,
        -1,
        0,
        JSON.stringify(colConf),
        JSON.stringify(models),
        JSON.stringify(decksJson),
        JSON.stringify(dconf),
        '{}',
      ]
    );
    for (const row of noteRows.values()) {
      db.run(
        'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        row
      );
    }
    for (const row of cardRows) {
      db.run(
        'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, [left], odue, odid, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        row
      );
    }
    for (const row of revlogRows) {
      db.run(
        'INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?,?,?,?,?,?,?,?,?)',
        row
      );
    }
    const dbBytes: Uint8Array = db.export();
    db.close();

    /* ── media + zip ── */
    const zip = new JSZip();
    zip.file('collection.anki2', dbBytes);

    const mediaMap: Record<string, string> = {};
    if (options?.includeMedia !== false) {
      let mediaIndex = 0;
      // Media is referenced by FILE NAME inside field text (Anki parity):
      // [sound:x.mp3], <img src="x.png"> — plus our native note.media attachments.
      const names = new Set(
        notes.flatMap((n) => (Array.isArray(n.media) ? n.media : [])).map((m) => m.name)
      );
      for (const n of notes) {
        const text = Object.values(n.fields || {}).join('\n');
        for (const m of text.matchAll(/\[sound:([^\]]+)\]/g)) names.add(m[1].trim());
        for (const m of text.matchAll(/<img\s+[^>]*?src=(["'])([^"']+)\1/gi)) names.add(m[2].trim());
      }
      for (const name of names) {
        if (!name) continue;
        const blob = await MediaStore.get(name);
        if (!blob) continue;
        mediaMap[String(mediaIndex)] = name;
        zip.file(String(mediaIndex), blob);
        mediaIndex++;
      }
    }
    zip.file('media', JSON.stringify(mediaMap));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return { blob: zipBlob, filename: `${this.pickFileName(options)}.apkg` };
  }

  /** Exports the .apkg (see buildDeckPackage) straight to the downloads folder. */
  public static async exportDeckPackage(options?: CollectionExportOptions): Promise<void> {
    const { blob, filename } = await this.buildDeckPackage(options);
    ExportImportService.downloadBlob(blob, filename);
  }

  /** Anki deck JSON stub (legacy schema 11). */
  private static mkLegacyDeck(id: number, name: string, modSec: number) {
    return {
      id,
      name,
      mod: modSec,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: '',
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    };
  }

  /** File name: one selected top-level tree → its root name; one deck → itself; else "collection". */
  public static pickFileName(options?: CollectionExportOptions): string {
    const all = StorageService.getDecks();
    const selected = (options?.deckIds ?? [])
      .map((id) => all.find((d) => d.id === id)?.name)
      .filter(Boolean) as string[];
    const roots = new Set(selected.map((n) => n.split('::')[0]));
    const base =
      selected.length === 1
        ? selected[0].split('::').pop()!
        : roots.size === 1
        ? [...roots][0]
        : 'collection';
    return base.replace(/[/\\:*?"<>|]/g, '_') || 'collection';
  }
}

/** "1m 10m" → [1, 10]; supports m (default), s and h. */
function stepsOf(steps: string | null | undefined): number[] {
  if (!steps) return [];
  const out: number[] = [];
  for (const tok of steps.trim().split(/\s+/)) {
    const m = /^(\d+(?:\.\d+)?)\s*([smh]?)$/i.exec(tok);
    if (!m) continue;
    const v = parseFloat(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    out.push(Math.round(v * (unit === 'h' ? 60 : unit === 's' ? 1 / 60 : 1)));
  }
  return out.length > 0 ? out : [1, 10];
}
