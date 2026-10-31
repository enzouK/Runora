/**
 * FSRS (Free Spaced Repetition Scheduler) Algorithm
 * Faithful implementation of the FSRS-5 reference logic and default weights (upstream 24.04+).
 * Note: upstream 25.07+ ships FSRS-6 with two extra weights (w19, w20) that modulate
 * same-day stability by elapsed time — not implemented here yet.
 */

import { CardState, FSRSCardData, FSRSParameters, FSRSPrediction, FSRSRating } from '../types/runora';
import { DEFAULT_FSRS_PARAMETERS, FACTOR, STABILITY_MIN } from './constants';

export class FSRS {
  private params: FSRSParameters;

  constructor(customParams?: Partial<FSRSParameters>) {
    this.params = { ...DEFAULT_FSRS_PARAMETERS, ...customParams };
  }

  public getParameters(): FSRSParameters {
    return { ...this.params };
  }

  public setParameters(params: Partial<FSRSParameters>): void {
    this.params = { ...this.params, ...params };
  }

  /**
   * Initial stability for a new card: S_0(G) = w[G - 1]
   */
  public initStability(rating: FSRSRating): number {
    const s = this.params.w[rating - 1];
    return Math.max(STABILITY_MIN, Number(s.toFixed(4)));
  }

  /**
   * Initial difficulty for a new card: D_0(G) = w[4] - exp(w[5] * (G - 1)) + 1
   * Clamped between 1.0 and 10.0 (FSRS-5/6 formula)
   */
  public initDifficulty(rating: FSRSRating): number {
    const w = this.params.w;
    const d = w[4] - Math.exp(w[5] * (rating - 1)) + 1;
    return this.clamp(d, 1.0, 10.0);
  }

  /**
   * Retrievability: probability of recalling the item after elapsed time t with stability s
   * R(t, S) = (1 + FACTOR * (t / S))^(-0.5)
   */
  /** FSRS-6: factor for the trainable decay: factor = 0.9^(-1/w20) - 1 */
  private forgettingFactor(): number {
    const w20 = this.params.w[20] ?? 0.1542;
    return Math.pow(0.9, -1 / w20) - 1;
  }

  /**
   * Retrievability (FSRS-6): R(t, S) = (1 + factor · t/S)^(−w20)
   * The decay exponent w20 = w[20] is trainable; FSRS-4.5 used fixed −0.5.
   */
  public retrievability(elapsedDays: number, stability: number): number {
    if (stability <= 0) return 0;
    if (elapsedDays <= 0) return 1.0;
    const factor = this.forgettingFactor();
    const w20 = this.params.w[20] ?? 0.1542;
    return Math.pow(1 + factor * (elapsedDays / stability), -w20);
  }

  /**
   * Next difficulty after a review
   * Delta D = -w[6] * (G - 3)
   * D' = w[7] * D_0(4) + (1 - w[7]) * (D + Delta D)
   * FSRS-5+: mean reversion target is D₀(4) (Easy), FSRS-4.5 used D₀(3).
   */
  public nextDifficulty(currentD: number, rating: FSRSRating): number {
    const w = this.params.w;
    const deltaD = -w[6] * (rating - 3);
    const d0Easy = this.initDifficulty(4); // FSRS-5+: mean reversion target
    const nextD = w[7] * d0Easy + (1 - w[7]) * (currentD + deltaD);
    return this.clamp(nextD, 1.0, 10.0);
  }

  /**
   * Stability after successful recall (ratings 2, 3, 4)
   */
  public nextRecallStability(
    d: number,
    s: number,
    r: number,
    rating: FSRSRating
  ): number {
    const w = this.params.w;
    const hardPenalty = rating === 2 ? w[15] : 1.0;
    const easyBonus = rating === 4 ? w[16] : 1.0;

    const newS =
      s *
      (1 +
        Math.exp(w[8]) *
          (11 - d) *
          Math.pow(s, -w[9]) *
          (Math.exp(w[10] * (1 - r)) - 1) *
          hardPenalty *
          easyBonus);

    return Math.max(STABILITY_MIN, Number(newS.toFixed(4)));
  }

  /**
   * Stability after memory lapse / forget (rating 1: Again)
   */
  public nextForgetStability(d: number, s: number, r: number): number {
    const w = this.params.w;
    const newS =
      w[11] *
      Math.pow(d, -w[12]) *
      (Math.pow(s + 1, w[13]) - 1) *
      Math.exp(w[14] * (1 - r));

    // Stability after lapse should not exceed prior stability and has the FSRS floor
    return this.clamp(newS, STABILITY_MIN, Math.max(STABILITY_MIN, s));
  }

