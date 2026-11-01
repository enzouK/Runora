import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { decompress as zstdDecompress } from 'fzstd';
// sql.js ships a wasm binary; Vite serves it as an asset URL
// @ts-ignore - vite/client provides '?url' module typing
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Card, Deck, FSRSParameters, Note, NoteType, Preset, RevlogEntry } from '../types/runora';
import { StorageService } from './storage';
import { MediaStore } from './mediaStore';

export interface RunoraCollectionExport {
  version: string;
  runora_compatible: boolean;
  exportedAt: number;
  fsrsParameters: FSRSParameters;
  decks: Deck[];
  /**
   * Option presets (optional for backwards compatibility with older backups —
   * decks without their preset in the file fall back to the factory preset).
   */
  presets?: Preset[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

export interface CollectionExportOptions {
  /** Deck ids to export; each deck brings its subdecks along. Omit = whole collection. */
  deckIds?: string[];
  /** "Include Scheduling Information": keeps the review history (revlog). */
  includeScheduling?: boolean;
  /** "Include Deck Presets": keeps the option presets used by the decks. */
  includePresets?: boolean;
  /** "Include Media": brings the media files referenced by the notes. */
  includeMedia?: boolean;
}

export interface ExportedSubset {
  isPartial: boolean;
  decks: Deck[];
  presets?: Preset[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

export class ExportImportService {
  /**
   * Collects the data subset to export: the selected decks (plus their
   * subdecks) and only the notes/cards, note types, review history and
   * presets that belong to them. Omitting deckIds = whole collection
   * (backwards-compatible full export).
   */
  public static collectExportedSubset(options?: CollectionExportOptions): ExportedSubset {
    const deckIds = options?.deckIds;
    const isPartial = !!deckIds && deckIds.length > 0;

    if (!isPartial) {
      return {
        isPartial: false,
        decks: StorageService.getDecks(),
        presets: StorageService.getPresets(),
        noteTypes: StorageService.getNoteTypes(),
        notes: StorageService.getNotes(),
        cards: StorageService.getCards(),
        revlog: StorageService.getRevlog(),
      };
    }

    // Partial export: selected decks + their subdecks
    const allDecks = StorageService.getDecks();
    const selectedNames = new Set(
      deckIds!.map((id) => allDecks.find((d) => d.id === id)?.name).filter(Boolean) as string[]
    );
    const selectedIds = new Set(
      allDecks
        .filter(
          (d) =>
            deckIds!.includes(d.id) ||
            selectedNames.has(d.name) ||
            (selectedNames.size > 0 && Array.from(selectedNames).some((n) => d.name.startsWith(`${n}::`)))
        )
        .map((d) => d.id)
    );
    const decks = allDecks.filter((d) => selectedIds.has(d.id));
    const cards = StorageService.getCards().filter((c) => selectedIds.has(c.deckId));
    const noteIds = new Set(cards.map((c) => c.noteId));
    const notes = StorageService.getNotes().filter((n) => noteIds.has(n.id));
    const usedTypeIds = new Set(notes.map((n) => n.noteTypeId));
    const noteTypes = StorageService.getNoteTypes().filter((t) => usedTypeIds.has(t.id));
    const includedCardIds = new Set(cards.map((c) => c.id));
    const revlog =
      options?.includeScheduling === false
        ? []
        : StorageService.getRevlog().filter((e) => includedCardIds.has(e.cardId));
    const presets =
      options?.includePresets === false
        ? undefined
        : StorageService.getPresets().filter((p) => decks.some((d) => d.presetId === p.id));

    return { isPartial: true, decks, presets, noteTypes, notes, cards, revlog };
  }

  /**
   * Exports the collection as a .colpkg ZIP. By default exports everything;
   * passing deckIds exports only those decks (plus their subdecks), notes,
   * cards, the note types they use and — per the option flags — their presets,
   * review history and media.
   */
  public static async buildCollectionPackage(
    options?: CollectionExportOptions
  ): Promise<{ blob: Blob; filename: string }> {
    const subset = this.collectExportedSubset(options);
    const isPartial = subset.isPartial;

    const exportData: RunoraCollectionExport = {
      version: 'Runora-FSRS-v1',
      runora_compatible: true,
      exportedAt: Date.now(),
      fsrsParameters: StorageService.getFSRSSettings(),
      decks: subset.decks,
      presets: subset.presets,
      noteTypes: subset.noteTypes,
      notes: subset.notes,
      cards: subset.cards,
      revlog: subset.revlog,
    };
    const exportNotes = subset.notes;
    const includeAllMedia = !isPartial;

    const zip = new JSZip();
    zip.file(
      'collection.runora.json',
      JSON.stringify(
        isPartial ? { ...exportData, version: 'Runora-FSRS-v1-partial' } : exportData,
        null,
        2
      )
    );
    zip.file('media.json', JSON.stringify({}));
    zip.file(
      'README.txt',
      isPartial
        ? 'Partial export from Runora (selected decks) with FSRS parameters and optional review history/presets/media.'
        : 'Exported from Runora with full FSRS algorithm parameters and review history.'
    );

    // Full export: every stored media file. Partial: only media referenced by
    // the exported notes (skipped entirely when "Include Media" is off).
    const mediaNames =
      includeAllMedia || (isPartial && options?.includeMedia !== false)
        ? includeAllMedia
          ? await MediaStore.list()
          : Array.from(
              new Set(exportNotes.flatMap((n) => (Array.isArray(n.media) ? n.media : [])).map((m) => m.name))
            )
        : [];
    const mediaMap: Record<string, string> = {};
    let mediaIndex = 0;
    for (const name of mediaNames) {
      const blob = await MediaStore.get(name);
      if (!blob) continue;
      mediaMap[String(mediaIndex)] = name;
      zip.file(String(mediaIndex), blob);
      mediaIndex++;
    }
    zip.file('media', JSON.stringify(mediaMap));

    const blob = await zip.generateAsync({ type: 'blob' });
    return { blob, filename: `Runora_Collection_${new Date().toISOString().slice(0, 10)}.colpkg` };
  }

  /** Legacy click-a-hidden-anchor download (fallback when the save picker is unavailable). */
  public static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // small grace period — instant revoke can kill the download in some browsers
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Exports the collection .colpkg (see buildCollectionPackage) straight to the downloads folder. */
  public static async exportCollectionPackage(options?: CollectionExportOptions): Promise<void> {
    const { blob, filename } = await this.buildCollectionPackage(options);
    this.downloadBlob(blob, filename);
  }

  /**
   * Imports a .colpkg, .apkg or JSON package
   */
  public static async importPackage(file: File): Promise<{ success: boolean; message: string; count?: number }> {
    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const data = JSON.parse(text) as RunoraCollectionExport;
        return this.applyCollectionData(data);
      }

      // Read ZIP (.colpkg / .apkg)
      const zip = await JSZip.loadAsync(file);
      const collectionFile = zip.file('collection.runora.json');

      if (collectionFile) {
        const text = await collectionFile.async('text');
        const data = JSON.parse(text) as RunoraCollectionExport;
        const result = this.applyCollectionData(data);
        await this.importZipMedia(zip);
        return result;
      }

      // Fallback check for any json inside
      const jsonFiles = Object.keys(zip.files).filter((k) => k.endsWith('.json') && k !== 'media' && k !== 'media.json');
      if (jsonFiles.length > 0) {
        const text = await zip.files[jsonFiles[0]].async('text');
        const data = JSON.parse(text) as RunoraCollectionExport;
        const result = this.applyCollectionData(data);
        await this.importZipMedia(zip);
        return result;
      }

      // New-format Anki package (.apkg with collection.anki21b, zstd-compressed
      // SQLite, schema 18). The legacy collection.anki2 inside is just a
      // "please update Anki" placeholder — always prefer the anki21b data.
      const zstdEntry = zip.file('collection.anki21b');
      if (zstdEntry) {
        const decompressed = zstdDecompress(await zstdEntry.async('uint8array'));
        return await this.importAnkiSqlite(decompressed, 'schema18', zip);
      }

      // Legacy Anki package (.apkg): collection.anki2 / collection.anki21
      const sqliteEntry = zip.file('collection.anki2') || zip.file('collection.anki21');
      if (sqliteEntry) {
        return await this.importAnkiSqlite(await sqliteEntry.async('uint8array'), 'legacy', zip);
      }

      return {
        success: false,
        message:
          'Pacote inválido: não contém nem dados do Runora (JSON) nem uma coleção SQLite (collection.anki2).',
      };
    } catch (err) {
      console.error('Import error:', err);
      return {
        success: false,
        message: `Falha na importação: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Imports an external SQLite collection database (legacy collection.anki2 with models/decks
   * as JSON in `col`, or new schema 18 from decompressed collection.anki21b
   * with dedicated `decks`, `notetypes`, `fields` and `templates` tables).
   * Card queue/type is mapped onto FSRS states; the imported interval becomes the
   * initial FSRS stability. Media files are not imported yet.
   */
  private static async importAnkiSqlite(
    dbBytes: Uint8Array,
    schema: 'legacy' | 'schema18',
    zip: JSZip
  ): Promise<{ success: boolean; message: string; count?: number }> {
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
    const db = new SQL.Database(dbBytes);

    try {
      // ── Collection row: creation time (and, on legacy, models/decks JSON) ──
      const colRows = this.queryAll(db, 'SELECT crt, models, decks FROM col');
      if (colRows.length === 0) throw new Error('Tabela col vazia/inválida');
      const colCrt = Number(colRows[0][0]) || 0;
      const modelsJson = JSON.parse(String(colRows[0][1] || '{}'));
      const decksJson = JSON.parse(String(colRows[0][2] || '{}'));

      // ── Decks (names contain hierarchy) ──
      const deckIdByAnkiId = new Map<number, string>();
      const decks: Deck[] = [];
      const timestamp = Date.now();

      if (schema === 'schema18') {
        // New schema has a dedicated decks table
        for (const [did, name] of this.queryAll(db, 'SELECT id, name FROM decks')) {
          const ankiId = Number(did);
          const id = `deck-apkg-${ankiId}`;
          deckIdByAnkiId.set(ankiId, id);
          decks.push({ id, name: String(name), description: '', createdAt: timestamp, updatedAt: timestamp });
        }
      } else {
        for (const [ankiIdStr, d] of Object.entries(decksJson) as [string, any][]) {
          const ankiId = Number(ankiIdStr);
          const id = `deck-apkg-${ankiId}`;
          deckIdByAnkiId.set(ankiId, id);
          decks.push({
            id,
            name: String(d.name || 'Sem nome'),
            description: String(d.desc || ''),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }

      // ── Note types ──
      const typeIdByMid = new Map<number, string>();
      const noteTypes: NoteType[] = [];

      if (schema === 'schema18') {
        // notetypes: id, name, config(blob); fields/templates in own tables
        for (const [ntid, name, config] of this.queryAll(db, 'SELECT id, name, config FROM notetypes')) {
          const mid = Number(ntid);
          const typeId = `nt-apkg-${mid}`;
          typeIdByMid.set(mid, typeId);

          const fields = this
            .queryAll(db, `SELECT name FROM fields WHERE ntid = ${mid} ORDER BY ord`)
            .map(([n], i) => ({ id: `f-${i}`, name: String(n), ord: i }));

          const templateRows = this.queryAll(
            db,
            `SELECT ord, name, config FROM templates WHERE ntid = ${mid} ORDER BY ord`
          );
          const templates = templateRows.map(([ord, tname, configBlob], i) => {
            // Schema 18 stores qfmt/afmt inside a protobuf config blob:
            // extract the two strings containing '{{' (question, then answer)
            const tplStrings = this.extractProtoStrings(configBlob as Uint8Array | number[] | null)
              .filter((s) => s.includes('{{'));
            return {
              id: `tmpl-${i}`,
              name: String(tname || `Card ${i + 1}`),
              ord: Number(ord),
              qfmt: tplStrings[0] || `{{${fields[0]?.name ?? ''}}}`,
              afmt: tplStrings[1] || '{{FrontSide}}',
            };
          });

          // CSS: best-effort from the notetype config blob (pick the longest
          // string that actually looks like card styling, not e.g. MathJax preamble)
          const ntStrings = this.extractProtoStrings(config as Uint8Array | number[] | null);
          const css =
            ntStrings
              .filter((s) => s.includes('.card') && s.includes('{'))
              .sort((a, b) => b.length - a.length)[0] || '';
          const isCloze = templates.some((t) => /cloze:/i.test(t.qfmt + t.afmt));

          noteTypes.push({
            id: typeId,
            name: isCloze && !/cloze/i.test(String(name)) ? `${name} (Cloze)` : String(name),
            isCloze,
            hintsEnabled: false,
            voiceRecordingEnabled: false,
            fields,
            templates: templates.length > 0 ? templates : [{ id: 'tmpl-0', name: 'Card 1', ord: 0, qfmt: '', afmt: '' }],
            css,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      } else {
        for (const [midStr, m] of Object.entries(modelsJson) as [string, any][]) {
          const mid = Number(midStr);
          const typeId = `nt-apkg-${mid}`;
          typeIdByMid.set(mid, typeId);
          const isCloze = Number(m.type) === 1;
          noteTypes.push({
            id: typeId,
            name: isCloze ? `${m.name} (Cloze)` : String(m.name || 'Sem nome'),
            isCloze,
            hintsEnabled: false,
            voiceRecordingEnabled: false,
            fields: (m.flds || []).map((f: any, i: number) => ({
              id: `f-${i}`,
              name: String(f.name || `Campo ${i + 1}`),
              ord: i,
            })),
            templates: (m.tmpls || []).map((t: any, i: number) => ({
              id: `tmpl-${i}`,
              name: String(t.name || `Card ${i + 1}`),
              ord: i,
              qfmt: String(t.qfmt || ''),
              afmt: String(t.afmt || ''),
            })),
            css: String(m.css || ''),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }

      // ── Notes ──
      const noteRows = this.queryAll(db, 'SELECT id, mid, flds, tags FROM notes');
      const cardRows = this.queryAll(
        db,
        'SELECT id, nid, did, ord, type, queue, ivl, due FROM cards'
      );

      // Map noteId → deckId from first card (imported notes don't belong to decks directly)
      const deckIdByNoteId = new Map<number, number>();
      for (const [, nid, did] of cardRows) {
        if (!deckIdByNoteId.has(Number(nid))) deckIdByNoteId.set(Number(nid), Number(did));
      }

      const notes: Note[] = noteRows.map(([id, mid, flds, tags]) => {
        const typeId = typeIdByMid.get(Number(mid)) || '';
        const nt = noteTypes.find((t) => t.id === typeId);
        const values = String(flds).split('');
        const fields: Record<string, string> = {};
        // NB: the split above uses U+001F, the field separator used by the flds column
        (nt?.fields || []).forEach((f, i) => {
          fields[f.name] = values[i] ?? '';
        });
        const ankiDeckId = deckIdByNoteId.get(Number(id));
        const deckId = (ankiDeckId !== undefined && deckIdByAnkiId.get(ankiDeckId)) || decks[0]?.id || 'deck-default';
        return {
          id: `note-apkg-${id}`,
          noteTypeId: typeId,
          deckId,
          fields,
          media: [],
          tags: String(tags || '').trim().split(/\s+/).filter(Boolean),
          createdAt: colCrt * 1000 || timestamp,
          updatedAt: timestamp,
        };
      });

      // ── Cards: map queue/type → FSRS state, ivl → initial stability ──
      const cards: Card[] = cardRows.map(([id, nid, did, ord, type, queue, ivl, due]) => {
        const ankiType = Number(type); // 0 new, 1 learning, 2 review, 3 relearning
        const ankiQueue = Number(queue); // -1 suspended, -2 buried, -3 manually buried
        const ivlDays = Number(ivl);
        const state = ankiType === 2 ? 2 : ankiType === 0 ? 0 : ankiType === 3 ? 3 : 1;
        // Convert Anki's `due`, whose meaning depends on the queue:
        //  - queue 0 (new): just the position/order → available now
        //  - queue 1/4 (intraday (re)learning): unix timestamp in SECONDS
        //  - queue 2/3 (review / day-learn): days since collection creation (crt)
        const dueMs =
          ankiQueue === 1 || ankiQueue === 4
            ? Number(due) * 1000
            : state === 0
              ? timestamp
              : (colCrt + Number(due) * 86400) * 1000;
        return {
          id: `card-apkg-${id}`,
          noteId: `note-apkg-${nid}`,
          deckId: deckIdByAnkiId.get(Number(did)) || decks[0]?.id || 'deck-default',
          templateOrd: isClozeOrd(ord),
          due: dueMs,
          // queue -1 suspended, -2/-3 buried — all excluded from due counts, like Anki
          suspended: ankiQueue < 0,
          fsrs: {
            stability: Math.max(0.1, ivlDays > 0 ? ivlDays : 0.4),
            difficulty: 5,
            elapsedDays: ivlDays > 0 ? ivlDays : 0,
            scheduledDays: Math.max(1, ivlDays),
            reps: 0,
            lapses: 0,
            state,
            // Estimate last review so retrievability/intervals behave sanely
            lastReview: state === 2 && ivlDays > 0 ? dueMs - ivlDays * 86400000 : null,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies Card;
      });

      function isClozeOrd(ord: unknown): number {
        const n = Number(ord);
        return Number.isFinite(n) ? n : 0;
      }

      db.close();

      // ── Media ──
      const mediaCount = await this.importZipMedia(zip);

      // Write into storage, UPSERTING by id: re-importing a package (e.g. the same
      // deck once without and once with scheduling info) must REPLACE the previous
      // notes/cards with the same ids, not append duplicates — Anki merges by note
      // GUID the same way, so the second import updates the existing cards in place.
      const upsertById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
        const incomingIds = new Set(incoming.map((x) => x.id));
        return [...existing.filter((x) => !incomingIds.has(x.id)), ...incoming];
      };
      StorageService.saveNoteTypes(upsertById(StorageService.getNoteTypes(), noteTypes));
      // Decks: incoming wins on name/desc, but keep the local preset/limits linkage
      const existingDecks = StorageService.getDecks();
      const importedDecks = decks.map((d) => {
        const prev = existingDecks.find((x) => x.id === d.id);
        return prev
          ? { ...d, presetId: prev.presetId, dailyLimitsOverride: prev.dailyLimitsOverride }
          : d;
      });
      StorageService.saveDecks(upsertById(existingDecks, importedDecks));
      StorageService.saveNotes(upsertById(StorageService.getNotes(), notes));
      StorageService.saveCards(upsertById(StorageService.getCards(), cards));

      return {
        success: true,
        message: `Coleção importada com sucesso! ${decks.length} decks, ${notes.length} notas, ${cards.length} cards convertidos para FSRS${
          mediaCount > 0 ? ` e ${mediaCount} arquivos de mídia` : ''
        }.`,
        count: cards.length,
      };
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Run a SQL query and return rows as unknown[][]. */
  private static queryAll(db: import('sql.js').Database, sql: string): unknown[][] {
    const res = db.exec(sql);
    if (res.length === 0) return [];
    return res[0].values;
  }

  /**
   * Import media files from a package ZIP into IndexedDB.
   * Formats supported:
   * - legacy format: "media" file as JSON `{ "0": "name.webm" }` or Python pickle
   * - new format (schema 18): "media" as a zstd-compressed protobuf list of
   *   {name, size, sha1}; numeric ZIP entries are individually zstd-compressed
   *   and map positionally to the list (verified against the sha1 hashes)
   */
  private static async importZipMedia(zip: JSZip): Promise<number> {
    const mediaMeta = zip.file('media');
    if (!mediaMeta) return 0;
    let count = 0;
    try {
      const rawBytes = await mediaMeta.async('uint8array');
      const names = this.parseMediaMapOrdered(rawBytes);
      for (let i = 0; i < names.length; i++) {
        const entry = zip.file(String(i));
        if (!entry) continue;
        let bytes = await entry.async('uint8array');
        // Individual media payloads may also be zstd-framed (new exporter)
        if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) {
          bytes = zstdDecompress(bytes);
        }
        await MediaStore.put(names[i], new Blob([bytes.buffer as ArrayBuffer]));
        count++;
      }
    } catch (mediaErr) {
      console.warn('Media import failed:', mediaErr);
    }
    return count;
  }

  /**
   * Parse the "media" map file (ordered by index) into an array of filenames.
   * Handles: zstd+protobuf list (schema 18+), JSON, and Python pickle (legacy).
   */
  private static parseMediaMapOrdered(rawBytes: Uint8Array): string[] {
    // Zstd frame magic
    if (rawBytes[0] === 0x28 && rawBytes[1] === 0xb5 && rawBytes[2] === 0x2f && rawBytes[3] === 0xfd) {
      rawBytes = zstdDecompress(rawBytes);
    }
    const text = new TextDecoder().decode(rawBytes);

    // JSON format
    if (text.trim().startsWith('{')) {
      const map = JSON.parse(text) as Record<string, string>;
      const max = Math.max(...Object.keys(map).map(Number));
      const out: string[] = [];
      for (let i = 0; i <= max; i++) out[i] = map[String(i)] ?? '';
      return out;
    }

    // Python pickle (protocol 0/2): (dp0\nI0\nVname\np1\ns...
    if (text.trim().startsWith('(')) {
      const map: Record<number, string> = {};
      const re = /I(\d+)\s*\n(?:V([^\n]+)[^\n]*\n|S'([^']+)'\n|S"([^"]+)"\n)p?\d*\s*s/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[2] ?? m[3] ?? m[4];
        if (name) map[Number(m[1])] = name.trim();
      }
      const max = Math.max(0, ...Object.keys(map).map(Number));
      const out: string[] = [];
      for (let i = 0; i <= max; i++) out[i] = map[i] ?? '';
      return out;
    }

    // Protobuf list (schema 18+): repeated field 1 (wire type 2) of MediaEntry{name,size,sha1}
    const names: string[] = [];
    let i = 0;
    while (i < rawBytes.length && rawBytes[i] === 0x0a) {
      i++;
      let len = 0, shift = 0;
      while (i < rawBytes.length && (rawBytes[i] & 0x80)) {
        len |= (rawBytes[i++] & 0x7f) << shift;
        shift += 7;
      }
      if (i >= rawBytes.length) break;
      len |= rawBytes[i++] << shift;
      const msg = rawBytes.subarray(i, i + len);
      i += len;
      if (msg.length < 4 || msg[0] !== 0x0a) break;
      const nameLen = msg[1];
      const name = new TextDecoder().decode(msg.subarray(2, 2 + nameLen));
      names.push(name);
    }
    return names;
  }

  /**
   * Naive protobuf wire-format string extractor. Schema 18 stores template
   * HTML and note-type CSS inside protobuf config blobs; we walk the wire format
   * and collect every length-delimited UTF-8 string (skipping nested messages
   * that fail to decode cleanly).
   */
  private static extractProtoStrings(blob: unknown): string[] {
    if (!blob) return [];
    const bytes =
      blob instanceof Uint8Array
        ? blob
        : Array.isArray(blob)
        ? new Uint8Array(blob as number[])
        : null;
    if (!bytes) return [];

    const out: string[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let i = 0;
    while (i < bytes.length) {
      // Field key (varint)
      let key = 0, shift = 0, b = 0;
      do {
        if (i >= bytes.length) return out;
        b = bytes[i++];
        key |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);

      const wire = key & 7;
      if (wire === 2) {
        // Length-delimited
        let len = 0; shift = 0;
        do {
          if (i >= bytes.length) return out;
          b = bytes[i++];
          len |= (b & 0x7f) << shift;
          shift += 7;
        } while (b & 0x80);
        if (len > 0 && i + len <= bytes.length) {
          try {
            const s = decoder.decode(bytes.subarray(i, i + len));
            if (s.length >= 2 && !s.includes('�')) out.push(s);
          } catch {
            /* nested message or binary — skip */
          }
        }
        i += len;
      } else if (wire === 0) {
        while (i < bytes.length && (bytes[i++] & 0x80)) { /* varint */ }
      } else if (wire === 5) {
        i += 4;
      } else if (wire === 1) {
        i += 8;
      } else {
        i++;
      }
    }
    return out;
  }

  private static applyCollectionData(data: RunoraCollectionExport): { success: boolean; message: string; count: number } {
    if (!data.decks || !data.notes || !data.cards) {
      throw new Error('Arquivo de coleção inválido ou incompleto.');
    }

    // Merge or replace
    StorageService.saveDecks(data.decks);
    if (data.presets) {
      // Imported presets win on id collision; the factory "Padrão" preset is
      // always preserved (getPresets re-seeds it when missing)
      const existing = StorageService.getPresets();
      const importedIds = new Set(data.presets.map((p) => p.id));
      const factory = existing.filter((p) => p.id === StorageService.DEFAULT_PRESET_ID && !importedIds.has(p.id));
      StorageService.savePresets([...factory, ...data.presets]);
    }
    if (data.noteTypes) StorageService.saveNoteTypes(data.noteTypes);
    StorageService.saveNotes(data.notes);
    StorageService.saveCards(data.cards);
    if (data.revlog) {
      localStorage.setItem('runora_revlog', JSON.stringify(data.revlog));
    }
    if (data.fsrsParameters) {
      StorageService.saveFSRSSettings(data.fsrsParameters);
    }

    return {
      success: true,
      message: `Coleção restaurada com sucesso! ${data.decks.length} decks, ${data.notes.length} notas, ${data.cards.length} cards com parâmetros FSRS.`,
      count: data.cards.length,
    };
  }
}
