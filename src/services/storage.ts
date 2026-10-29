import { Card, DailyLimits, Deck, DeckCounts, DisplayOrderConfig, FSRSParameters, InsertionOrder, LeechAction, MixOrder, NewGatherOrder, NewSortOrder, Note, NoteType, Preset, ReviewSortOrder, RevlogEntry } from '../types/anki';
import { ClozeService } from './clozeService';
import { INITIAL_CARDS, INITIAL_DECKS, INITIAL_NOTE_TYPES, INITIAL_NOTES } from './sampleData';
import { DEFAULT_FSRS_PARAMETERS } from '../fsrs/constants';

const STORAGE_KEYS = {
  DECKS: 'anki2_decks',
  NOTETYPES: 'anki2_notetypes',
  NOTES: 'anki2_notes',
  CARDS: 'anki2_cards',
  REVLOG: 'anki2_revlog',
  SETTINGS: 'anki2_fsrs_settings',
  SEED_VERSION: 'anki2_seed_version',
  DELETED_DEFAULTS: 'anki2_deleted_defaults',
  PREFS: 'anki2_prefs',
  PRESETS: 'anki2_presets',
};

// Bump this when INITIAL_* sample data changes meaningfully,
// so existing users receive the new defaults once.
// v3: removed demo decks/cards; new collections ship Básico + Cloze + Shadowing only.
const CURRENT_SEED_VERSION = 3;

// Legacy demo content removed in seed v3 (never user data: these ids were only
// ever created by the old sample data)
const LEGACY_DEMO_DECK_IDS = [
  'deck-languages',
  'deck-english',
  'deck-english-pronunciation',
  'deck-japanese',
  'deck-japanese-sentence',
  'deck-medicine',
  'deck-medicine-neuro',
];
const LEGACY_DEMO_NOTETYPE_IDS = ['nt-language-voice', 'nt-japanese-sentence'];

interface Tombstones {
  decks: string[];
  notetypes: string[];
  notes: string[];
  cards: string[];
}

const EMPTY_TOMBSTONES: Tombstones = { decks: [], notetypes: [], notes: [], cards: [] };

export class StorageService {
  private static getTombstones(): Tombstones {
    const raw = localStorage.getItem(STORAGE_KEYS.DELETED_DEFAULTS);
    if (!raw) return { ...EMPTY_TOMBSTONES };
    try {
      return { ...EMPTY_TOMBSTONES, ...JSON.parse(raw) };
    } catch {
      return { ...EMPTY_TOMBSTONES };
    }
  }

  private static saveTombstones(tombstones: Tombstones): void {
    localStorage.setItem(STORAGE_KEYS.DELETED_DEFAULTS, JSON.stringify(tombstones));
  }

  private static addTombstone(kind: keyof Tombstones, ids: string[]): void {
    const tombstones = this.getTombstones();
    tombstones[kind] = Array.from(new Set([...tombstones[kind], ...ids]));
    this.saveTombstones(tombstones);
  }

  /**
   * Merge missing default items ONLY when the seed version increases.
   * Items the user previously deleted (tombstoned) are never re-added.
   */
  private static mergeDefaultsOnSeedBump<T extends { id: string }>(
    parsed: T[],
    defaults: T[],
    kind: keyof Tombstones
  ): { items: T[]; changed: boolean } {
    const storedVersion = Number(localStorage.getItem(STORAGE_KEYS.SEED_VERSION) || '0');
    if (storedVersion >= CURRENT_SEED_VERSION) {
      return { items: parsed, changed: false };
    }

    const tombstones = new Set(this.getTombstones()[kind]);
    const existingIds = new Set(parsed.map((d) => d.id));
    const missing = defaults.filter((d) => !existingIds.has(d.id) && !tombstones.has(d.id));
    return { items: [...parsed, ...missing], changed: true };
  }

  private static markSeedVersion(): void {
    localStorage.setItem(STORAGE_KEYS.SEED_VERSION, String(CURRENT_SEED_VERSION));
  }