  /**
   * FSRS-6 same-day short-term stability:
   *
   *   S' = S · e^( w17 · (G − 3 + w18) ) · S^(−w19)
   *
   * The new term S^(−w19)=w[19] means same-day stability grows faster when S is
   * small and slower when it's large (converging instead of unbounded).
   */
  public nextShortTermStability(s: number, rating: FSRSRating): number {
    const w = this.params.w;
    const growth = Math.exp(w[17] * (rating - 3 + w[18])) * Math.pow(s, -w[19]);
    return Math.max(STABILITY_MIN, Number((s * growth).toFixed(4)));
  }

  /**
   * Calculate interval in days given Stability S and requested retention R
   * I = (S / FACTOR) * (R^(-2) - 1)
   */
  /**
   * Calculate interval in days given Stability S and requested retention R
   * FSRS-6: I = (S / factor) · (r^(−1/w20) − 1)
   */
  public nextInterval(stability: number): number {
    const reqR = this.params.requestRetention;
    const factor = this.forgettingFactor();
    const w20 = this.params.w[20] ?? 0.1542;
    const interval = (stability / factor) * (Math.pow(reqR, -1 / w20) - 1);
    const rounded = Math.round(interval);
    return this.clamp(rounded < 1 ? 1 : rounded, 1, this.params.maximumInterval);
  }

  /**
   * Fuzz range for a review interval (matches the rslib reference):
   * - below 2.5 days: no fuzz
   * - 2.5 to 7 days: ±25% (minimum bound of 2 days)
   * - 7 days and above: ±5%
   */
  public static getFuzzRange(interval: number): { min: number; max: number } {
    if (interval < 2.5) {
      const r = Math.max(1, Math.round(interval));
      return { min: r, max: r };
    }
    const delta = interval < 7 ? Math.round(interval * 0.25) : Math.round(interval * 0.05);
    return {
      min: Math.max(2, Math.round(interval) - delta),
      max: Math.round(interval) + delta,
    };
  }

  /** Pick a uniformly random integer day within the fuzz range. */
  public fuzzInterval(interval: number): number {
    if (!this.params.enableFuzz) return interval;
    const { min, max } = FSRS.getFuzzRange(interval);
    const fuzzed = min + Math.floor(Math.random() * (max - min + 1));
    return this.clamp(fuzzed, 1, this.params.maximumInterval);
  }

  /**
   * Format interval for UI display (Apple-styled concise labels)
   */
  public formatInterval(days: number, state?: CardState, rating?: FSRSRating): string {
    if (state === 0 || state === 1 || state === 3) {
      if (rating === 1) return '< 10m';
      if (rating === 2 && state !== 0) return '1d';
    }
    if (days < 1) {
      const minutes = Math.round(days * 24 * 60);
      if (minutes < 60) return `${Math.max(1, minutes)}m`;
      const hours = Math.round(days * 24);
      return `${hours}h`;
    }
    if (days < 30) {
      return `${Math.round(days)}d`;
    }
    if (days < 365) {
      const months = (days / 30.4375).toFixed(1);
      return `${months}m`;
    }
    const years = (days / 365.25).toFixed(1);
    return `${years}a`;
  }

  /**
   * Days elapsed since the last review. When a card has no lastReview
   * (e.g., freshly imported), fall back to its scheduled interval or
   * its recorded elapsedDays — otherwise retrievability would be 100% and
   * Good/Easy would produce identical stability (never diverging).
   */
  private getElapsedDays(card: FSRSCardData, now: number): number {
    if (card.lastReview) {
      return Math.max(0, (now - card.lastReview) / (1000 * 60 * 60 * 24));
    }
    if (card.state === 2) {
      // Imported review card: assume it is being seen at about its due time,
      // so elapsed ≈ scheduled interval (or the recorded elapsedDays).
      return Math.max(card.elapsedDays, card.scheduledDays, 0);
    }
    return 0;
  }

  /**
   * Generates predictions for all 4 ratings (Again, Hard, Good, Easy) for a card
   */
  public predictRatings(card: FSRSCardData, now = Date.now()): Record<FSRSRating, FSRSPrediction> {
    const ratings: FSRSRating[] = [1, 2, 3, 4];
    const predictions = {} as Record<FSRSRating, FSRSPrediction>;

    const elapsedDays = this.getElapsedDays(card, now);

    for (const r of ratings) {
      const outcome = this.step(card, r, now, elapsedDays);
      predictions[r] = {
        rating: r,
        intervalDays: outcome.scheduledDays,
        intervalText: this.formatInterval(outcome.scheduledDays, card.state, r),
        stability: outcome.stability,
        difficulty: outcome.difficulty,
        state: outcome.state,
      };
    }

    return predictions;
  }

