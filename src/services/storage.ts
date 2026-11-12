import { Card, DailyLimits, Deck, DeckCounts, DisplayOrderConfig, FSRSParameters, FSRSScope, InsertionOrder, LeechAction, MixOrder, NewGatherOrder, NewSortOrder, Note, NoteType, Preset, ReviewSortOrder, RevlogEntry, Tombstone } from '../types/runora';
import { ClozeService } from './clozeService';
import { INITIAL_CARDS, INITIAL_DECKS, INITIAL_NOTE_TYPES, INITIAL_NOTES } from './sampleData';
import { DEFAULT_FSRS_PARAMETERS, FSRS_WEIGHT_COUNT_MIN } from '../fsrs/constants';
import { formatTimespanMinutes } from '../fsrs/timespan';
import { DEFAULT_COLOR_THEME } from '../themes';

/**
 * JSON estável (chaves sempre na mesma ordem) para comparar o CONTEÚDO de
 * dois itens sem falso positivo. `usn` e `updatedAt` ficam de fora: o USN é
 * o "número da mudança" e o updatedAt é só o carimbo do toque — nenhum dos
 * dois diz se o conteúdo realmente mudou.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k]) => k !== 'usn' && k !== 'updatedAt')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

const STORAGE_KEYS = {
  DECKS: 'runora_decks',
  NOTETYPES: 'runora_notetypes',
  NOTES: 'runora_notes',
  CARDS: 'runora_cards',
  REVLOG: 'runora_revlog',
  SETTINGS: 'runora_fsrs_settings',
  SEED_VERSION: 'runora_seed_version',
  DELETED_DEFAULTS: 'runora_deleted_defaults',
  DELETED_AT: 'runora_deleted_at',
  PREFS: 'runora_prefs',
  PRESETS: 'runora_presets',
  THEME: 'runora_theme',
  COLOR_THEME: 'runora_color_theme',
  // Phase 7: Sync incremental (Anki-style)
  USN_COUNTER: 'runora_usn_counter',      // Contador global de USN (incrementa a cada write)
  SYNC_TOMBSTONES: 'runora_sync_tombstones', // Tombstones para sync incremental (deletados)
};

/**
 * Aviso rápido de que uma configuração do app mudou (o botão Sync observa —
 * preferências/tema/FSRS não mexem na coleção, então nada mais indica isso).
 */
export function dispatchSettingsChanged(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('runora:settings-changed'));
  } catch {
    // ignora: ambientes sem CustomEvent
  }
}

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

interface SyncTombstones {
  decks: Tombstone[];
  notetypes: Tombstone[];
  notes: Tombstone[];
  cards: Tombstone[];
  revlog: Tombstone[];
  presets: Tombstone[];
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
   * Timestamp of the most recent local deletion. Deleting items does NOT
   * change the `updatedAt` of anything that remains, so the sync engine
   * (which gates its deep comparison on the max updatedAt) would miss it.
   */
  public static getLastDeletedAt(): number {
    const n = Number(localStorage.getItem(STORAGE_KEYS.DELETED_AT) ?? '');
    return Number.isFinite(n) ? n : 0;
  }

  private static bumpDeletedAt(): void {
    localStorage.setItem(STORAGE_KEYS.DELETED_AT, String(Date.now()));
  }

  // ============================================================
  // Phase 7: USN (Update Sequence Number) — sync incremental
  // ============================================================

  /** Contador global de USN — incrementa a cada write (create/update/delete). */
  private static getUsnCounter(): number {
    const raw = localStorage.getItem(STORAGE_KEYS.USN_COUNTER);
    return raw ? Number(raw) : 0;
  }

  private static setUsnCounter(value: number): void {
    localStorage.setItem(STORAGE_KEYS.USN_COUNTER, String(value));
  }

  /** Retorna o próximo USN e incrementa o contador. */
  public static nextUsn(): number {
    const next = this.getUsnCounter() + 1;
    this.setUsnCounter(next);
    return next;
  }

  /** Retorna o USN atual (sem incrementar). */
  public static getCurrentUsn(): number {
    return this.getUsnCounter();
  }

  /**
   * Adota o contador que veio do Drive.
   *
   * O USN é COMPARTILHADO entre os aparelhos (ele vive no estado do Drive).
   * Sem esta adoção, cada aparelho contaria por si e o delta incremental
   * não bateria entre eles: o aparelho que editou algo "depois" do outro
   * ficaria com um USN menor e a mudança nunca entraria no delta.
   */
  public static adoptUsnCounter(usn: number): void {
    if (!Number.isFinite(usn) || usn <= 0) return;
    if (usn > this.getUsnCounter()) this.setUsnCounter(usn);
  }

  /**
   * Maior USN entre os itens da coleção — o "head" real do conteúdo.
   *
   * Serve para o aparelho adotar o contador de quem escreveu a coleção:
   * depois de baixar o backup do outro aparelho, os itens trazem o USN
   * daquele aparelho e o contador local precisa acompanhar.
   */
  public static getMaxItemUsn(): number {
    let max = 0;
    const listas: Array<Array<{ usn?: number }>> = [
      this.getNotes(),
      this.getCards(),
      this.getDecks(),
      this.getNoteTypes(),
      this.getPresets(),
      this.getRevlog(),
    ];
    for (const lista of listas) {
      for (const item of lista) max = Math.max(max, item.usn ?? 0);
    }
    return max;
  }

  /**
   * Quando applying itens que vim do Drive, o USN local NÃO pode ser
   * renumerado (o item já traz o USN do aparelho que o mudou).
   */
  private static suppressUsnBump = false;

