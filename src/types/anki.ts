/**
 * Anki 2.0 Core Data Types
 * Designed for full compatibility with Anki database schemas and FSRS scheduler.
 */

export type FSRSRating = 1 | 2 | 3 | 4; // 1: Again, 2: Hard, 3: Good, 4: Easy
export type CardState = 0 | 1 | 2 | 3;  // 0: New, 1: Learning, 2: Review, 3: Relearning

export interface FSRSParameters {
  requestRetention: number;    // Desired retention rate (e.g., 0.90)
  maximumInterval: number;     // Maximum interval in days (e.g., 36500)
  w: number[];                 // 19 parameters w[0]..w[18]
  enableFuzz: boolean;         // Slight interval randomization to avoid card bunching
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
  // Specific Anki 2.0 features configured per Note Type:
  hintsEnabled: boolean;           // Show "Show Hint" button on front of card
  voiceRecordingEnabled: boolean;  // Show "Record Voice" on front of card
  createdAt: number;
  updatedAt: number;
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
  noteTypeId: string;
  deckId: string;
  fields: Record<string, string>; // fieldId -> HTML/Text content
  media: MediaAttachment[];      // Attached or embedded media
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: string;
  noteId: string;
  deckId: string;
  templateOrd: number;           // Ordinal index of template or cloze index
  due: number;                   // Due timestamp in ms
  fsrs: FSRSCardData;
  learningStep?: number;         // Current index into learning/relearning steps (states 1/3)
  suspended?: boolean;           // Suspended cards never appear in queues/counts (leech/manual)
  createdAt: number;
  updatedAt: number;
}

export interface DailyLimits {
  // null = inherit from parent (or app default at the root)
  newCardsPerDay: number | null;
  maxReviewsPerDay: number | null;
}

export type InsertionOrder = 'sequential' | 'random';
export type LeechAction = 'suspend' | 'tag';

/**
 * Anki-style deck options for New Cards and Lapses.
 * null = inherit from parent deck (or app default at the root).
 */
export interface SchedulerConfig {
  learningSteps: string | null;    // "1m 10m" — steps for new cards
  insertionOrder: InsertionOrder | null; // order new cards are introduced
  relearningSteps: string | null;  // "10m" — steps after a lapse
  leechThreshold: number | null;   // lapses before leech action (Anki default: 8)
  leechAction: LeechAction | null; // what to do with leeches (Anki default: suspend)
}

// ---- Display Order (Anki) ----
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
 * Anki-style Display Order options. null = inherit from parent (or app default at root).
 */
export interface DisplayOrderConfig {
  newGatherOrder: NewGatherOrder | null;   // Anki default: deck
  newSortOrder: NewSortOrder | null;       // Anki default: card type, then gathered
  newReviewOrder: MixOrder | null;         // Anki default: mix with reviews
  learnReviewOrder: MixOrder | null;       // Anki default: mix with reviews
  reviewSortOrder: ReviewSortOrder | null; // Anki default: due date, then random
}

export interface Deck {
  id: string;
  name: string;                  // Supports hierarchy with "::" e.g. "Languages::Japanese::N5"
  description: string;
  collapsed?: boolean;
  fsrsParams?: Partial<FSRSParameters>; // Custom deck-specific FSRS overrides if any
  dailyLimits?: DailyLimits;     // Anki-style daily limits (affect this deck + subdecks)
  schedulerConfig?: SchedulerConfig; // Anki-style New Cards / Lapses options
  displayOrder?: DisplayOrderConfig; // Anki-style Display Order options
  audioConfig?: AudioConfig;       // Anki-style Audio options (autoplay)
  createdAt: number;
  updatedAt: number;
}

/**
 * Anki-style Audio options. null = inherit from parent deck (or app default at root).
 */
export interface AudioConfig {
  disableAutoplay: boolean | null; // Anki: "Don't play audio automatically" (default: false)
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
