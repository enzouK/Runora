/**
 * Reading the FSRS state that Anki stores inside a collection.
 *
 * When Anki exports a deck with scheduling information (`.apkg` with
 * "Include scheduling information"), the FSRS state of every card travels in
 * the JSON blob of the `cards.data` column (schema 18):
 *
 *   {"pos":10,"s":20.3746,"d":7.342,"dr":0.9,"decay":0.154,"lrt":1792897026}
 *      │        │        │         │       │         │
 *      │        │        │         │       │         └─ last review (unix seconds)
 *      │        │        │         │       └─────────── FSRS-6 decay
 *      │        │        │         └─────────────────── desired retention
 *      │        │        └───────────────────────────── difficulty (raw 1..10)
 *      │        └────────────────────────────────────── stability (days)
 *      └─────────────────────────────────────────────── original position
 *
 * The keys are defined in Anki's `rslib/src/storage/card/data.rs`:
 *
 *   #[serde(rename = "s")] pub(crate) fsrs_stability: Option<f32>,
 *   #[serde(rename = "d")] pub(crate) fsrs_difficulty: Option<f32>,
 *
 * Older collections (schema 11) have no FSRS state there — the difficulty then
 * only survives in the revlog, where Anki stores the *shifted* difficulty
 * (`rslib/src/revlog/mod.rs`):
 *
 *   ease_factor = (difficulty_shifted() * 1000.) as u16
 *   difficulty_shifted() = (difficulty - 1.0) / 9.0 + 0.1
 *
 * which is exactly the inverse Anki itself uses to rebuild a card's
 * difficulty from its review history
 * (`rslib/src/scheduler/fsrs/memory_state.rs`):
 *
 *   if first_review.ease_factor <= 1.1 {
 *       starting_state.difficulty = (first_review.ease_factor - 0.1) * 9.0 + 1.0;
 *   }
 */

import { CardState } from '../types/runora';

/** Lowest raw FSRS difficulty (Anki's normalized value is 0%). */
export const ANKI_DIFFICULTY_MIN = 1;

/** Highest raw FSRS difficulty (Anki's normalized value is 100%). */
export const ANKI_DIFFICULTY_MAX = 10;

/**
 * Neutral difficulty used for imported cards whose FSRS difficulty is unknown
 * (legacy SM-2 collections that carry no FSRS state at all). It is the
 * midpoint of the 1..10 range, so the FSRS formulas stay numerically sane.
 */
export const DEFAULT_IMPORTED_DIFFICULTY = 5;

/**
 * Lowest revlog `factor` that still belongs to the FSRS range.
 * The factor is `difficulty_shifted() * 1000`, and D = 1 shifts to 0.1 → 100.
 */
export const ANKI_REVLOG_FACTOR_MIN = 100;

/**
 * Highest revlog `factor` that still belongs to the FSRS range.
 * D = 10 shifts to 1.1 → 1100. Anything above that is a legacy SM-2 ease
 * factor (Anki's own check is `ease_factor <= 1.1`).
 */
export const ANKI_REVLOG_FACTOR_MAX = 1100;

/** FSRS state extracted from the `cards.data` JSON blob. */
export interface AnkiCardFsrsData {
  /** FSRS difficulty, raw 1..10 (Anki's `d`). */
  difficulty?: number;
  /** FSRS stability, in days (Anki's `s`). */
  stability?: number;
  /** Last review time, in unix seconds (Anki's `lrt`). */
  lastReviewSeconds?: number;
}

/**
 * Parses the `cards.data` JSON blob and extracts the FSRS state.
 *
 * Never throws: a missing, empty or malformed blob simply yields no state,
 * so the caller can fall back to the revlog / default values.
 */
export function parseAnkiCardFsrsData(raw: unknown): AnkiCardFsrsData {
  const result: AnkiCardFsrsData = {};
  if (typeof raw !== 'string' || raw.trim() === '') return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== 'object') return result;

  const record = parsed as Record<string, unknown>;

  const d = Number(record.d);
  if (Number.isFinite(d) && d >= ANKI_DIFFICULTY_MIN && d <= ANKI_DIFFICULTY_MAX) {
    result.difficulty = d;
  }

  const s = Number(record.s);
  if (Number.isFinite(s) && s > 0) {
    result.stability = s;
  }

  const lrt = Number(record.lrt);
  if (Number.isFinite(lrt) && lrt > 0) {
    result.lastReviewSeconds = lrt;
  }

  return result;
}

/**
 * Converts an Anki revlog `factor` back into the raw FSRS difficulty.
 *
 *   D = (factor / 1000 − 0.1) × 9 + 1
 *
 * Returns null when the factor is not an FSRS difficulty (a legacy SM-2 ease
 * factor, or the 0 used by manual reschedules).
 */
