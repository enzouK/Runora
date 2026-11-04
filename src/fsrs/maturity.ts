import { Card } from '../types/runora';

/**
 * Card maturity phase (Anki-parity, derived — never persisted).
 *
 * Like Anki (is:young / is:mature), maturity is NOT a stored state: it is a
 * deterministic function of the FSRS review state and the scheduled interval.
 * The single precedence-free rule is the 21-day threshold. Keeping it here
 * makes the rule one source of truth shared by the Card browser filter,
 * row badges and future statistics plugins.
 */

/** Minimum scheduled interval (days) for a review card to count as mature. */
export const MATURITY_THRESHOLD_DAYS = 21;

export type CardMaturity = 'young' | 'mature' | null;

/**
 * Maturity phase of a card. Only review-state cards have a phase
 * (young < threshold days, mature >= threshold days); all other
 * states (new/learning/relearning) return null.
 */
export function getCardMaturity(card: Card): CardMaturity {
  if (card.fsrs.state !== 2) return null;
  return card.fsrs.scheduledDays >= MATURITY_THRESHOLD_DAYS ? 'mature' : 'young';
}
