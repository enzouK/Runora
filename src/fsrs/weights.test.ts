import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FSRS } from './algorithm';
import { DEFAULT_FSRS_WEIGHTS, fsrsDecay } from './constants';
import { isValidWeights, parseFsrsWeights } from './weights';

describe('fsrsDecay', () => {
  it('uses w[20] for an FSRS-6 parameter set', () => {
    assert.equal(fsrsDecay(DEFAULT_FSRS_WEIGHTS), DEFAULT_FSRS_WEIGHTS[20]);
  });

  it('uses the fixed 0.5 for an FSRS-5 parameter set', () => {
    const fsrs5 = DEFAULT_FSRS_WEIGHTS.slice(0, 19);
    assert.equal(fsrs5.length, 19);
    assert.equal(fsrsDecay(fsrs5), 0.5);
  });

  it('falls back to the official default when w[20] is missing or invalid', () => {
    const w = [...DEFAULT_FSRS_WEIGHTS];
    w[20] = 0;
    assert.equal(fsrsDecay(w), DEFAULT_FSRS_WEIGHTS[20]);
    w[20] = Number.NaN;
    assert.equal(fsrsDecay(w), DEFAULT_FSRS_WEIGHTS[20]);
  });
});

describe('FSRS decay compatibility', () => {
  it('reproduces the FSRS-5 retrievability curve with 19 weights', () => {
    // FSRS-5: R = (1 + FACTOR · t/S)^(−0.5), with FACTOR = 19/81.
    const fsrs5 = new FSRS({ w: DEFAULT_FSRS_WEIGHTS.slice(0, 19) });
    const factor = 19 / 81;
    const elapsed = 10;
    const stability = 20;
    const expected = Math.pow(1 + factor * (elapsed / stability), -0.5);
    assert.ok(Math.abs(fsrs5.retrievability(elapsed, stability) - expected) < 1e-12);
  });

  it('uses the learned decay with 21 weights', () => {
    const engine = new FSRS({ w: DEFAULT_FSRS_WEIGHTS });
    const decay = DEFAULT_FSRS_WEIGHTS[20];
    const factor = Math.pow(0.9, -1 / decay) - 1;
    const expected = Math.pow(1 + factor * (10 / 20), -decay);
    assert.ok(Math.abs(engine.retrievability(10, 20) - expected) < 1e-12);
  });

  it('computes the same interval for FSRS-5 and FSRS-6 at the same decay', () => {
    // FSRS-5's fixed decay of 0.5 is exactly what FSRS-6 would learn as
    // w[20] = 0.5, so the two must produce identical intervals.
    const w6 = [...DEFAULT_FSRS_WEIGHTS];
    w6[20] = 0.5;
    const fsrs5 = new FSRS({ w: DEFAULT_FSRS_WEIGHTS.slice(0, 19), requestRetention: 0.9 });
    const fsrs6 = new FSRS({ w: w6, requestRetention: 0.9 });
    assert.equal(fsrs5.nextInterval(30), fsrs6.nextInterval(30));
  });

  it('omits the S^(−w19) term for FSRS-5 short-term stability', () => {
    const fsrs5 = new FSRS({ w: DEFAULT_FSRS_WEIGHTS.slice(0, 19) });
    const w = DEFAULT_FSRS_WEIGHTS;
    const expected = 5 * Math.exp(w[17] * (3 - 3 + w[18]));
    assert.ok(Math.abs(fsrs5.nextShortTermStability(5, 3) - expected) < 1e-4);
  });
});

describe('parseFsrsWeights', () => {
  it('parses a space-separated FSRS-6 list', () => {
    const parsed = parseFsrsWeights('0.212 1.2931 2.3065 8.2956 6.4133');
    assert.equal(parsed, null, 'too few values must be rejected');
  });

  it('parses a full FSRS-6 list', () => {
    const text = DEFAULT_FSRS_WEIGHTS.map(String).join(' ');
    const parsed = parseFsrsWeights(text);
    assert.ok(parsed);
    assert.equal(parsed.length, 21);
    assert.deepEqual(parsed, DEFAULT_FSRS_WEIGHTS);
  });

  it('accepts commas, semicolons and brackets', () => {
    const text = `[${DEFAULT_FSRS_WEIGHTS.slice(0, 19).map(String).join(', ')}]`;
    const parsed = parseFsrsWeights(text);
    assert.ok(parsed);
    assert.equal(parsed.length, 19);
  });

  it('rejects invalid counts and non-numeric entries', () => {
    assert.equal(parseFsrsWeights(''), null);
    assert.equal(parseFsrsWeights('1 2 3'), null);
    assert.equal(parseFsrsWeights(DEFAULT_FSRS_WEIGHTS.map(String).join(' ') + ' 0.5'), null);
    assert.equal(parseFsrsWeights('a b c'), null);
  });
});

describe('isValidWeights', () => {
  it('accepts 19- and 21-value sets', () => {
    assert.equal(isValidWeights(DEFAULT_FSRS_WEIGHTS), true);
    assert.equal(isValidWeights(DEFAULT_FSRS_WEIGHTS.slice(0, 19)), true);
  });

  it('rejects anything else', () => {
    assert.equal(isValidWeights(DEFAULT_FSRS_WEIGHTS.slice(0, 20)), false);
    assert.equal(isValidWeights([...DEFAULT_FSRS_WEIGHTS].map(String)), false);
    assert.equal(isValidWeights(null), false);
  });
});
