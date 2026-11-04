/**
 * FSRS Difficulty (D) ↔ percentage, with exact Anki parity.
 *
 * The Anki browser shows the FSRS difficulty as a percentage, but the value
 * it stores is the raw D in the 1.0–10.0 range. The conversion lives in
 * `rslib/src/card/mod.rs` (rslib/src/card/mod.rs, `FsrsMemoryState::difficulty`):
 *
 *   fn difficulty(&self) -> f32 {
 *       (self.difficulty - 1.0) / 9.0   // 1.0 → 0.0, 10.0 → 1.0
 *   }
 *
 * and `rslib/src/browser_table.rs` renders it with:
 *
 *   format!("{:.0}%", s.difficulty() * 100.0)
 *
 * So the percentage is `(D − 1) / 9 × 100`, rounded to the nearest integer.
 *
 * IMPORTANT — the direction is the opposite of the legacy SM-2 "Ease":
 * in FSRS, a HIGHER D means a HARDER card. Answering "Again" raises D,
 * answering "Easy" lowers it (see `fsrs::next_difficulty`).
 */

/** Lowest raw FSRS difficulty (Anki's normalized value is 0%). */
export const DIFFICULTY_MIN = 1.0;

/** Highest raw FSRS difficulty (Anki's normalized value is 100%). */
export const DIFFICULTY_MAX = 10.0;

/**
 * Converts a raw FSRS difficulty (1.0–10.0) to Anki's 0–100 percentage.
 * Values outside the valid range are clamped, mirroring what Anki shows.
 *
 * @example difficultyToPercent(1) === 0
 * @example difficultyToPercent(5.5) === 50
 * @example difficultyToPercent(10) === 100
 */
export function difficultyToPercent(difficulty: number): number {
  if (!Number.isFinite(difficulty)) return 0;
  const clamped = Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, difficulty));
  return ((clamped - DIFFICULTY_MIN) / (DIFFICULTY_MAX - DIFFICULTY_MIN)) * 100;
}

/**
 * Converts a raw FSRS difficulty to the percentage string shown in the UI,
 * rounded to the nearest integer and suffixed with "%" (e.g. "44%").
 */
export function formatDifficultyPercent(difficulty: number): string {
  return `${Math.round(difficultyToPercent(difficulty))}%`;
}

/**
 * True when the card carries a meaningful difficulty value.
 * Cards that were never reviewed keep `difficulty: 0`, which is outside the
 * 1.0–10.0 FSRS range and must not be shown as a percentage.
 */
export function hasDifficulty(difficulty: number): boolean {
  return Number.isFinite(difficulty) && difficulty >= DIFFICULTY_MIN;
}
