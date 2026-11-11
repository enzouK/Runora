/**
 * Runora Core Data Types
 * Designed for compatibility with legacy external collection schemas and the FSRS scheduler.
 */

export type FSRSRating = 1 | 2 | 3 | 4; // 1: Again, 2: Hard, 3: Good, 4: Easy
export type CardState = 0 | 1 | 2 | 3;  // 0: New, 1: Learning, 2: Review, 3: Relearning

export interface FSRSParameters {
  requestRetention: number;    // Desired retention rate (e.g., 0.90)
  maximumInterval: number;     // Maximum interval in days (e.g., 36500)
  w: number[];                 // 19 parameters w[0]..w[18] (FSRS-5) or 21 w[0]..w[20] (FSRS-6)
  enableFuzz: boolean;         // Slight interval randomization to avoid card bunching
}

/**
 * The FSRS options that can be scoped to a preset and overridden per deck.
 *
 * `w` holds the FSRS weights — the same array Anki stores as `fsrs_params_6`
 * (21 values, with the trainable decay in `w[20]`). It is optional: when a
 * scope leaves it out, the deck inherits the weights from the layer above
 * (deck override → preset → global settings).
 */
export interface FSRSScope {
  requestRetention: number;    // Desired retention rate (e.g., 0.90)
  maximumInterval: number;     // Maximum interval in days (e.g., 36500)
  w?: number[];                // FSRS weights — 19 (FSRS-5) or 21 (FSRS-6)
}

export interface FSRSCardData {
  stability: number;           // S: Memory stability in days
  difficulty: number;          // D: Difficulty from 1.0 to 10.0
  elapsedDays: number;         // Days since last review
  scheduledDays: number;       // Scheduled interval
  reps: number;                // Total repetition count
  lapses: number;              // Number of times card was forgotten (Again in Review)
  state: CardState;            // 0: New, 1: Learning, 2: Review, 3: Relearning
  lastReview: number | null;   // Timestamp of last review (ms)
}

export interface FieldDefinition {
  id: string;
  name: string;
  ord: number;
  description?: string;
}

export interface CardTemplate {
  id: string;
  name: string;
  ord: number;
  qfmt: string; // Front HTML template e.g. {{Front}} or {{cloze:Text}}
  afmt: string; // Back HTML template e.g. {{FrontSide}}<hr id="answer">{{Back}}
}

export interface NoteType {
  id: string;
  name: string;
  fields: FieldDefinition[];
  templates: CardTemplate[];
  css: string;
  isCloze: boolean;
  // Specific Runora features configured per Note Type:
  hintsEnabled: boolean;           // Show "Show Hint" button on front of card
  voiceRecordingEnabled: boolean;  // Show "Record Voice" on front of card
  furiganaEnabled: boolean;        // Ativa {{furigana:Campo}} no template
  createdAt: number;
  updatedAt: number;
  /** Update Sequence Number — incrementa a cada mudança. Usado no sync incremental. Opcional para dados legados (preenchido pelo backfill). */
  usn?: number;
}

export interface MediaAttachment {
  id: string;
  name: string;
  type: 'image' | 'audio';
  dataUrl: string; // Base64 or Blob URL
  createdAt: number;
}

export interface Note {
  id: string;
  /**
   * Identidade universal da nota ("RG"): sobrevive a exportações e
   * sincronizações entre dispositivos. Notas vindas do Anki carregam o
   * GUID do próprio Anki; notas criadas no Runora recebem um GUID
   * gerado na criação. Opcional só para bases antigas — o backfill
   * (noteIdentity.ensureNoteGuids) preenche na primeira importação,
   * exportação ou abertura do app depois de introduzido.
   */
  guid?: string;
  noteTypeId: string;
  deckId: string;
  fields: Record<string, string>; // fieldId -> HTML/Text content
  media: MediaAttachment[];      // Attached or embedded media
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Update Sequence Number — incrementa a cada mudança. Usado no sync incremental. Opcional para dados legados. */
  usn?: number;
}

export interface Card {
  id: string;
  noteId: string;
  deckId: string;
  templateOrd: number;           // Ordinal index of template or cloze index
  due: number;                   // Due timestamp in ms
  fsrs: FSRSCardData;
  position?: number;             // Runora "due #": fixed queue slot for new cards (states 0)
  learningStep?: number;         // Current index into learning/relearning steps (states 1/3)
  suspended?: boolean;           // Suspended cards never appear in queues/counts (leech/manual)
  createdAt: number;
  updatedAt: number;
  /** Update Sequence Number — incrementa a cada mudança. Usado no sync incremental. Opcional para dados legados. */
  usn?: number;
}

export interface DailyLimits {
  // null = inherit from parent (or app default at the root)
  newCardsPerDay: number | null;
  maxReviewsPerDay: number | null;
}

export type InsertionOrder = 'sequential' | 'random';
export type LeechAction = 'suspend' | 'tag';

/**
 * Runora-style deck options for New Cards and Lapses.
 * null = inherit from parent deck (or app default at the root).
 */
export interface SchedulerConfig {
  learningSteps: string | null;    // "1m 10m" — steps for new cards
  insertionOrder: InsertionOrder | null; // order new cards are introduced
  relearningSteps: string | null;  // "10m" — steps after a lapse
  leechThreshold: number | null;   // lapses before leech action (Runora default: 8)
  leechAction: LeechAction | null; // what to do with leeches (Runora default: suspend)
}

// ---- Display Order (Runora) ----
export type NewGatherOrder =
  | 'deck'
  | 'positionAsc'
  | 'positionDesc'
  | 'random'
  | 'deckThenRandomNotes'
  | 'randomNotes';
