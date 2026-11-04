import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FSRS } from './algorithm';
import { DEFAULT_FSRS_WEIGHTS } from './constants';
import { FSRSRating } from '../types/runora';

/**
 * Parity tests against the upstream Rust crate `fsrs` 6.6.2 — the exact
 * engine Anki runs (Anki depends on `fsrs = "6.6.2"`).
 *
 * Reference vectors come from `fsrs-6.6.2/src/model.rs`:
 *   - `test_next_difficulty`  → [8.341763, 6.6659956, 4.990228, 3.3144615]
 *   - `test_init_difficulty`  → D_0(G) = w[4] − e^(w[5]·(G−1)) + 1
 *
 * The crate compares with `Tolerance::absolute(1e-4)`, so we use the same
 * epsilon (the crate works in f32, Runora in f64).
 */
const EPSILON = 1e-4;

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `${message}: expected ${expected}, got ${actual}`
  );
}

const RATING_BY_INDEX: FSRSRating[] = [1, 2, 3, 4];

describe('FSRS.nextDifficulty (Anki / fsrs-rs 6.6.2 parity)', () => {
  const fsrs = new FSRS();

  it('matches the official crate vectors (damping + mean reversion)', () => {
    // fsrs 6.6.2 — src/model.rs::test_next_difficulty, starting from D = 5.
    const expected = [8.341763, 6.6659956, 4.990228, 3.3144615];

    RATING_BY_INDEX.forEach((rating, i) => {
      assertClose(
        fsrs.nextDifficulty(5.0, rating),
        expected[i],
        `nextDifficulty(D=5, G=${rating})`
      );
    });
  });

  it('applies the FSRS-5/6 linear damping (10 − D) / 9', () => {
    // Without the damping factor, "Easy" at D = 9 dropped the difficulty to
    // 5.98 instead of Anki's ≈ 8.65 — a 2.68 point drift on every review.
    assertClose(fsrs.nextDifficulty(9.0, 4), 8.651075, 'D=9 + Easy');
    assertClose(fsrs.nextDifficulty(7.0, 2), 7.993689, 'D=7 + Hard');
    assertClose(fsrs.nextDifficulty(5.0, 1), 8.341762, 'D=5 + Again');
    assertClose(fsrs.nextDifficulty(3.0, 1), 7.684376, 'D=3 + Again');
    assertClose(fsrs.nextDifficulty(3.0, 2), 5.338302, 'D=3 + Hard');
    assertClose(fsrs.nextDifficulty(7.0, 4), 5.982768, 'D=7 + Easy');
    assertClose(fsrs.nextDifficulty(9.0, 1), 9.656535, 'D=9 + Again');
  });

  it('shrinks the change as the difficulty approaches 10', () => {
    // The damping makes the step smaller for harder cards:
    // ΔD is scaled by (10 − D) / 9.
    const w = DEFAULT_FSRS_WEIGHTS;
    const deltaD = -w[6] * (1 - 3); // Again → +2·w[6]

    for (const d of [2, 4, 6, 8, 10]) {
      const good = fsrs.nextDifficulty(d, 3); // ΔD = 0 → only mean reversion
      const again = fsrs.nextDifficulty(d, 1);

      // Undo the mean reversion (it is affine with slope 1 − w[7]).
      const rawDelta = (again - good) / (1 - w[7]);
      assertClose(rawDelta, ((10 - d) / 9) * deltaD, `effective ΔD at D=${d}`);
    }
  });

  it('keeps the difficulty inside the 1..10 range', () => {
    for (const d of [1, 5, 10]) {
      for (const rating of RATING_BY_INDEX) {
        const next = fsrs.nextDifficulty(d, rating);
        assert.ok(next >= 1 && next <= 10, `nextDifficulty(${d}, ${rating}) = ${next}`);
      }
    }
    // D = 10 cannot get harder: the damping factor (10 − D)/9 is zero.
    assertClose(fsrs.nextDifficulty(10, 1), 9.985228, 'D=10 + Again');
  });

  it('raises the difficulty on Again/Hard and lowers it on Easy', () => {
    // Same direction as SM-2's "Ease", inverted: a higher D means harder.
    const base = 5.0;
    assert.ok(fsrs.nextDifficulty(base, 1) > base, 'Again must raise D');
    assert.ok(fsrs.nextDifficulty(base, 2) > base, 'Hard must raise D');
    assert.ok(fsrs.nextDifficulty(base, 3) < base, 'Good must lower D (mean reversion)');
    assert.ok(fsrs.nextDifficulty(base, 4) < base, 'Easy must lower D');
  });
});

describe('FSRS.initDifficulty (Anki / fsrs-rs 6.6.2 parity)', () => {
  const fsrs = new FSRS();

  it('uses D_0(G) = w[4] − e^(w[5]·(G−1)) + 1, clamped to 1..10', () => {
    // fsrs 6.6.2 — src/model.rs::test_init_difficulty (clamped where stored).
    const w = DEFAULT_FSRS_WEIGHTS;
    assertClose(fsrs.initDifficulty(1), w[4], 'D_0(Again)');
    assertClose(fsrs.initDifficulty(2), w[4] - Math.exp(w[5]) + 1, 'D_0(Hard)');
    assertClose(fsrs.initDifficulty(3), w[4] - Math.exp(2 * w[5]) + 1, 'D_0(Good)');
    // D_0(Easy) is negative with the default weights → clamped to 1.
    assert.equal(fsrs.initDifficulty(4), 1);
  });
});