  /**
   * USN de uma deleção.
   *
   * Deleção é mudança real de conteúdo → o contador avança (sem isso o sync
   * incremental entende "nada mudou" e sobe o backup completo).
   *
   * EXCEÇÃO: quando a deleção está sendo APLICADA do Drive (outro aparelho
   * deletou), o USN novo já existe — é o do outro aparelho. Aqui não se cria
   * outra versão, senão o aparelho "mudaria" sem motivo e o próximo sync
   * subiria um delta vazio.
   */
  private static advanceUsnForDeletion(): number {
    if (this.suppressUsnBump) return this.getCurrentUsn();
    return this.nextUsn();
  }

  /** Roda `fn` sem renumerar o USN dos itens (uso: aplicar o delta do Drive). */
  public static withoutUsnBump<T>(fn: () => T): T {
    const anterior = this.suppressUsnBump;
    this.suppressUsnBump = true;
    try {
      return fn();
    } finally {
      this.suppressUsnBump = anterior;
    }
  }

  /**
   * Dá USN novo aos itens que mudaram de verdade.
   *
   * Antes, editar uma nota mantinha o USN antigo (o `usn` já preenchido era
   * preservado) — e o delta incremental do Drive não via a edição: o sync
   * dizia "sincronizado" e a mudança ficava só naquele aparelho.
   *
   * O contador global SÓ avança quando o CONTEÚDO muda: ele diz em que
   * "versão" da coleção estamos, e não quantas vezes o app gravou. Se
   * avançasse a cada gravação, cada aparelho subiria uma versão nova sem
   * nada ter mudado e os aparelhos nunca mais sincronizariam de forma
   * incremental entre si.
   */
  private static withFreshUsn<
    T extends { id: string; usn?: number; createdAt?: number; updatedAt?: number }
  >(items: T[], previous: T[], now: number): T[] {
    const antes = new Map(previous.map((p) => [p.id, p]));

    // `usn` e `updatedAt` NÃO são conteúdo: o usn é justamente o que estamos
    // decidindo aqui, e o updatedAt muda sozinho em importações/migrações
    // (sem nenhum conteúdo novo).
    const conteudo = (item: T): string => {
      const { usn, updatedAt, ...resto } = item as T & Record<string, unknown>;
      return stableStringify(resto);
    };

    if (this.suppressUsnBump) {
      // veio do Drive: o USN é o de lá — não renumera nem avança o contador
      return items.map((item) =>
        item.usn
          ? item
          : { ...item, usn: Math.max(1, this.getCurrentUsn()), createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? now }
      );
    }

    // O que precisa de um USN novo?
    //  - item NOVO (não existia antes e não tem USN)      → cria
    //  - item NOVO que já tem USN (veio de outra origem)  → mantém o dele
    //  - item que EXISTIA e o conteúdo mudou              → edição
    //  - item que EXISTIA sem USN e o conteúdo mudou     → edição (ganha USN)
    //  - item que existia COM USN e o chamador esqueceu o USN → devolve o de antes
    const precisaDeUsn = (item: T): 'novo' | 'edicao' | 'restaurar' | null => {
      const antigo = antes.get(item.id);
      if (!antigo) return item.usn ? null : 'novo';
      if (!item.usn) {
        if (antigo.usn) return 'restaurar';
        return conteudo(antigo) === conteudo(item) ? null : 'edicao';
      }
      return conteudo(antigo) === conteudo(item) ? null : 'edicao';
    };

    // Itens que já têm USN (vieram de outra origem) mantêm o dele — mas o
    // contador local precisa acompanhar, senão o próximo USN gerado seria
    // MENOR que o de um item já guardado (e o delta não o enxergaria).
    for (const item of items) {
      if (item.usn) this.adoptUsnCounter(item.usn);
    }

    const plano = items.map((item) => precisaDeUsn(item));
    if (!plano.some((p) => p === 'novo' || p === 'edicao')) {
      // Nada mudou de verdade: o contador NÃO avança (senão cada gravação
      // criaria uma "versão" nova e os aparelhos só trocariam sync completo).
      return items.map((item, i) =>
        plano[i] === 'restaurar' ? { ...item, usn: antes.get(item.id)?.usn } : item
      );
    }

    const usn = this.nextUsn();
    return items.map((item, i) => {
      if (plano[i] === 'novo') {
        return { ...item, usn, createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? now };
      }
      if (plano[i] === 'edicao') {
        return { ...item, usn };
      }
      if (plano[i] === 'restaurar') {
        return { ...item, usn: antes.get(item.id)?.usn };
      }
      return item;
    });
  }