export function difficultyFromRevlogFactor(factor: unknown): number | null {
  const f = Number(factor);
  if (!Number.isFinite(f)) return null;
  if (f < ANKI_REVLOG_FACTOR_MIN || f > ANKI_REVLOG_FACTOR_MAX) return null;
  const d = (f / 1000 - 0.1) * 9 + 1;
  if (!Number.isFinite(d)) return null;
  return Math.min(ANKI_DIFFICULTY_MAX, Math.max(ANKI_DIFFICULTY_MIN, d));
}

/**
 * Builds a `cardId → difficulty` map from Anki revlog rows.
 *
 * Each row must be `[cid, factor]` and the rows must be ordered by review
 * id ascending, so the last valid factor of a card wins — that is the card's
 * current difficulty, which is what Anki itself shows in the browser.
 */
export function collectRevlogDifficulties(rows: unknown[][]): Map<number, number> {
  const byCard = new Map<number, number>();
  for (const row of rows) {
    const cid = Number(row[0]);
    const difficulty = difficultyFromRevlogFactor(row[1]);
    if (!Number.isFinite(cid) || difficulty === null) continue;
    byCard.set(cid, difficulty);
  }
  return byCard;
}

/** The FSRS state of an imported card, as Runora stores it. */
export interface ImportedFsrsState {
  /** Memory stability, in days. */
  stability: number;
  /** Raw difficulty, 1..10 (0 = never reviewed). */
  difficulty: number;
  /** Days elapsed since the last review. */
  elapsedDays: number;
  /** The interval the card was scheduled with, in days. */
  scheduledDays: number;
  /** Number of reviews. */
  reps: number;
  /** Number of times the card was forgotten. */
  lapses: number;
  /** Runora's card state (0 new, 1 learning, 2 review, 3 relearning). */
  state: CardState;
  /** Last review timestamp in milliseconds, or null when unknown. */
  lastReview: number | null;
}

/** Everything needed to rebuild a card's FSRS state from an Anki row. */
export interface AnkiCardFsrsInput {
  /** Anki's card type (0 new, 1 learning, 2 review, 3 relearning). */
  ankiType: number;
  /** The card's interval in days (negative for intraday learning steps). */
  ivlDays: number;
  /** The card's due date, in milliseconds. */
  dueMs: number;
  /** Anki's review count. */
  reps: number;
  /** Anki's lapse count. */
  lapses: number;
  /** The raw `cards.data` column. */
  data: unknown;
  /** Difficulty recovered from the revlog, when the collection has no FSRS state. */
  revlogDifficulty?: number;
  /** Current time, in milliseconds. */
  now: number;
}

/**
 * Rebuilds the FSRS state of an imported card from the row Anki stored.
 *
 * Precedence for the difficulty: `cards.data` → revlog factor → neutral
 * default (a card that was never reviewed keeps D = 0, which the UI renders
 * as "—", just like a fresh Runora card).
 */
export function deriveImportedFsrsState(input: AnkiCardFsrsInput): ImportedFsrsState {
  const { ankiType, ivlDays, dueMs, reps, lapses, data, revlogDifficulty, now } = input;

  const state: CardState = ankiType === 2 ? 2 : ankiType === 0 ? 0 : ankiType === 3 ? 3 : 1;
  const fsrsData = parseAnkiCardFsrsData(data);

  const difficulty =
    fsrsData.difficulty ??
    revlogDifficulty ??
    (state === 0 ? 0 : DEFAULT_IMPORTED_DIFFICULTY);

  const stability =
    fsrsData.stability ?? Math.max(0.1, ivlDays > 0 ? ivlDays : 0.4);

  // Last review: Anki's real timestamp (unix seconds), else estimated from
  // the due date so retrievability/intervals behave sanely.
  const lastReview =
    fsrsData.lastReviewSeconds !== undefined
      ? fsrsData.lastReviewSeconds * 1000
      : state === 2 && ivlDays > 0
        ? dueMs - ivlDays * 86400000
        : null;

  // Elapsed days since that review — the value the browser's retrievability
  // (R%) and the scheduler both rely on.
  const elapsedDays = lastReview
    ? Math.max(0, (now - lastReview) / 86400000)
    : ivlDays > 0
      ? ivlDays
      : 0;

  return {
    stability,
    difficulty,
    elapsedDays,
    scheduledDays: Math.max(1, ivlDays),
    reps: Number(reps) || 0,
    lapses: Number(lapses) || 0,
    state,
    lastReview,
  };
}
