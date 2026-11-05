/**
 * Helpers for the FSRS weight array (`w`).
 *
 * The weight array is the heart of the FSRS scheduler: 21 values for FSRS-6
 * (`w[0]`..`w[20]`, with the trainable decay in `w[20]`) or 19 values for
 * FSRS-5 (`w[0]`..`w[18]`).
 *
 * Anki stores the very same array per deck options group — as
 * `fsrs_params_6` (or `fsrs_params_5`) in the schema-18 `deck_config` table,
 * and as `fsrsParams6` / `fsrsParams5` in the legacy `col.dconf` JSON — so
 * the values can travel between the two apps untouched.
 */

import {
  DEFAULT_FSRS_WEIGHTS,
  FSRS_5_WEIGHT_COUNT,
  FSRS_6_WEIGHT_COUNT,
  FSRS_WEIGHT_COUNT_MIN,
} from './constants';

/**
 * Parses a pasted list of FSRS weights.
 *
 * Accepts the formats the FSRS optimizer and Anki itself produce: values
 * separated by whitespace, commas or semicolons — optionally wrapped in
 * brackets or parentheses.
 *
 * Returns null when the input does not hold a valid parameter set (wrong
 * count, non-numeric entries), so the caller can reject the paste instead of
 * storing a broken configuration.
 */
export function parseFsrsWeights(text: string): number[] | null {
  const cleaned = text
    .replace(/[[\]()]/g, ' ')
    .trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/[\s,;]+/).filter((p) => p !== '');
  if (parts.length < FSRS_WEIGHT_COUNT_MIN) return null;

  const values: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    values.push(n);
  }

  if (values.length !== FSRS_5_WEIGHT_COUNT && values.length !== FSRS_6_WEIGHT_COUNT) {
    return null;
  }
  return values;
}

/** A human-readable label for each weight, used by the editor UI. */
export const FSRS_WEIGHT_LABELS: string[] = [
  'S₀(Again)',
  'S₀(Hard)',
  'S₀(Good)',
  'S₀(Easy)',
  'D₀ base',
  'D₀ escala',
  'ΔD (Again)',
  'ΔD (Easy)',
  'ΔS (recuperação)',
  'ΔS (decaimento)',
  'ΔS (difícil)',
  'ΔS (fácil)',
  'ΔS (esquecimento)',
  'ΔS (revisão)',
  'ΔS (reaprendizado)',
  'D (Hard)',
  'D (Easy)',
  'S (mesmo dia)',
  'S (mesmo dia)',
  'S (mesmo dia)',
  'Decay',
];

/**
 * The weights a scope inherits when it does not define its own.
 * Falls back to the global settings, and finally to the official defaults.
 */
export function inheritedWeights(globalWeights?: number[] | null): number[] {
  if (Array.isArray(globalWeights) && globalWeights.length >= FSRS_WEIGHT_COUNT_MIN) {
    return [...globalWeights];
  }
  return [...DEFAULT_FSRS_WEIGHTS];
}

/** Whether a weight array is a valid FSRS parameter set. */
export function isValidWeights(w: unknown): w is number[] {
  return (
    Array.isArray(w) &&
    (w.length === FSRS_5_WEIGHT_COUNT || w.length === FSRS_6_WEIGHT_COUNT) &&
    w.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}