  /**
   * Computes the next state of a card after a review with a rating
   */
  public step(
    card: FSRSCardData,
    rating: FSRSRating,
    now = Date.now(),
    elapsedDaysOverride?: number,
    applyFuzz = false
  ): FSRSCardData {
    const elapsedDays =
      elapsedDaysOverride !== undefined
        ? elapsedDaysOverride
        : this.getElapsedDays(card, now);

    let nextS = card.stability;
    let nextD = card.difficulty;
    let nextState: CardState = card.state;
    let scheduledDays = 1;
    let lapses = card.lapses;

    if (card.state === 0) {
      // New card
      nextS = this.initStability(rating);
      nextD = this.initDifficulty(rating);

      if (rating === 1 || rating === 2) {
        // Runora: Again repeats the FIRST learning step; Hard repeats the CURRENT
        // step. Steps come from the deck config — the FSRS core does not know
        // them, so the caller (StudyView) applies step timing. scheduledDays=0
        // means "in-learning; caller decides".
        nextState = 1; // Learning
        scheduledDays = 0;
      } else if (rating === 3) {
        nextState = 2; // Review
        scheduledDays = this.nextInterval(nextS);
      } else {
        // Easy
        nextState = 2; // Review
        scheduledDays = this.nextInterval(nextS);
      }
    } else if (card.state === 1 || card.state === 3) {
      // Learning or Relearning
      if (rating === 1 || rating === 2) {
        // Again → back to step 0; Hard → repeat current step. The caller
        // (StudyView) applies the deck's learning/relearning steps, matching
        // Runora. No fabricated 10m/12h here.
        nextState = card.state;
        scheduledDays = 0;

        // FSRS-5: same-day ratings adjust stability via the short-term formula
        // and always move difficulty.
        nextS = this.nextShortTermStability(card.stability, rating);
        nextD = this.nextDifficulty(card.difficulty, rating);
      } else {
        // Good or Easy graduates to Review
        nextState = 2; // Review
        nextD = this.nextDifficulty(card.difficulty, rating);

        if (elapsedDays < 1) {
          // Same-day graduation (FSRS-5): short-term growth, never below the
          // initial stability for that rating (Runora's k graduation floor).
          nextS = Math.max(
            this.nextShortTermStability(card.stability, rating),
            this.initStability(rating)
          );
        } else {
          // Learning cards spanning across days: full recall formula with the
          // same graduation floor (prevents Easy ≈ Good after tiny elapsed gaps).
          const rRetrievability = this.retrievability(elapsedDays, card.stability);
          nextS = this.nextRecallStability(card.difficulty, card.stability, rRetrievability, rating);
          nextS = Math.max(nextS, this.initStability(rating));
        }
        scheduledDays = this.nextInterval(nextS);
      }
    } else {
      // Review state
      const rRetrievability = this.retrievability(elapsedDays, card.stability);

      if (rating === 1) {
        // Lapse
        nextState = 3; // Relearning
        lapses += 1;
        nextS = this.nextForgetStability(card.difficulty, card.stability, rRetrievability);
        nextD = this.nextDifficulty(card.difficulty, rating);
        scheduledDays = 0; // caller applies the deck's relearning steps (Runora)
      } else {
        // Success (Hard, Good, Easy)
        nextState = 2; // Keep in review
        nextS = this.nextRecallStability(card.difficulty, card.stability, rRetrievability, rating);
        nextD = this.nextDifficulty(card.difficulty, rating);
        scheduledDays = this.nextInterval(nextS);
        // FSRS: no hard/easy interval multipliers or floors — w15/w16 already
        // encode the rating effect (the SM-2 "hard = prev × 1.2" rule is gone).
      }
    }

    // Apply Runora-style fuzz only to real scheduling of review intervals
    // (never to learning steps, and never to the prediction labels)
    if (applyFuzz && nextState === 2 && scheduledDays >= 1) {
      scheduledDays = this.fuzzInterval(scheduledDays);
    }

    return {
      stability: Number(nextS.toFixed(4)),
      difficulty: Number(nextD.toFixed(4)),
      elapsedDays,
      scheduledDays,
      reps: card.reps + 1,
      lapses,
      state: nextState,
      lastReview: now,
    };
  }

  private clamp(val: number, min: number, max: number): number {
    return Math.min(Math.max(val, min), max);
  }
}

export const defaultFSRS = new FSRS();