  /**
   * One-time migrations for existing collections, before any merge.
   * v3: purge legacy demo decks/note types/notes/cards that shipped with early builds.
   */
  private static ensureMigrated(): void {
    const v = Number(localStorage.getItem(STORAGE_KEYS.SEED_VERSION) || '0');
    if (v >= CURRENT_SEED_VERSION) return;

    if (v < 3) {
      const rawDecks: Deck[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.DECKS) || '[]');
      const rawNotes: Note[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTES) || '[]');
      const rawCards: Card[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CARDS) || '[]');
      const rawTypes: NoteType[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTETYPES) || '[]');

      const demoDeckIds = new Set(LEGACY_DEMO_DECK_IDS);
      const keepDecks = rawDecks.filter((d) => !demoDeckIds.has(d.id));
      const keepNotes = rawNotes.filter((n) => !demoDeckIds.has(n.deckId));
      const keepCards = rawCards.filter((c) => !demoDeckIds.has(c.deckId));
      const keepTypes = rawTypes.filter((nt) => !LEGACY_DEMO_NOTETYPE_IDS.includes(nt.id));

      if (keepDecks.length !== rawDecks.length) localStorage.setItem(STORAGE_KEYS.DECKS, JSON.stringify(keepDecks));
      if (keepNotes.length !== rawNotes.length) localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(keepNotes));
      if (keepCards.length !== rawCards.length) localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(keepCards));
      if (keepTypes.length !== rawTypes.length) localStorage.setItem(STORAGE_KEYS.NOTETYPES, JSON.stringify(keepTypes));

      // Guarantee the structural default deck exists (like Anki's "Default")
      const afterDecks: Deck[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.DECKS) || '[]');
      if (!afterDecks.some((d) => d.id === 'deck-default')) {
        localStorage.setItem(
          STORAGE_KEYS.DECKS,
          JSON.stringify([...afterDecks, ...INITIAL_DECKS])
        );
      }
      this.markSeedVersion();
    }
  }

  public static getDecks(): Deck[] {
    this.ensureMigrated();
    const raw = localStorage.getItem(STORAGE_KEYS.DECKS);
    if (!raw) {
      this.saveDecks(INITIAL_DECKS);
      this.markSeedVersion();
      return INITIAL_DECKS;
    }
    try {
      const parsed: Deck[] = JSON.parse(raw);
      const { items, changed } = this.mergeDefaultsOnSeedBump(parsed, INITIAL_DECKS, 'decks');
      if (changed) {
        this.saveDecks(items);
        this.markSeedVersion();
      }
      return this.migrateLegacyDeckOptions(items);
    } catch {
      return INITIAL_DECKS;
    }
  }

  public static saveDecks(decks: Deck[]): void {
    localStorage.setItem(STORAGE_KEYS.DECKS, JSON.stringify(decks));
  }

  public static getNoteTypes(): NoteType[] {
    this.ensureMigrated();
    const raw = localStorage.getItem(STORAGE_KEYS.NOTETYPES);
    if (!raw) {
      this.saveNoteTypes(INITIAL_NOTE_TYPES);
      this.markSeedVersion();
      return INITIAL_NOTE_TYPES;
    }
    try {
      const parsed: NoteType[] = JSON.parse(raw);
      // Update template for nt-language-voice if missing voice tags
      const langType = parsed.find((nt) => nt.id === 'nt-language-voice');
      if (langType && langType.templates[0] && !langType.templates[0].qfmt.includes('voice:record')) {
        const defaultLang = INITIAL_NOTE_TYPES.find((nt) => nt.id === 'nt-language-voice');
        if (defaultLang) {
          langType.templates = defaultLang.templates;
          this.saveNoteTypes(parsed);
        }
      }

      // Merge new default note types only on a seed version bump
      const { items, changed } = this.mergeDefaultsOnSeedBump(parsed, INITIAL_NOTE_TYPES, 'notetypes');
      if (changed) {
        this.saveNoteTypes(items);
        this.markSeedVersion();
      }
      return items;
    } catch {
      return INITIAL_NOTE_TYPES;
    }
  }

  public static saveNoteTypes(noteTypes: NoteType[]): void {
    localStorage.setItem(STORAGE_KEYS.NOTETYPES, JSON.stringify(noteTypes));
  }

  public static getNotes(): Note[] {
    this.ensureMigrated();
    const raw = localStorage.getItem(STORAGE_KEYS.NOTES);
    if (!raw) {
      this.saveNotes(INITIAL_NOTES);
      this.markSeedVersion();
      return INITIAL_NOTES;
    }
    try {
      const parsed: Note[] = JSON.parse(raw);
      const { items, changed } = this.mergeDefaultsOnSeedBump(parsed, INITIAL_NOTES, 'notes');
      if (changed) {
        this.saveNotes(items);
        this.markSeedVersion();
      }
      return items;
    } catch {
      return INITIAL_NOTES;
    }
  }

  public static saveNotes(notes: Note[]): void {
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
  }

  public static getCards(): Card[] {
    this.ensureMigrated();
    const raw = localStorage.getItem(STORAGE_KEYS.CARDS);
    if (!raw) {
      this.saveCards(INITIAL_CARDS);
      this.markSeedVersion();
      return INITIAL_CARDS;
    }
    try {
      const parsed: Card[] = JSON.parse(raw);
      const { items, changed } = this.mergeDefaultsOnSeedBump(parsed, INITIAL_CARDS, 'cards');
      if (changed) {
        this.saveCards(items);
        this.markSeedVersion();
      }
      return items;
    } catch {
      return INITIAL_CARDS;
    }
  }

  public static saveCards(cards: Card[]): void {
    localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(cards));
  }

  public static getRevlog(): RevlogEntry[] {
    const raw = localStorage.getItem(STORAGE_KEYS.REVLOG);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public static saveRevlog(entry: RevlogEntry): void {
    const list = this.getRevlog();
    list.push(entry);
    localStorage.setItem(STORAGE_KEYS.REVLOG, JSON.stringify(list));
  }

  public static getFSRSSettings(): FSRSParameters {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_FSRS_PARAMETERS;
    try {
      const saved = JSON.parse(raw);
      // Upgrade to FSRS-6: 19-length saved weights (FSRS-5) → FSRS-6 (21 weights)
      const w = saved.w;
      if (Array.isArray(w) && w.length === 19) {
        return { ...DEFAULT_FSRS_PARAMETERS, ...saved, w: DEFAULT_FSRS_PARAMETERS.w };
      }
      return { ...DEFAULT_FSRS_PARAMETERS, ...saved };
    } catch {
      return DEFAULT_FSRS_PARAMETERS;
    }
  }

  public static saveFSRSSettings(params: FSRSParameters): void {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(params));
  }

  /**
   * Sync cards for a given note: creates or updates cards based on template count or cloze indices
   */
  /**
   * Renumber 1..N the NEW cards (state 0) of a deck, in the relative order they
   * appear in `orderedNewCards`. Other cards are returned untouched.
   */
  private static renumberNewCards(cards: Card[], deckId: string, orderedNewCards: Card[]): Card[] {
    const posById = new Map<string, number>();
    let idx = 0;
    for (const c of orderedNewCards) {
      if (c.deckId === deckId && c.fsrs.state === 0) posById.set(c.id, ++idx);
    }
    return cards.map((c) => {
      const pos = posById.get(c.id);
      return pos !== undefined ? { ...c, position: pos } : c;
    });
  }

  /**
   * Anki-style: when a deck's insertion order changes, every NEW card of that deck
   * (and of any subdeck following it) gets its "due #" (position) reassigned:
   * sequential → 1..N in creation order; random → 1..N after a shuffle.
   * Afterwards the order is FIXED — no reshuffling per session.
   */
  public static reassignNewCardPositions(deckIds: readonly string[], mode: InsertionOrder): void {
    if (deckIds.length === 0) return;
    let cards = this.getCards();
    for (const deckId of new Set(deckIds)) {
      const deckNewCards = cards.filter((c) => c.deckId === deckId && c.fsrs.state === 0);
      if (deckNewCards.length === 0) continue;
      const ordered = [...deckNewCards];
      if (mode === 'random') {
        for (let i = ordered.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        }
      } else {
        ordered.sort((a, b) => a.createdAt - b.createdAt);
      }
      cards = this.renumberNewCards(cards, deckId, ordered);
    }
    this.saveCards(cards);
  }

  public static syncCardsForNote(note: Note): Card[] {
    const noteTypes = this.getNoteTypes();
    const noteType = noteTypes.find((nt) => nt.id === note.noteTypeId);
    if (!noteType) return [];

    const existingCards = this.getCards();
    const noteCards = existingCards.filter((c) => c.noteId === note.id);
    const otherCards = existingCards.filter((c) => c.noteId !== note.id);

    const updatedNoteCards: Card[] = [];

    if (noteType.isCloze) {
      // Find all cloze numbers in all fields
      const allText = Object.values(note.fields).join(' ');
      const clozes = ClozeService.extractClozeIndices(allText);
      const clozeList = clozes.length > 0 ? clozes : [1];

      for (const clozeOrd of clozeList) {
        const existing = noteCards.find((c) => c.templateOrd === clozeOrd);
        if (existing) {
          updatedNoteCards.push({
            ...existing,
            deckId: note.deckId,
            updatedAt: Date.now(),
          });
        } else {
          updatedNoteCards.push({
            id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            noteId: note.id,
            deckId: note.deckId,
            templateOrd: clozeOrd,
            due: Date.now(),
            fsrs: {
              stability: 0,
              difficulty: 0,
              elapsedDays: 0,
              scheduledDays: 0,
              reps: 0,
              lapses: 0,
              state: 0, // New
              lastReview: null,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
    } else {
      // Standard templates
      for (const tmpl of noteType.templates) {
        const existing = noteCards.find((c) => c.templateOrd === tmpl.ord);
        if (existing) {
          updatedNoteCards.push({
            ...existing,
            deckId: note.deckId,
            updatedAt: Date.now(),
          });
        } else {
          updatedNoteCards.push({
            id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            noteId: note.id,
            deckId: note.deckId,
            templateOrd: tmpl.ord,
            due: Date.now(),
            fsrs: {
              stability: 0,
              difficulty: 0,
              elapsedDays: 0,
              scheduledDays: 0,
              reps: 0,
              lapses: 0,
              state: 0, // New
              lastReview: null,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
    }

    let allCards = [...otherCards, ...updatedNoteCards];

    // Anki-style positions ("due #") for the brand-new cards of this note
    const freshCards = updatedNoteCards.filter((c) => c.position === undefined);
    if (freshCards.length > 0) {
      const mode = this.getEffectiveSchedulerConfig(note.deckId).insertionOrder;
      const isNewCard = (c: Card): boolean => c.fsrs.state === 0;

      if (mode === 'random') {
        // Insert each card into a random slot; later positions shift to make room
        const deckNewCount = allCards.filter(
          (c) => c.deckId === note.deckId && isNewCard(c)
        ).length;
        for (const card of freshCards) {
          const slot = Math.floor(Math.random() * (deckNewCount + 1)) + 1;
          allCards = allCards.map((c) => {
            if (c.id === card.id) return { ...c, position: slot };
            if (
              c.deckId === note.deckId &&
              isNewCard(c) &&
              (c.position ?? Infinity) >= slot
            ) {
              return { ...c, position: c.position! + 1 };
            }
            return c;
          });
        }
      }
      // Compact positions 1..N. Random keeps the just-assigned order; sequential
      // arrives in creation order (new cards are appended after existing ones).
      const ordered = allCards
        .filter((c) => c.deckId === note.deckId && isNewCard(c))
        .sort(
          (a, b) =>
            (a.position ?? a.createdAt) - (b.position ?? b.createdAt) ||
            a.createdAt - b.createdAt
        );
      allCards = this.renumberNewCards(allCards, note.deckId, ordered);
    }

    this.saveCards(allCards);
    return updatedNoteCards;
  }

  /**
   * Delete a note and its corresponding cards
   */
  public static deleteNote(noteId: string): void {
    const cardsToDelete = this.getCards().filter((c) => c.noteId === noteId).map((c) => c.id);
    const notes = this.getNotes().filter((n) => n.id !== noteId);
    const cards = this.getCards().filter((c) => c.noteId !== noteId);
    this.saveNotes(notes);
    this.saveCards(cards);
    this.addTombstone('notes', [noteId]);
    if (cardsToDelete.length > 0) this.addTombstone('cards', cardsToDelete);
  }

  /**
   * Delete a deck and cascade options
   */
  public static deleteDeck(deckId: string): void {
    const decks = this.getDecks();
    const targetDeck = decks.find((d) => d.id === deckId);
    if (!targetDeck) return;

    // Also match subdecks e.g. "Languages::Japanese" if target is "Languages"
    const prefix = `${targetDeck.name}::`;
    const filteredDecks = decks.filter(
      (d) => d.id !== deckId && !d.name.startsWith(prefix)
    );
    this.saveDecks(filteredDecks);

    // Delete notes and cards belonging to these decks
    const deckIdsToDelete = new Set(
      decks
        .filter((d) => d.id === deckId || d.name.startsWith(prefix))
        .map((d) => d.id)
    );

    const notesToDelete = this.getNotes().filter((n) => deckIdsToDelete.has(n.deckId)).map((n) => n.id);
    const cardsToDelete = this.getCards().filter((c) => deckIdsToDelete.has(c.deckId)).map((c) => c.id);
    const notes = this.getNotes().filter((n) => !deckIdsToDelete.has(n.deckId));
    const cards = this.getCards().filter((c) => !deckIdsToDelete.has(c.deckId));
    this.saveNotes(notes);
    this.saveCards(cards);

    // Remember user deletions so seed version bumps never resurrect them
    this.addTombstone('decks', [...deckIdsToDelete]);
    if (notesToDelete.length > 0) this.addTombstone('notes', notesToDelete);
    if (cardsToDelete.length > 0) this.addTombstone('cards', cardsToDelete);
  }

  // ---- Anki-style Daily Limits ----

  /** App-wide defaults, same as Anki: 20 new/day, 200 reviews/day */
  public static readonly DEFAULT_DAILY_LIMITS = { newCardsPerDay: 20, maxReviewsPerDay: 200 };

  /** Start of "today": Anki's rollover (default 4 AM) — a study at 2 AM still counts for yesterday. */
  private static todayStart(now = Date.now()): number {
    const d = new Date(now);
    const rollover = this.getRolloverHour();
    d.setHours(rollover, 0, 0, 0);
    if (now < d.getTime()) {
      // Before rollover → today actually started yesterday at the rollover hour
      d.setTime(d.getTime() - 86400000);
    }
    return d.getTime();
  }

  // ---- Preferences ----
  /** Rollover hour for "today" (Anki default: 4). */
  public static getRolloverHour(): number {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return 4;
    try {
      const prefs = JSON.parse(raw);
      const h = Number(prefs.rolloverHour);
      return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 4;
    } catch {
      return 4;
    }
  }

  public static setRolloverHour(hour: number): void {
    const h = Math.min(23, Math.max(0, Math.round(hour)));
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    prefs.rolloverHour = h;
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  }

  /**
   * CardBrowser display fields per note type: { [noteTypeId]: fieldName[] }.
   * Field values are the field NAMES (that is how note.fields is keyed).
   * Tolerates the previous { front, back } shape by converting it to a list.
   */
  public static getBrowserFieldPrefs(): Record<string, string[]> {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return {};
    try {
      const prefs = JSON.parse(raw) as { browserFields?: unknown };
      const bf = prefs.browserFields;
      if (!bf || typeof bf !== 'object') return {};
      const out: Record<string, string[]> = {};
      for (const [ntId, val] of Object.entries(bf as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          out[ntId] = val.filter((v): v is string => typeof v === 'string');
        } else if (val && typeof val === 'object') {
          const obj = val as { front?: unknown; back?: unknown };
          const list: string[] = [];
          if (typeof obj.front === 'string' && obj.front) list.push(obj.front);
          if (typeof obj.back === 'string' && obj.back && !list.includes(obj.back)) {
            list.push(obj.back);
          }
          if (list.length > 0) out[ntId] = list;
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  public static setBrowserFieldPref(noteTypeId: string, fieldNames: string[]): void {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    const bf = (prefs.browserFields as Record<string, unknown> | undefined) ?? {};
    if (fieldNames.length === 0) {
      delete bf[noteTypeId]; // empty selection → back to the default (first two fields)
    } else {
      bf[noteTypeId] = fieldNames;
    }
    prefs.browserFields = bf;
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  }

  /** CardBrowser list ordering modes. */
  private static readonly BROWSER_SORT_MODES = ['newest', 'oldest', 'hardest', 'easiest'];

  /** CardBrowser sort order. Default: 'newest' (most recently created first). */
  public static getBrowserSortPref(): string {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return 'newest';
    try {
      const prefs = JSON.parse(raw) as { browserSort?: unknown };
      const s = prefs.browserSort;
      return typeof s === 'string' && (this.BROWSER_SORT_MODES as readonly string[]).includes(s)
        ? s
        : 'newest';
    } catch {
      return 'newest';
    }
  }

  public static setBrowserSortPref(sort: string): void {
    if (!(this.BROWSER_SORT_MODES as readonly string[]).includes(sort)) return;
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    prefs.browserSort = sort;
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  }

  /** CardBrowser multi-select deck filter (deck ids). Empty list = all decks. */
  public static getBrowserDeckFilter(): string[] {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return [];
    try {
      const prefs = JSON.parse(raw) as { browserDeckFilter?: unknown };
      const v = prefs.browserDeckFilter;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
    } catch {
      return [];
    }
  }

  public static setBrowserDeckFilter(deckIds: string[]): void {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    prefs.browserDeckFilter = deckIds.filter((x) => typeof x === 'string' && !!x);
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  }

  /** Valid FSRS state values for the CardBrowser status filter. */
  private static readonly BROWSER_STATUS_VALUES = ['0', '1', '2', '3'];

  /** CardBrowser multi-select status filter (FSRS states '0'..'3'). Empty list = all. */
  public static getBrowserStatusFilter(): string[] {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return [];
    try {
      const prefs = JSON.parse(raw) as { browserStatusFilter?: unknown };
      const v = prefs.browserStatusFilter;
      return Array.isArray(v)
        ? v.filter(
            (x): x is string => typeof x === 'string' && this.BROWSER_STATUS_VALUES.includes(x)
          )
        : [];
    } catch {
      return [];
    }
  }

  public static setBrowserStatusFilter(values: string[]): void {
    const sanitized = values.filter((x) =>
      (this.BROWSER_STATUS_VALUES as readonly string[]).includes(x)
    );
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    prefs.browserStatusFilter = sanitized;
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  }

  /** CardBrowser multi-select tag filter (tag names). Empty list = all. */
  public static getBrowserTagFilter(): string[] {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return [];
    try {
      const prefs = JSON.parse(raw) as { browserTagFilter?: unknown };
      const v = prefs.browserTagFilter;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
    } catch {
      return [];
    }
  }

  public static setBrowserTagFilter(tags: string[]): void {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    prefs.browserTagFilter = tags.filter((x) => typeof x === 'string' && !!x);
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  }

  // ---- Bulk operations (CardBrowser selection) ----
  // Tags live on NOTES (Anki semantics): operating on card ids maps to their
  // notes, so sibling cards generated from the same note are affected too.

  /** Adds tags to the notes behind the given card ids (deduplicated). */
  public static addTagsToCards(cardIds: string[], tags: string[]): void {
    const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
    if (cardIds.length === 0 || cleanTags.length === 0) return;
    const cardIdSet = new Set(cardIds);
    const noteIds = new Set(
      this.getCards()
        .filter((c) => cardIdSet.has(c.id))
        .map((c) => c.noteId)
    );
    this.saveNotes(
      this.getNotes().map((n) =>
        noteIds.has(n.id)
          ? { ...n, tags: [...new Set([...n.tags, ...cleanTags])], updatedAt: Date.now() }
          : n
      )
    );
  }

  /** Removes tags from the notes behind the given card ids. */
  public static removeTagsFromCards(cardIds: string[], tags: string[]): void {
    const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
    if (cardIds.length === 0 || cleanTags.length === 0) return;
    const cardIdSet = new Set(cardIds);
    const noteIds = new Set(
      this.getCards()
        .filter((c) => cardIdSet.has(c.id))
        .map((c) => c.noteId)
    );
    this.saveNotes(
      this.getNotes().map((n) =>
        noteIds.has(n.id)
          ? { ...n, tags: n.tags.filter((t) => !cleanTags.includes(t)), updatedAt: Date.now() }
          : n
      )
    );
  }

  /** All ancestors of a deck (from root to itself), by name prefix. */
  public static getDeckLineage(decks: Deck[], deck: Deck): Deck[] {
    const parts = deck.name.split('::');
    const lineage: Deck[] = [];
    for (let i = 1; i <= parts.length; i++) {
      const prefixName = parts.slice(0, i).join('::');
      const found = decks.find((d) => d.name === prefixName);
      if (found) lineage.push(found);
    }
    return lineage;
  }

  /** Resolved limits for a deck: read straight from its preset (Anki preset model). */
  public static getEffectiveDailyLimits(deckId: string): { newCardsPerDay: number; maxReviewsPerDay: number } {
    const limits = this.getDeckPreset(deckId).dailyLimits;
    return { newCardsPerDay: limits.newCardsPerDay, maxReviewsPerDay: limits.maxReviewsPerDay };
  }

  /**
   * How many new/review cards were already studied today across the deck's subtree.
   * A revlog entry counts as "new" when the card was New at review time (state 0),
   * and as "review" when it was in the Review queue (state 2) — learning/relearning
   * steps do not consume the review limit. This matches Anki exactly
   * (pylib: revlog type = Review only).
   */
  public static getDailyUsage(deckId: string, now = Date.now()): { newUsed: number; reviewUsed: number } {
    const decks = this.getDecks();
    const target = decks.find((d) => d.id === deckId);
    if (!target) return { newUsed: 0, reviewUsed: 0 };
    const prefix = `${target.name}::`;
    const subtreeIds = new Set(
      decks.filter((d) => d.id === deckId || d.name.startsWith(prefix)).map((d) => d.id)
    );

    const cards = this.getCards();
    const cardDeck = new Map(cards.map((c) => [c.id, c.deckId]));
    const dayStart = this.todayStart(now);

    let newUsed = 0;
    let reviewUsed = 0;
    for (const entry of this.getRevlog()) {
      if (entry.reviewTime < dayStart) continue;
      const entryDeckId = cardDeck.get(entry.cardId);
      if (!entryDeckId || !subtreeIds.has(entryDeckId)) continue;
      if (entry.state === 0) newUsed++;
      else if (entry.state === 2) reviewUsed++;
    }
    return { newUsed, reviewUsed };
  }

  /**
   * Remaining allowance for a deck, Anki-style: its preset limits minus today's
   * usage across the deck's subtree (usage of the deck and its subdecks).
   */
  public static getRemainingDailyLimits(deckId: string, now = Date.now()): { newRemaining: number; reviewRemaining: number } {
    const decks = this.getDecks();
    const deck = decks.find((d) => d.id === deckId);
    if (!deck) return { newRemaining: 0, reviewRemaining: 0 };

    const limits = this.getEffectiveDailyLimits(deckId);
    const usage = this.getDailyUsage(deckId, now);
    return {
      newRemaining: Math.max(0, limits.newCardsPerDay - usage.newUsed),
      reviewRemaining: Math.max(0, limits.maxReviewsPerDay - usage.reviewUsed),
    };
  }

  // ---- Anki-style Scheduler Config (Learning steps, Insertion order, Lapses) ----

  /**
   * Anki-style factory preset ("Padrão"): every option exactly like the app
   * defaults. Permanent — it can never be deleted; decks re-linked from a
   * deleted preset land here. Renaming is allowed, like in Anki.
   */
  public static readonly DEFAULT_PRESET_ID = 'preset-default';

  private static buildDefaultPreset(): Preset {
    const now = Date.now();
    return {
      id: this.DEFAULT_PRESET_ID,
      name: 'Padrão',
      dailyLimits: { newCardsPerDay: 20, maxReviewsPerDay: 200 },
      schedulerConfig: {
        learningSteps: '1m 10m',
        insertionOrder: 'sequential',
        relearningSteps: '10m',
        leechThreshold: 8,
        leechAction: 'suspend',
      },
      displayOrder: {
        newGatherOrder: 'deck',
        newSortOrder: 'template',
        newReviewOrder: 'mix',
        learnReviewOrder: 'mix',
        reviewSortOrder: 'dueRandom',
      },
      audioConfig: { disableAutoplay: false },
      fsrsParams: {
        requestRetention: DEFAULT_FSRS_PARAMETERS.requestRetention,
        maximumInterval: DEFAULT_FSRS_PARAMETERS.maximumInterval,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** All option presets, seeding the factory "Padrão" preset on first use. */
  public static getPresets(): Preset[] {
    const raw = localStorage.getItem(STORAGE_KEYS.PRESETS);
    let presets: Preset[] = [];
    if (raw) {
      try {
        presets = JSON.parse(raw) as Preset[];
      } catch {
        presets = [];
      }
    }
    if (!presets.some((p) => p.id === this.DEFAULT_PRESET_ID)) {
      presets = [this.buildDefaultPreset(), ...presets];
      localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(presets));
    }
    return presets;
  }

  public static savePresets(presets: Preset[]): void {
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(presets));
  }

  public static getPresetById(presetId: string | null | undefined): Preset | null {
    return this.getPresets().find((p) => p.id === presetId) ?? null;
  }

  public static upsertPreset(preset: Preset): void {
    const presets = this.getPresets();
    const idx = presets.findIndex((p) => p.id === preset.id);
    if (idx >= 0) presets[idx] = { ...preset, updatedAt: Date.now() };
    else presets.push({ ...preset, updatedAt: Date.now() });
    this.savePresets(presets);
  }

  /** Delete a preset; every deck linked to it is re-linked to the factory preset. */
  public static deletePreset(presetId: string): void {
    if (presetId === this.DEFAULT_PRESET_ID) return; // the factory preset is permanent
    this.savePresets(this.getPresets().filter((p) => p.id !== presetId));
    const decks = this.getDecks().map((d) =>
      d.presetId === presetId
        ? { ...d, presetId: this.DEFAULT_PRESET_ID, updatedAt: Date.now() }
        : d
    );
    this.saveDecks(decks);
  }

  /** Create an empty preset with the app defaults (like Anki's "Add" preset option). */
  public static createPreset(name: string): Preset {
    const preset: Preset = {
      ...this.buildDefaultPreset(),
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'Novo preset',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsertPreset(preset);
    return preset;
  }

  /** The preset a deck follows — falls back to the factory preset when unlinked. */
  public static getDeckPreset(deckId: string): Preset {
    const deck = this.getDecks().find((d) => d.id === deckId);
    if (deck?.presetId) {
      const preset = this.getPresetById(deck.presetId);
      if (preset) return preset;
    }
    return this.getPresetById(this.DEFAULT_PRESET_ID)!;
  }

  /**
   * Phase-2 migration: decks still carrying their own option copies (the app UI
   * always wrote explicit values per deck) are linked to a dedicated preset
   * built from that copy; decks with no stored options (e.g. the sample
   * "Padrão" deck) link straight to the factory preset. Idempotent — the
   * stored `presetId` alone marks a deck as migrated.
   */
  private static migrateLegacyDeckOptions(decks: Deck[]): Deck[] {
    const unlinked = decks.filter((d) => !d.presetId);
    if (unlinked.length === 0) return decks;
    const presets = this.getPresets();
    const now = Date.now();
    const additions: Preset[] = [];
    const migrated = decks.map((d) => {
      if (d.presetId) return d;
      const hasOwnOptions =
        d.dailyLimits !== undefined ||
        d.schedulerConfig !== undefined ||
        d.displayOrder !== undefined ||
        d.audioConfig !== undefined ||
        d.fsrsParams !== undefined;
      if (!hasOwnOptions) {
        return { ...d, presetId: this.DEFAULT_PRESET_ID, updatedAt: now };
      }
      const presetId = `preset-${d.id}`;
      if (!presets.some((p) => p.id === presetId)) {
        additions.push(this.presetFromLegacyDeck(d, presetId));
      }
      return { ...d, presetId, updatedAt: now };
    });
    if (additions.length > 0) this.savePresets([...presets, ...additions]);
    this.saveDecks(migrated);
    return migrated;
  }

  /** Build a preset from a legacy deck's own explicit option sheet. */
  private static presetFromLegacyDeck(deck: Deck, presetId: string): Preset {
    const now = Date.now();
    return {
      id: presetId,
      name: deck.name,
      dailyLimits: {
        newCardsPerDay:
          deck.dailyLimits?.newCardsPerDay ?? this.DEFAULT_DAILY_LIMITS.newCardsPerDay,
        maxReviewsPerDay:
          deck.dailyLimits?.maxReviewsPerDay ?? this.DEFAULT_DAILY_LIMITS.maxReviewsPerDay,
      },
      schedulerConfig: {
        learningSteps: deck.schedulerConfig?.learningSteps ?? this.formatSteps(this.DEFAULT_SCHEDULER.learningSteps),
        insertionOrder: deck.schedulerConfig?.insertionOrder ?? this.DEFAULT_SCHEDULER.insertionOrder,
        relearningSteps: deck.schedulerConfig?.relearningSteps ?? this.formatSteps(this.DEFAULT_SCHEDULER.relearningSteps),
        leechThreshold: deck.schedulerConfig?.leechThreshold ?? this.DEFAULT_SCHEDULER.leechThreshold,
        leechAction: deck.schedulerConfig?.leechAction ?? this.DEFAULT_SCHEDULER.leechAction,
      },
      displayOrder: {
        newGatherOrder: deck.displayOrder?.newGatherOrder ?? this.DEFAULT_DISPLAY_ORDER.newGatherOrder,
        newSortOrder: deck.displayOrder?.newSortOrder ?? this.DEFAULT_DISPLAY_ORDER.newSortOrder,
        newReviewOrder: deck.displayOrder?.newReviewOrder ?? this.DEFAULT_DISPLAY_ORDER.newReviewOrder,
        learnReviewOrder: deck.displayOrder?.learnReviewOrder ?? this.DEFAULT_DISPLAY_ORDER.learnReviewOrder,
        reviewSortOrder: deck.displayOrder?.reviewSortOrder ?? this.DEFAULT_DISPLAY_ORDER.reviewSortOrder,
      },
      audioConfig: {
        disableAutoplay: deck.audioConfig?.disableAutoplay ?? this.DEFAULT_AUDIO.disableAutoplay,
      },
      fsrsParams: {
        requestRetention:
          deck.fsrsParams?.requestRetention ?? DEFAULT_FSRS_PARAMETERS.requestRetention,
        maximumInterval: deck.fsrsParams?.maximumInterval ?? DEFAULT_FSRS_PARAMETERS.maximumInterval,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Anki defaults: 1m 10m learning, sequential insertion, 10m relearning, leech at 8 lapses → suspend */
  public static readonly DEFAULT_SCHEDULER = {
    learningSteps: [1, 10] as number[], // minutes
    insertionOrder: 'sequential' as InsertionOrder,
    relearningSteps: [10] as number[],  // minutes
    leechThreshold: 8,
    leechAction: 'suspend' as LeechAction,
  };

  /**
   * Parse Anki-style step strings into minutes: "1m 10m", "30s 5m 1h 1d", or bare minutes "1 10".
   * Invalid/empty input → null.
   */
  public static parseSteps(input: string): number[] | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const tokens = trimmed.split(/\s+/);
    const minutes: number[] = [];
    for (const token of tokens) {
      const m = token.match(/^(\d+(?:[.,]\d+)?)(s|m|h|d)?$/i);
      if (!m) return null;
      const value = parseFloat(m[1].replace(',', '.'));
      const unit = (m[2] || 'm').toLowerCase();
      const factor = unit === 's' ? 1 / 60 : unit === 'h' ? 60 : unit === 'd' ? 1440 : 1;
      const asMinutes = value * factor;
      if (!(asMinutes > 0)) return null;
      minutes.push(asMinutes);
    }
    return minutes;
  }

  /** Format minutes[] back into a steps string: [1, 10] → "1m 10m" */
  public static formatSteps(minutes: number[]): string {
    return minutes
      .map((min) => {
        if (min < 1) return `${Math.round(min * 60)}s`;
        if (min % 1440 === 0) return `${min / 1440}d`;
        if (min % 60 === 0) return `${min / 60}h`;
        return `${min}m`;
      })
      .join(' ');
  }

  /** Resolved scheduler config for a deck: read straight from its preset. */
  public static getEffectiveSchedulerConfig(deckId: string): {
    learningSteps: number[];
    insertionOrder: InsertionOrder;
    relearningSteps: number[];
    leechThreshold: number;
    leechAction: LeechAction;
  } {
    const sc = this.getDeckPreset(deckId).schedulerConfig;
    return {
      learningSteps: this.parseSteps(sc.learningSteps) ?? [...this.DEFAULT_SCHEDULER.learningSteps],
      insertionOrder: sc.insertionOrder,
      relearningSteps: this.parseSteps(sc.relearningSteps) ?? [...this.DEFAULT_SCHEDULER.relearningSteps],
      leechThreshold: sc.leechThreshold > 0 ? sc.leechThreshold : this.DEFAULT_SCHEDULER.leechThreshold,
      leechAction: sc.leechAction,
    };
  }

  // ---- Anki-style Display Order ----

  /** Anki defaults for Display Order */
  public static readonly DEFAULT_DISPLAY_ORDER = {
    newGatherOrder: 'deck' as NewGatherOrder,
    newSortOrder: 'template' as NewSortOrder,
    newReviewOrder: 'mix' as MixOrder,
    learnReviewOrder: 'mix' as MixOrder,
    reviewSortOrder: 'dueRandom' as ReviewSortOrder,
  };

  /** Resolved display order for a deck: read straight from its preset. */
  public static getEffectiveDisplayOrder(deckId: string): {
    newGatherOrder: NewGatherOrder;
    newSortOrder: NewSortOrder;
    newReviewOrder: MixOrder;
    learnReviewOrder: MixOrder;
    reviewSortOrder: ReviewSortOrder;
  } {
    const od = this.getDeckPreset(deckId).displayOrder;
    return {
      newGatherOrder: od.newGatherOrder ?? this.DEFAULT_DISPLAY_ORDER.newGatherOrder,
      newSortOrder: od.newSortOrder ?? this.DEFAULT_DISPLAY_ORDER.newSortOrder,
      newReviewOrder: od.newReviewOrder ?? this.DEFAULT_DISPLAY_ORDER.newReviewOrder,
      learnReviewOrder: od.learnReviewOrder ?? this.DEFAULT_DISPLAY_ORDER.learnReviewOrder,
      reviewSortOrder: od.reviewSortOrder ?? this.DEFAULT_DISPLAY_ORDER.reviewSortOrder,
    };
  }

  // ---- Anki-style Audio Config ----

  /** Anki default: audio plays automatically (disableAutoplay = false) */
  public static readonly DEFAULT_AUDIO = {
    disableAutoplay: false,
  };

  /** Resolved audio config for a deck: read straight from its preset. */
  public static getEffectiveAudioConfig(deckId: string): {
    disableAutoplay: boolean;
  } {
    const ac = this.getDeckPreset(deckId).audioConfig;
    return { disableAutoplay: ac.disableAutoplay ?? this.DEFAULT_AUDIO.disableAutoplay };
  }

  /**
   * Calculate due cards counts for a deck (including subdecks).
   * Counts are capped by the daily limits still available today, like Anki's deck list.
   */
  public static getDeckCounts(deckId: string, now = Date.now()): DeckCounts {
    const decks = this.getDecks();
    const targetDeck = decks.find((d) => d.id === deckId);
    if (!targetDeck) return { newCount: 0, learningCount: 0, reviewCount: 0, totalCount: 0 };

    const prefix = `${targetDeck.name}::`;
    const matchingDeckIds = new Set(
      decks
        .filter((d) => d.id === deckId || d.name.startsWith(prefix))
        .map((d) => d.id)
    );

    const cards = this.getCards().filter((c) => matchingDeckIds.has(c.deckId) && !c.suspended);

    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    for (const card of cards) {
      if (card.fsrs.state === 0) {
        newCount++;
      } else if (card.fsrs.state === 1 || card.fsrs.state === 3) {
        if (card.due <= now) {
          learningCount++;
        }
      } else if (card.fsrs.state === 2) {
        if (card.due <= now) {
          reviewCount++;
        }
      }
    }

    // Cap displayed counts by today's remaining limits, like Anki's deck list
    const { newRemaining, reviewRemaining } = this.getRemainingDailyLimits(deckId, now);

    return {
      newCount: Math.min(newCount, newRemaining),
      learningCount,
      reviewCount: Math.min(reviewCount, reviewRemaining),
      totalCount: cards.length,
    };
  }

  /**
   * Reset all data to factory sample data
   */
  public static resetToDefault(): void {
    localStorage.removeItem(STORAGE_KEYS.DECKS);
    localStorage.removeItem(STORAGE_KEYS.NOTETYPES);
    localStorage.removeItem(STORAGE_KEYS.NOTES);
    localStorage.removeItem(STORAGE_KEYS.CARDS);
    localStorage.removeItem(STORAGE_KEYS.REVLOG);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    localStorage.removeItem(STORAGE_KEYS.SEED_VERSION);
    localStorage.removeItem(STORAGE_KEYS.DELETED_DEFAULTS);
    localStorage.removeItem(STORAGE_KEYS.PREFS);
    localStorage.removeItem(STORAGE_KEYS.PRESETS);
    // Clear imported media (IndexedDB) — fire and forget
    void import('./mediaStore').then(({ MediaStore }) => MediaStore.clear()).catch(() => {});
  }
}