export type NewSortOrder =
  | 'gathered'
  | 'template'
  | 'random'
  | 'templateRandom'
  | 'noteThenCardType';
export type MixOrder = 'mix' | 'before' | 'after';
export type ReviewSortOrder =
  | 'dueRandom'
  | 'dueAsc'
  | 'dueDesc'
  | 'dueDeck'
  | 'deckThenDue'
  | 'intervalAsc'
  | 'intervalDesc'
  | 'easeAsc'
  | 'easeDesc'
  | 'retrievabilityAsc'
  | 'random';

/**
 * Runora-style Display Order options. null = inherit from parent (or app default at root).
 */
export interface DisplayOrderConfig {
  newGatherOrder: NewGatherOrder | null;   // Runora default: deck
  newSortOrder: NewSortOrder | null;       // Runora default: card type, then gathered
  newReviewOrder: MixOrder | null;         // Runora default: mix with reviews
  learnReviewOrder: MixOrder | null;       // Runora default: mix with reviews
  reviewSortOrder: ReviewSortOrder | null; // Runora default: due date, then random
}

export interface Deck {
  id: string;
  name: string;                  // Supports hierarchy with "::" e.g. "Languages::Japanese::N5"
  description: string;
  collapsed?: boolean;
  presetId?: string;             // Options preset this deck follows (see Preset)
  // Runora-style "This deck" scopes: when set, they take priority over the preset
  dailyLimitsOverride?: { newCardsPerDay: number; maxReviewsPerDay: number }; // Daily Limits scoped to "This deck"
  fsrsOverride?: FSRSScope;                // FSRS scoped to "This deck"
  fsrsParams?: Partial<FSRSParameters>; // Custom deck-specific FSRS overrides if any
  dailyLimits?: DailyLimits;     // Runora-style daily limits (legacy mirror of the preset)
  schedulerConfig?: SchedulerConfig; // Runora-style New Cards / Lapses options
  displayOrder?: DisplayOrderConfig; // Runora-style Display Order options
  audioConfig?: AudioConfig;       // Runora-style Audio options (autoplay)
  createdAt: number;
  updatedAt: number;
  /** Update Sequence Number — incrementa a cada mudança. Usado no sync incremental. Opcional para dados legados. */
  usn?: number;
}

/**
 * Runora-style preset: a shareable sheet of deck options ("Deck Options preset").
 * A deck links to exactly one preset via `presetId`; editing a preset updates
 * every deck linked to it, regardless of the deck tree (parent/child agnostic).
 */
export interface Preset {
  id: string;
  name: string;
  dailyLimits: {
    newCardsPerDay: number;
    maxReviewsPerDay: number;
  };
  schedulerConfig: {
    learningSteps: string;        // "1m 10m" — steps for new cards
    insertionOrder: InsertionOrder;
    relearningSteps: string;      // "10m" — steps after a lapse
    leechThreshold: number;       // lapses before leech action (Runora default: 8)
    leechAction: LeechAction;     // what to do with leeches (Runora default: suspend)
  };
  displayOrder: DisplayOrderConfig;
  audioConfig: AudioConfig;
  fsrsParams: FSRSScope;         // Runora "desired retention" + max. days per interval (+ optional FSRS weights)
  createdAt: number;
  updatedAt: number;
  /** Update Sequence Number — incrementa a cada mudança. Usado no sync incremental. Opcional para dados legados. */
  usn?: number;
}

/**
 * Runora-style Audio options. null = inherit from parent deck (or app default at root).
 */
export interface AudioConfig {
  disableAutoplay: boolean | null; // Runora: "Don't play audio automatically" (default: false)
}

export interface RevlogEntry {
  id: string;
  cardId: string;
  noteId: string;
  rating: FSRSRating;
  reviewTime: number;            // Timestamp in ms
  elapsedDays: number;
  scheduledDays: number;
  state: CardState;
  stability: number;
  difficulty: number;
  /** Update Sequence Number — incrementa a cada mudança. Usado no sync incremental. Opcional para dados legados. */
  usn?: number;
}

export interface DeckCounts {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  totalCount: number;
}

export interface FSRSPrediction {
  rating: FSRSRating;
  intervalDays: number;
  intervalText: string;
  stability: number;
  difficulty: number;
  state: CardState;
}

/**
 * Tombstones — marcadores de exclusão para sync incremental.
 * Quando um item é deletado, criamos um tombstone com o USN da exclusão.
 * Isso permite que outros dispositivos saibam que o item foi removido.
 */
export interface Tombstone {
  /** Tipo da entidade deletada. */
  type: 'deck' | 'notetype' | 'note' | 'card' | 'revlog' | 'preset';
  /** ID da entidade deletada (o `id` original — LOCAL deste aparelho). */
  id: string;
  /**
   * Identidade entre aparelhos (o `id` é local de cada aparelho):
   * - nota: o GUID da nota
   * - card: o GUID da nota dona do card
   * - deck/tipo/preset: o NOME
   */
  guid?: string;
  /** Ordem do template do card deletado (a identidade do card). */
  templateOrd?: number;
  /** Nome do deck/tipo/preset deletado (a identidade entre aparelhos). */
  name?: string;
  /** USN da exclusão. */
  usn: number;
  /** Timestamp da exclusão. */
  deletedAt: number;
}

/** Tipo união de todas as entidades sincronizáveis (para helpers genéricos). */
export type SyncableEntity = Deck | NoteType | Note | Card | RevlogEntry | Preset;

/** Verifica se um objeto tem USN (é uma entidade sincronizável). */
export function hasUsn(obj: unknown): obj is SyncableEntity {
  return typeof obj === 'object' && obj !== null && 'usn' in obj && typeof (obj as Record<string, unknown>).usn === 'number';
}
