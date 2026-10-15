import { FSRSParameters } from '../types/anki';

/**
 * Official default FSRS-6 weights (Anki 25.x+, 21 parameters).
 * Source: open-spaced-repetition/awesome-fsfs ("The Algorithm" wiki):
 * https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 */
export const DEFAULT_FSRS_WEIGHTS: number[] = [
  0.212,   // w[0]: Initial stability for Again
  1.2931,  // w[1]: Initial stability for Hard
  2.3065,  // w[2]: Initial stability for Good
  8.2956,  // w[3]: Initial stability for Easy
  6.4133,  // w[4]: Initial difficulty base
  0.8334,  // w[5]: Initial difficulty scaling
  3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729,
  0.5425, 0.0912, 0.0658, 0.1542,  // w[6] through w[20] — FSRS-6's trainable decay + FSRS-5/6 short-term additions
];

export const DEFAULT_FSRS_PARAMETERS: FSRSParameters = {
  requestRetention: 0.90, // 90% target retention
  maximumInterval: 36500, // 100 years max
  w: [...DEFAULT_FSRS_WEIGHTS],
  enableFuzz: true,
};

export const FACTOR = 19 / 81; // FSRS retrievability constant: (100/81)^(-0.5) = 9/10 = 0.9

/** Anki's FSRS stability floor (rslib S_MIN). */
export const STABILITY_MIN = 0.01;