  /**
   * Lê o que está guardado no localStorage SEM passar pelos getters (que
   * podem gravar de volta) — é o "antes" que o withFreshUsn compara.
   */
  private static readStored<T>(key: string): T[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  // ---- Sync Tombstones (para itens deletados no sync incremental) ----
  // Estrutura: { decks: Tombstone[], notetypes: Tombstone[], notes: Tombstone[], cards: Tombstone[], revlog: Tombstone[], presets: Tombstone[] }

  private static getSyncTombstones(): SyncTombstones {
    const raw = localStorage.getItem(STORAGE_KEYS.SYNC_TOMBSTONES);
    if (!raw) return { decks: [], notetypes: [], notes: [], cards: [], revlog: [], presets: [] };
    try {
      return JSON.parse(raw);
    } catch {
      return { decks: [], notetypes: [], notes: [], cards: [], revlog: [], presets: [] };
    }
  }

  private static saveSyncTombstones(tombstones: SyncTombstones): void {
    localStorage.setItem(STORAGE_KEYS.SYNC_TOMBSTONES, JSON.stringify(tombstones));
  }

  private static addSyncTombstone(type: keyof SyncTombstones, tombstone: Tombstone): void {
    const tombstones = this.getSyncTombstones();
    tombstones[type].push(tombstone);
    this.saveSyncTombstones(tombstones);
  }

  /** Retorna e limpa tombstones do tipo especificado com USN > sinceUsn. */
  public static takeSyncTombstones(type: keyof SyncTombstones, sinceUsn: number): Tombstone[] {
    const tombstones = this.getSyncTombstones();
    const result = tombstones[type].filter((t) => t.usn > sinceUsn);
    if (result.length > 0) {
      tombstones[type] = tombstones[type].filter((t) => t.usn <= sinceUsn);
      this.saveSyncTombstones(tombstones);
    }
    return result;
  }

  /** Limpa todos os tombstones com USN <= sinceUsn (já foram sincronizados). */
  public static clearSyncTombstonesUpTo(sinceUsn: number): void {
    const tombstones = this.getSyncTombstones();
    let changed = false;
    for (const key of Object.keys(tombstones) as Array<keyof SyncTombstones>) {
      const before = tombstones[key].length;
      tombstones[key] = tombstones[key].filter((t) => t.usn > sinceUsn);
      if (tombstones[key].length !== before) changed = true;
    }
    if (changed) this.saveSyncTombstones(tombstones);
  }

  // ============================================================
  // Phase 7: Helpers para obter mudanças desde um USN (sync incremental)
  // ============================================================

  /** Retorna decks com USN > sinceUsn. */
  public static getDecksSince(sinceUsn: number): Deck[] {
    return this.getDecks().filter((d) => (d.usn ?? 0) > sinceUsn);
  }

  /** Retorna note types com USN > sinceUsn. */
  public static getNoteTypesSince(sinceUsn: number): NoteType[] {
    return this.getNoteTypes().filter((nt) => (nt.usn ?? 0) > sinceUsn);
  }

  /** Retorna notas com USN > sinceUsn. */
  public static getNotesSince(sinceUsn: number): Note[] {
    return this.getNotes().filter((n) => (n.usn ?? 0) > sinceUsn);
  }

  /** Retorna cards com USN > sinceUsn. */
  public static getCardsSince(sinceUsn: number): Card[] {
    return this.getCards().filter((c) => (c.usn ?? 0) > sinceUsn);
  }

  /** Retorna revlog entries com USN > sinceUsn. */
  public static getRevlogSince(sinceUsn: number): RevlogEntry[] {
    return this.getRevlog().filter((r) => (r.usn ?? 0) > sinceUsn);
  }

  /** Retorna presets com USN > sinceUsn. */
  public static getPresetsSince(sinceUsn: number): Preset[] {
    return this.getPresets().filter((p) => (p.usn ?? 0) > sinceUsn);
  }

  /** Retorna todos os tombstones de sync com USN > sinceUsn. */
  public static getAllSyncTombstonesSince(sinceUsn: number): Tombstone[] {
    const tombstones = this.getSyncTombstones();
    const all: Tombstone[] = [];
    for (const key of Object.keys(tombstones) as Array<keyof SyncTombstones>) {
      all.push(...tombstones[key].filter((t) => t.usn > sinceUsn));
    }
    return all.sort((a, b) => a.usn - b.usn);
  }

  /**
   * Backfill: garante que todas as entidades existentes tenham USN.
   * Deve ser chamado uma vez na inicialização ou migração.
   * Retorna o número de entidades atualizadas.
   */
  public static backfillUsn(): number {
    let updated = 0;
    const now = Date.now();

    const decks = this.getDecks().map((d) => {
      if (!d.usn) { updated++; return { ...d, usn: this.nextUsn(), updatedAt: now }; }
      return d;
    });
    if (decks.some((d) => !d.usn)) this.saveDecks(decks);

    const noteTypes = this.getNoteTypes().map((nt) => {
      if (!nt.usn) { updated++; return { ...nt, usn: this.nextUsn(), updatedAt: now }; }
      return nt;
    });
    if (noteTypes.some((nt) => !nt.usn)) this.saveNoteTypes(noteTypes);

    const notes = this.getNotes().map((n) => {
      if (!n.usn) { updated++; return { ...n, usn: this.nextUsn(), updatedAt: now }; }
      return n;
    });
    if (notes.some((n) => !n.usn)) this.saveNotes(notes);

    const cards = this.getCards().map((c) => {
      if (!c.usn) { updated++; return { ...c, usn: this.nextUsn(), updatedAt: now }; }
      return c;
    });
    if (cards.some((c) => !c.usn)) this.saveCards(cards);

    const revlog = this.getRevlog().map((r) => {
      if (!r.usn) { updated++; return { ...r, usn: this.nextUsn() }; }
      return r;
    });
    if (revlog.some((r) => !r.usn)) this.saveRevlogAll(revlog);

    const presets = this.getPresets().map((p) => {
      if (!p.usn) { updated++; return { ...p, usn: this.nextUsn(), updatedAt: now }; }
      return p;
    });
    if (presets.some((p) => !p.usn)) this.savePresets(presets);

    return updated;
  }

  /**
   * Dedup by id, keeping the LAST occurrence (the most recent import wins).
   * Heals profiles where an older build appended duplicate cards/notes/decks
   * on re-import instead of upserting them.
   */
  private static dedupById<T extends { id: string }>(items: T[]): T[] {
    if (items.length < 2) return items;
    return [...new Map(items.map((x) => [x.id, x])).values()];
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

      // Guarantee the structural default deck exists (like Runora's "Default")
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
      const parsed: Deck[] = this.dedupById(JSON.parse(raw));
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
    const now = Date.now();
    const comTimestamps = decks.map((d) => {
      if (d.usn) return d;
      const createdAt = d.createdAt ?? now;
      const updatedAt = d.updatedAt ?? now;
      return { ...d, createdAt, updatedAt };
    });
    // decks renomeados/editados ganham USN novo (o delta do Drive precisa ver)
    const final = this.withFreshUsn(comTimestamps, this.readStored<Deck>(STORAGE_KEYS.DECKS), now);
    localStorage.setItem(STORAGE_KEYS.DECKS, JSON.stringify(final));
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
      const parsed: NoteType[] = this.dedupById(JSON.parse(raw));
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
    const now = Date.now();
    const comTimestamps = noteTypes.map((nt) => {
      if (nt.usn) return nt;
      const createdAt = nt.createdAt ?? now;
      const updatedAt = nt.updatedAt ?? now;
      return { ...nt, createdAt, updatedAt };
    });
    const final = this.withFreshUsn(comTimestamps, this.readStored<NoteType>(STORAGE_KEYS.NOTETYPES), now);
    localStorage.setItem(STORAGE_KEYS.NOTETYPES, JSON.stringify(final));
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
      const parsed: Note[] = this.dedupById(JSON.parse(raw));
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
    const now = Date.now();
    const comTimestamps = notes.map((n) => {
      if (n.usn) return n;
      // Preserve existing timestamps; only set to now if genuinely new (no createdAt)
      const createdAt = n.createdAt ?? now;
      const updatedAt = n.updatedAt ?? now;
      return { ...n, createdAt, updatedAt };
    });
    // NOTA EDITADA ganha USN novo: sem isto a edição não entrava no delta
    // incremental e o sync dizia "sincronizado" com a mudança só local.
    const final = this.withFreshUsn(comTimestamps, this.readStored<Note>(STORAGE_KEYS.NOTES), now);
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(final));
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
      const parsed: Card[] = this.dedupById(JSON.parse(raw));
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
    const now = Date.now();
    const comTimestamps = cards.map((c) => {
      if (c.usn) return c;
      const createdAt = c.createdAt ?? now;
      const updatedAt = c.updatedAt ?? now;
      return { ...c, createdAt, updatedAt };
    });
    // card revisto (FSRS, deck, template) também precisa aparecer no delta
    const final = this.withFreshUsn(comTimestamps, this.readStored<Card>(STORAGE_KEYS.CARDS), now);
    localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(final));
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
    const usn = this.nextUsn();
    const withUsn = entry.usn ? entry : { ...entry, usn };
    list.push(withUsn);
    localStorage.setItem(STORAGE_KEYS.REVLOG, JSON.stringify(list));
  }

  /** Replaces the whole review history (bulk imports build the union first). */
  public static saveRevlogAll(entries: RevlogEntry[]): void {
    // O contador só avança se entra alguma revisão SEM USN (ou seja, nova de
    // verdade). Reordenar/mesclar o histórico que já tem USN não cria uma
    // "versão" nova da coleção — e criar uma faria os aparelhos baixarem a
    // coleção inteira de novo.
    const precisaDeUsn = entries.some((e) => !e.usn);
    const usn = precisaDeUsn ? this.nextUsn() : 0;
    const withUsn = entries.map((e) => (e.usn ? e : { ...e, usn }));
    localStorage.setItem(STORAGE_KEYS.REVLOG, JSON.stringify(withUsn));
  }

  public static getFSRSSettings(): FSRSParameters {
    return {
      requestRetention: DEFAULT_FSRS_PARAMETERS.requestRetention,
      maximumInterval: DEFAULT_FSRS_PARAMETERS.maximumInterval,
      w: [...DEFAULT_FSRS_PARAMETERS.w],
      enableFuzz: DEFAULT_FSRS_PARAMETERS.enableFuzz,
    };
  }

  public static saveFSRSSettings(_params: FSRSParameters): void {
    // Inerte conforme a T10: o FSRS global agora é configuração fixa do app.
  }

  public static getTheme(): 'light' | 'dark' | 'system' {
    const raw = localStorage.getItem(STORAGE_KEYS.THEME);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    return 'system';
  }

  public static setTheme(theme: 'light' | 'dark' | 'system'): void {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    dispatchSettingsChanged();
  }

  public static getColorTheme(): string {
    return localStorage.getItem(STORAGE_KEYS.COLOR_THEME) ?? DEFAULT_COLOR_THEME;
  }

  public static setColorTheme(theme: string): void {
    localStorage.setItem(STORAGE_KEYS.COLOR_THEME, theme);
    dispatchSettingsChanged();
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
   * Runora-style: when a deck's insertion order changes, every NEW card of that deck
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

    // Runora-style positions ("due #") for the brand-new cards of this note
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
    const note = this.getNotes().find((n) => n.id === noteId);
    const cardsToDelete = this.getCards().filter((c) => c.noteId === noteId);
    if (!note && cardsToDelete.length === 0) return; // nada a apagar de verdade
    const notes = this.getNotes().filter((n) => n.id !== noteId);
    const cards = this.getCards().filter((c) => c.noteId !== noteId);
    this.saveNotes(notes);
    this.saveCards(cards);
    this.bumpDeletedAt();
    this.addTombstone('notes', [noteId]);
    if (cardsToDelete.length > 0) this.addTombstone('cards', cardsToDelete.map((c) => c.id));

    // Sync tombstones (Phase 7).
    // Deleção é mudança REAL de conteúdo: o contador precisa avançar, senão o
    // sync incremental entende "nada mudou" (currentUsn <= lastSyncedUsn) e o
    // aparelho sobe o BACKUP COMPLETO em vez do delta — e o tombstone
    // (usn > sinceUsn) nem entraria num delta pequeno. Os saves acima NÃO
    // avançam o contador numa deleção pura (os itens restantes são iguais).
    const usn = this.advanceUsnForDeletion();
    const deletedAt = Date.now();
    if (note) {
      this.addSyncTombstone('notes', { type: 'note', id: noteId, guid: note.guid, usn, deletedAt });
    }
    for (const card of cardsToDelete) {
      // a identidade do card entre aparelhos é (GUID da nota, ordem do template)
      this.addSyncTombstone('cards', {
        type: 'card',
        id: card.id,
        guid: note?.guid,
        templateOrd: card.templateOrd,
        usn,
        deletedAt,
      });
    }
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

    const notesToDelete = this.getNotes().filter((n) => deckIdsToDelete.has(n.deckId));
    const cardsToDelete = this.getCards().filter((c) => deckIdsToDelete.has(c.deckId));
    const notes = this.getNotes().filter((n) => !deckIdsToDelete.has(n.deckId));
    const cards = this.getCards().filter((c) => !deckIdsToDelete.has(c.deckId));
    this.saveNotes(notes);
    this.saveCards(cards);

    this.bumpDeletedAt();
    // Remember user deletions so seed version bumps never resurrect them
    this.addTombstone('decks', [...deckIdsToDelete]);
    if (notesToDelete.length > 0) this.addTombstone('notes', notesToDelete.map((n) => n.id));
    if (cardsToDelete.length > 0) this.addTombstone('cards', cardsToDelete.map((c) => c.id));

    // Sync tombstones (Phase 7) — deleção é mudança real: o contador avança
    // (ver deleteNote; sem isso o delete viraria backup completo no sync).
    const usn = this.advanceUsnForDeletion();
    const deletedAt = Date.now();
    for (const did of deckIdsToDelete) {
      const deck = decks.find((d) => d.id === did);
      // a identidade do deck entre aparelhos é o NOME
      this.addSyncTombstone('decks', { type: 'deck', id: did, name: deck?.name, usn, deletedAt });
    }
    for (const note of notesToDelete) {
      this.addSyncTombstone('notes', { type: 'note', id: note.id, guid: note.guid, usn, deletedAt });
    }
    const guidByNoteId = new Map(notesToDelete.map((n) => [n.id, n.guid]));
    for (const card of cardsToDelete) {
      this.addSyncTombstone('cards', {
        type: 'card',
        id: card.id,
        guid: guidByNoteId.get(card.noteId),
        templateOrd: card.templateOrd,
        usn,
        deletedAt,
      });
    }
  }

  // ---- Runora-style Daily Limits ----

  /** App-wide defaults, same as Runora: 20 new/day, 200 reviews/day */
  public static readonly DEFAULT_DAILY_LIMITS = { newCardsPerDay: 20, maxReviewsPerDay: 200 };

  /** Start of "today": Runora's rollover (default 4 AM) — a study at 2 AM still counts for yesterday. */
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
  /**
   * Todas as preferências do app (o bloco `runora_prefs`).
   * Usado pela Fase 5 do sync (preferências + temas vão para o Drive).
   */
  public static getPrefs(): Record<string, unknown> {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return {};
    try {
      const prefs = JSON.parse(raw);
      return prefs && typeof prefs === 'object' && !Array.isArray(prefs)
        ? (prefs as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  /** Grava preferências (mescla com as que já existiam). */
  public static mergePrefs(prefs: Record<string, unknown>): void {
    this.writePrefsRecord({ ...this.getPrefs(), ...prefs });
  }

  /** Grava o registro de preferências e avisa a tela (o Sync observa). */
  private static writePrefsRecord(prefs: Record<string, unknown>): void {
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
    dispatchSettingsChanged();
  }

  /** Rollover hour for "today" (Runora default: 4). */
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
    this.writePrefsRecord(prefs);
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

  /**
   * Replaces the whole CardBrowser field-display preference map.
   * An empty array is a VALID value: it means "the user deselected every
   * field" and must NOT fall back to the default (all fields selected).
   */
  public static setBrowserFieldPrefs(prefs: Record<string, string[]>): void {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    parsed.browserFields = prefs;
    this.writePrefsRecord(parsed);
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
    this.writePrefsRecord(prefs);
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
    this.writePrefsRecord(prefs);
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
    this.writePrefsRecord(prefs);
  }

  /** Valid values for the CardBrowser single-select maturity filter. */
  private static readonly BROWSER_MATURITY_VALUES = ['all', 'young', 'mature'];

  /** CardBrowser maturity filter ('all' | 'young' | 'mature'). 'all' = no restriction. */
  public static getBrowserMaturityFilter(): string {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return 'all';
    try {
      const prefs = JSON.parse(raw) as { browserMaturityFilter?: unknown };
      const v = prefs.browserMaturityFilter;
      return typeof v === 'string' && this.BROWSER_MATURITY_VALUES.includes(v) ? v : 'all';
    } catch {
      return 'all';
    }
  }

  public static setBrowserMaturityFilter(value: string): void {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    if (this.BROWSER_MATURITY_VALUES.includes(value)) {
      prefs.browserMaturityFilter = value;
    } else {
      delete prefs.browserMaturityFilter; // unknown value → fall back to 'all'
    }
    this.writePrefsRecord(prefs);
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
    this.writePrefsRecord(prefs);
  }

  // ---- Bulk operations (CardBrowser selection) ----
  // Tags live on NOTES (Runora semantics): operating on card ids maps to their
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

  /** Resolved limits for a deck: "This deck" override first, else the preset's. */
  public static getEffectiveDailyLimits(deckId: string): { newCardsPerDay: number; maxReviewsPerDay: number } {
    const deck = this.getDecks().find((d) => d.id === deckId);
    if (deck?.dailyLimitsOverride) {
      return {
        newCardsPerDay: deck.dailyLimitsOverride.newCardsPerDay,
        maxReviewsPerDay: deck.dailyLimitsOverride.maxReviewsPerDay,
      };
    }
    const limits = this.getDeckPreset(deckId).dailyLimits;
    return { newCardsPerDay: limits.newCardsPerDay, maxReviewsPerDay: limits.maxReviewsPerDay };
  }

  /**
   * How many new/review cards were already studied today across the deck's subtree.
   * A revlog entry counts as "new" when the card was New at review time (state 0),
   * and as "review" when it was in the Review queue (state 2) — learning/relearning
   * steps do not consume the review limit. This matches Runora exactly
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
   * Remaining allowance for a deck, Runora-style: its preset limits minus today's
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

  // ---- Runora-style Scheduler Config (Learning steps, Insertion order, Lapses) ----

  /**
   * Runora-style factory preset ("Padrão"): every option exactly like the app
   * defaults. Permanent — it can never be deleted; decks re-linked from a
   * deleted preset land here. Renaming is allowed, like in Runora.
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
    const now = Date.now();
    const comTimestamps = presets.map((p) => {
      if (p.usn) return p;
      const createdAt = p.createdAt ?? now;
      const updatedAt = p.updatedAt ?? now;
      return { ...p, createdAt, updatedAt };
    });
    const final = this.withFreshUsn(comTimestamps, this.readStored<Preset>(STORAGE_KEYS.PRESETS), now);
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(final));
  }

  public static getPresetById(presetId: string | null | undefined): Preset | null {
    return this.getPresets().find((p) => p.id === presetId) ?? null;
  }

  /** Preset que veio do Drive — identidade entre aparelhos: o NOME. */
  public static upsertPreset(preset: Preset): void {
    this.withoutUsnBump(() => {
      const presets = this.getPresets();
      const nome = preset.name?.trim();
      const idx = presets.findIndex((p) => p.name?.trim() === nome);
      if (idx >= 0) {
        const local = presets[idx];
        presets[idx] = { ...local, ...preset, id: local.id, updatedAt: Date.now() };
      } else {
        presets.push({ ...preset, updatedAt: Date.now() });
      }
      this.savePresets(presets);
    });
  }

  /** Delete a preset; every deck linked to it is re-linked to the factory preset. */
  public static deletePreset(presetId: string): void {
    if (presetId === this.DEFAULT_PRESET_ID) return; // the factory preset is permanent
    const presetName = this.getPresets().find((p) => p.id === presetId)?.name;
    if (!presetName) return; // nada a apagar de verdade
    this.savePresets(this.getPresets().filter((p) => p.id !== presetId));
    this.bumpDeletedAt();
    const decks = this.getDecks().map((d) =>
      d.presetId === presetId
        ? { ...d, presetId: this.DEFAULT_PRESET_ID, updatedAt: Date.now() }
        : d
    );
    this.saveDecks(decks);

    // Sync tombstone (Phase 7) — a identidade entre aparelhos é o NOME.
    // Deleção é mudança real: o contador avança (ver deleteNote).
    const usn = this.advanceUsnForDeletion();
    const deletedAt = Date.now();
    this.addSyncTombstone('presets', { type: 'preset', id: presetId, name: presetName, usn, deletedAt });
  }

  // ============================================================
  // Fase 7: Upsert/Delete helpers para sync incremental
  // ============================================================

  // ── Identidade entre aparelhos ──
  // O `id` de um item é LOCAL (cada aparelho cria o seu). A identidade que
  // atravessa os aparelhos é: GUID (nota), (GUID + ordem do template) (card)
  // e NOME (deck, tipo de nota, preset). Sem isso, um item que veio do Drive
  // pode acabar DUPLICADO aqui.

  /** Id local da nota com este GUID (identidade universal da nota). */
  public static findNoteIdByGuid(guid?: string): string | undefined {
    if (!guid) return undefined;
    const alvo = guid.trim();
    return this.getNotes().find((n) => n.guid?.trim() === alvo)?.id;
  }

  /** Id local do card com este (GUID da nota dona, ordem do template). */
  public static findCardIdByIdentity(
    noteGuid?: string,
    templateOrd?: number
  ): string | undefined {
    if (!noteGuid || templateOrd === undefined) return undefined;
    const noteId = this.findNoteIdByGuid(noteGuid);
    if (!noteId) return undefined;
    return this.getCards().find((c) => c.noteId === noteId && c.templateOrd === templateOrd)?.id;
  }

  /** Id local do deck com este nome. */
  public static findDeckIdByName(name?: string): string | undefined {
    if (!name) return undefined;
    const alvo = name.trim();
    return this.getDecks().find((d) => d.name?.trim() === alvo)?.id;
  }

  /** Id local do tipo de nota com este nome. */
  public static findNoteTypeIdByName(name?: string): string | undefined {
    if (!name) return undefined;
    const alvo = name.trim();
    return this.getNoteTypes().find((t) => t.name?.trim() === alvo)?.id;
  }

  /** Id local do preset com este nome. */
  public static findPresetIdByName(name?: string): string | undefined {
    if (!name) return undefined;
    const alvo = name.trim();
    return this.getPresets().find((p) => p.name?.trim() === alvo)?.id;
  }

  /**
   * Deck que veio do Drive.
   *
   * A identidade de um deck ENTRE APARELHOS é o NOME (o id é local de cada
   * aparelho). Casar pelo id criaria um deck DUPLICADO no outro aparelho.
   */
  public static upsertDeck(deck: Deck): void {
    this.withoutUsnBump(() => {
      const decks = this.getDecks();
      const nome = deck.name?.trim();
      const idx = decks.findIndex((d) => d.name?.trim() === nome);
      if (idx >= 0) {
        const local = decks[idx];
        decks[idx] = { ...local, ...deck, id: local.id, updatedAt: Date.now() };
      } else {
        decks.push({ ...deck, updatedAt: Date.now() });
      }
      this.saveDecks(decks);
    });
  }

  /** Tipo de nota que veio do Drive — identidade entre aparelhos: o NOME. */
  public static upsertNoteType(noteType: NoteType): void {
    this.withoutUsnBump(() => {
      const noteTypes = this.getNoteTypes();
      const nome = noteType.name?.trim();
      const idx = noteTypes.findIndex((nt) => nt.name?.trim() === nome);
      if (idx >= 0) {
        const local = noteTypes[idx];
        noteTypes[idx] = { ...local, ...noteType, id: local.id, updatedAt: Date.now() };
      } else {
        noteTypes.push({ ...noteType, updatedAt: Date.now() });
      }
      this.saveNoteTypes(noteTypes);
    });
  }

  /**
   * Nota que veio do Drive.
   *
   * A identidade de uma nota ENTRE APARELHOS é o GUID (o id é local de cada
   * aparelho — dois aparelhos que importaram o mesmo .apkg podem ter ids
   * diferentes para a MESMA nota). Casar pelo id criaria uma nota
   * DUPLICADA no outro aparelho.
   */
  public static upsertNote(note: Note): void {
    this.withoutUsnBump(() => {
      const notes = this.getNotes();
      const guid = note.guid?.trim();
      const idx = notes.findIndex((n) =>
        guid ? n.guid?.trim() === guid : n.id === note.id
      );
      if (idx >= 0) {
        const local = notes[idx];
        // o deck/tipo do outro aparelho pode ter outro id: se ele não existe
        // aqui, fica o que já estava (a nota não fica órfã).
        const decks = this.getDecks();
        const tipos = this.getNoteTypes();
        const deckId = decks.some((d) => d.id === note.deckId) ? note.deckId : local.deckId;
        const noteTypeId = tipos.some((t) => t.id === note.noteTypeId)
          ? note.noteTypeId
          : local.noteTypeId;
        notes[idx] = { ...local, ...note, id: local.id, deckId, noteTypeId, updatedAt: Date.now() };
      } else {
        notes.push({ ...note, updatedAt: Date.now() });
      }
      this.saveNotes(notes);
    });
  }

  /**
   * Card que veio do Drive.
   *
   * A identidade de um card ENTRE APARELHOS é (GUID da nota, ordem do
   * template) — o `noteId` do card é o id da nota NO APARELHO DE ORIGEM e
   * pode ser diferente aqui. `noteGuid` (quando o delta traz) é o GUID da
   * nota no aparelho de origem: é o que permite casar o card certo.
   */
  public static upsertCard(card: Card, noteGuid?: string): void {
    this.withoutUsnBump(() => {
      const cards = this.getCards();
      const notes = this.getNotes();
      const guidLocalDaNota = (noteId: string): string | undefined =>
        notes.find((n) => n.id === noteId)?.guid?.trim();
      const guid = noteGuid?.trim() ?? guidLocalDaNota(card.noteId);
      const idx = cards.findIndex((c) => {
        if (guid) {
          const guidCartao = guidLocalDaNota(c.noteId);
          return guidCartao === guid && c.templateOrd === card.templateOrd;
        }
        return c.id === card.id;
      });
      if (idx >= 0) {
        const local = cards[idx];
        cards[idx] = { ...local, ...card, id: local.id, noteId: local.noteId, updatedAt: Date.now() };
      } else {
        // card novo: o noteId precisa apontar para a nota LOCAL
        const notaLocal = guid
          ? notes.find((n) => n.guid?.trim() === guid)
          : notes.find((n) => n.id === card.noteId);
        cards.push({
          ...card,
          noteId: notaLocal?.id ?? card.noteId,
          updatedAt: Date.now(),
        });
      }
      this.saveCards(cards);
    });
  }

  public static deleteCard(cardId: string): void {
    const card = this.getCards().find((c) => c.id === cardId);
    if (!card) return; // nada a apagar de verdade
    this.saveCards(this.getCards().filter((c) => c.id !== cardId));
    this.bumpDeletedAt();
    this.addTombstone('cards', [cardId]);
    // Sync tombstone (Phase 7) — a identidade do card entre aparelhos é
    // (GUID da nota dona, ordem do template).
    // Deleção é mudança real: o contador avança (ver deleteNote).
    const usn = this.advanceUsnForDeletion();
    const deletedAt = Date.now();
    const noteGuid = card ? this.getNotes().find((n) => n.id === card.noteId)?.guid : undefined;
    this.addSyncTombstone('cards', {
      type: 'card',
      id: cardId,
      guid: noteGuid,
      templateOrd: card?.templateOrd,
      usn,
      deletedAt,
    });
  }

  public static deleteNoteType(noteTypeId: string): void {
    const noteType = this.getNoteTypes().find((nt) => nt.id === noteTypeId);
    if (!noteType) return; // nada a apagar de verdade
    this.saveNoteTypes(this.getNoteTypes().filter((nt) => nt.id !== noteTypeId));
    this.bumpDeletedAt();
    this.addTombstone('notetypes', [noteTypeId]);
    // Sync tombstone (Phase 7) — a identidade entre aparelhos é o NOME.
    // Deleção é mudança real: o contador avança (ver deleteNote).
    const usn = this.advanceUsnForDeletion();
    const deletedAt = Date.now();
    this.addSyncTombstone('notetypes', {
      type: 'notetype',
      id: noteTypeId,
      name: noteType?.name,
      usn,
      deletedAt,
    });
  }

  /** Create an empty preset with the app defaults (like Runora's "Add" preset option). */
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
    return this.getPresetForDeck(this.getDecks().find((d) => d.id === deckId));
  }

  /** The preset of a deck object, falling back to the factory preset. */
  private static getPresetForDeck(deck: Deck | undefined): Preset {
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
        w: deck.fsrsParams?.w,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Runora defaults: 1m 10m learning, sequential insertion, 10m relearning, leech at 8 lapses → suspend */
  public static readonly DEFAULT_SCHEDULER = {
    learningSteps: [1, 10] as number[], // minutes
    insertionOrder: 'sequential' as InsertionOrder,
    relearningSteps: [10] as number[],  // minutes
    leechThreshold: 8,
    leechAction: 'suspend' as LeechAction,
  };

  /**
   * Parse Runora-style step strings into minutes: "1m 10m", "30s 5m 1h 1d",
   * "1m30s", or bare minutes "1 10".
   *
   * A single step may combine several units in one token ("1m30s" is one step
   * of 1.5 minutes). Months ("mo") are not valid steps — a learning step of a
   * month would be pointless.
   *
   * Invalid/empty input → null.
   */
  public static parseSteps(input: string): number[] | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const minutes: number[] = [];
    for (const token of trimmed.split(/\s+/)) {
      const asMinutes = this.parseStepToken(token);
      if (asMinutes === null || !(asMinutes > 0)) return null;
      minutes.push(asMinutes);
    }
    return minutes.length > 0 ? minutes : null;
  }

  /**
   * A single step: one or more "value + unit" parts added together, e.g.
   * "1m30s" (1.5 minutes). A part without a unit counts as minutes, and "min"
   * is accepted as a spelled-out "m".
   */
  private static parseStepToken(token: string): number | null {
    const pattern = /(\d+(?:[.,]\d+)?)\s*([a-z]*)/gi;
    let match: RegExpExecArray | null;
    let minutes = 0;
    let consumed = 0;
    while ((match = pattern.exec(token)) !== null) {
      if (match.index !== consumed) return null;
      const value = parseFloat(match[1].replace(',', '.'));
      const unit = match[2].toLowerCase();
      const factor =
        unit === '' || unit === 'm' || unit === 'min'
          ? 1
          : unit === 's'
            ? 1 / 60
            : unit === 'h'
              ? 60
              : unit === 'd'
                ? 1440
                : null;
      if (factor === null || !Number.isFinite(value)) return null;
      minutes += value * factor;
      consumed = match.index + match[0].length;
    }
    if (consumed === 0 || consumed !== token.length) return null;
    return minutes;
  }

  /** Format minutes[] back into a steps string: [1, 10] → "1m 10m" */
  public static formatSteps(minutes: number[]): string {
    return minutes.map((min) => formatTimespanMinutes(min, 'd')).join(' ');
  }

  /**
   * The learning steps the way Anki stores them: whole minutes.
   *
   * Anki's `delays` are integers, so a compound step ("1m30s") is rounded to
   * the nearest minute. This is what ends up in the exported deck config.
   */
  public static stepsToAnkiMinutes(steps: string | null | undefined): number[] {
    if (!steps) return [];
    const parsed = this.parseSteps(steps);
    if (!parsed || parsed.length === 0) return [1, 10];
    return parsed.map((minutes) => Math.round(minutes));
  }

  // ---- FSRS scopes (global → preset → deck) ----

  /**
   * The FSRS parameters that actually apply to a deck.
   *
   * Three layers, resolved in the same order Anki resolves them:
   *
   *   1. global  — `getFSRSSettings()` (the app-wide FSRS sheet)
   *   2. preset  — the "Deck Options" sheet the deck follows
   *   3. deck    — the deck's own "This deck" overrides
   *
   * The FSRS weights (`w`) are only replaced by a layer that actually
   * defines them, so a preset that only customises the retention keeps
   * inheriting the global weights — and with them the trainable decay (w[20]).
   */
  public static getEffectiveFSRSParams(deckId: string): FSRSParameters {
    return this.getEffectiveFSRSParamsForDeck(
      this.getDecks().find((d) => d.id === deckId)
    );
  }

  /**
   * The same resolution, for a deck object already in hand.
   *
   * The browser lists cards from many decks at once and needs one engine
   * per deck; passing the deck avoids re-reading the storage for each one.
   */
  public static getEffectiveFSRSParamsForDeck(deck: Deck | undefined): FSRSParameters {
    return this.resolveFSRSParams(
      this.getPresetForDeck(deck).fsrsParams,
      deck?.fsrsOverride ?? null
    );
  }

  /** The deck's own "This deck" FSRS overrides, if it has any. */
  public static getDeckFSRSOverride(deckId: string): FSRSScope | null {
    const deck = this.getDecks().find((d) => d.id === deckId);
    return deck?.fsrsOverride ?? null;
  }

  /**
   * Merges the FSRS scopes on top of the global settings.
   *
   * Exposed as a pure-ish helper so the resolution can be unit tested and
   * reused by the exporters/importers without touching the storage.
   */
  public static resolveFSRSParams(
    presetScope?: Partial<FSRSScope> | null,
    deckScope?: Partial<FSRSScope> | null
  ): FSRSParameters {
    const params: FSRSParameters = { ...this.getFSRSSettings() };
    for (const scope of [presetScope, deckScope]) {
      if (!scope) continue;
      if (typeof scope.requestRetention === 'number' && Number.isFinite(scope.requestRetention)) {
        params.requestRetention = scope.requestRetention;
      }
      if (
        typeof scope.maximumInterval === 'number' &&
        Number.isFinite(scope.maximumInterval) &&
        scope.maximumInterval > 0
      ) {
        params.maximumInterval = scope.maximumInterval;
      }
      if (Array.isArray(scope.w) && scope.w.length >= FSRS_WEIGHT_COUNT_MIN) {
        params.w = [...scope.w];
      }
    }
    return params;
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

  // ---- Runora-style Display Order ----

  /** Runora defaults for Display Order */
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

  // ---- Runora-style Audio Config ----

  /** Runora default: audio plays automatically (disableAutoplay = false) */
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
   * Counts are capped by the daily limits still available today, like Runora's deck list.
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

    // "Today" follows the app's rollover hour: same-day learning cards (due now
    // or later today, e.g. +10 min after answering Good) must still show in the
    // learning count — otherwise a rated card would vanish from the deck list.
    const dayEnd = this.todayStart(now) + 86400000;

    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    for (const card of cards) {
      if (card.fsrs.state === 0) {
        newCount++;
      } else if (card.fsrs.state === 1 || card.fsrs.state === 3) {
        if (card.due <= dayEnd) {
          learningCount++;
        } else {
          // Interday learning (due on a later day) counts as review, like Runora
          reviewCount++;
        }
      } else if (card.fsrs.state === 2) {
        if (card.due <= now) {
          reviewCount++;
        }
      }
    }

    // Cap displayed counts by today's remaining limits, like Runora's deck list
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
