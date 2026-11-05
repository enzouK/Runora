import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANKI_DIFFICULTY_MAX,
  ANKI_DIFFICULTY_MIN,
  ANKI_REVLOG_FACTOR_MAX,
  ANKI_REVLOG_FACTOR_MIN,
  DEFAULT_IMPORTED_DIFFICULTY,
  collectRevlogDifficulties,
  deriveImportedFsrsState,
  difficultyFromRevlogFactor,
  parseAnkiCardFsrsData,
} from './ankiFsrsState';

/**
 * The reference vectors below come from a real Anki export
 * (`Japanese2.apkg`, schema 18): the `cards.data` blob and the matching
 * revlog `factor` of the same card.
 */
const REAL_CARD_DATA =
  '{"pos":10,"s":20.3746,"d":7.342,"dr":0.9,"decay":0.154,"lrt":1792897026}';

describe('parseAnkiCardFsrsData', () => {
  it('extracts the FSRS state from a real Anki cards.data blob', () => {
    const state = parseAnkiCardFsrsData(REAL_CARD_DATA);
    assert.equal(state.difficulty, 7.342);
    assert.equal(state.stability, 20.3746);
    assert.equal(state.lastReviewSeconds, 1792897026);
  });

  it('returns nothing for an empty or malformed blob', () => {
    assert.deepEqual(parseAnkiCardFsrsData('{}'), {});
    assert.deepEqual(parseAnkiCardFsrsData(''), {});
    assert.deepEqual(parseAnkiCardFsrsData('   '), {});
    assert.deepEqual(parseAnkiCardFsrsData('not json'), {});
    assert.deepEqual(parseAnkiCardFsrsData(null), {});
    assert.deepEqual(parseAnkiCardFsrsData(undefined), {});
    assert.deepEqual(parseAnkiCardFsrsData(42), {});
  });

  it('rejects out-of-range difficulties', () => {
    // Legacy SM-2 collections have no "d" key at all.
    assert.equal(parseAnkiCardFsrsData('{"s":10,"dr":0.9}').difficulty, undefined);
    // A difficulty outside 1..10 is not a valid FSRS value.
    assert.equal(parseAnkiCardFsrsData('{"d":0,"s":10}').difficulty, undefined);
    assert.equal(parseAnkiCardFsrsData('{"d":12,"s":10}').difficulty, undefined);
    // …but the stability and last review time are still usable.
    assert.equal(parseAnkiCardFsrsData('{"d":0,"s":10}').stability, 10);
  });

  it('ignores non-positive stability and last review time', () => {
    assert.equal(parseAnkiCardFsrsData('{"s":0}').stability, undefined);
    assert.equal(parseAnkiCardFsrsData('{"s":-3}').stability, undefined);
    assert.equal(parseAnkiCardFsrsData('{"lrt":0}').lastReviewSeconds, undefined);
  });
});

describe('difficultyFromRevlogFactor', () => {
  it('reverses Anki\'s shifted difficulty encoding', () => {
    // Anki: ease_factor = (difficulty_shifted() * 1000), where
    // difficulty_shifted() = (difficulty - 1.0) / 9.0 + 0.1
    assert.equal(difficultyFromRevlogFactor(100), 1);
    assert.ok(Math.abs(difficultyFromRevlogFactor(222)! - 2.098) < 1e-9);
    assert.ok(Math.abs(difficultyFromRevlogFactor(805)! - 7.345) < 1e-9);
    assert.equal(difficultyFromRevlogFactor(1100), 10);
  });

  it('matches the difficulty stored in cards.data for real cards', () => {
    // Real card from the reference .apkg: d = 7.342, last revlog factor = 805
    const state = parseAnkiCardFsrsData(REAL_CARD_DATA);
    const fromRevlog = difficultyFromRevlogFactor(805)!;
    assert.ok(Math.abs(state.difficulty! - fromRevlog) < 0.01);
  });

  it('ignores factors outside the FSRS range', () => {
    // 0 = manual reschedule
    assert.equal(difficultyFromRevlogFactor(0), null);
    // Legacy SM-2 ease factors (130%..350%)
    assert.equal(difficultyFromRevlogFactor(2500), null);
    assert.equal(difficultyFromRevlogFactor(1300), null);
    // Below the FSRS range
    assert.equal(difficultyFromRevlogFactor(50), null);
    assert.equal(difficultyFromRevlogFactor(-1), null);
    assert.equal(difficultyFromRevlogFactor(Number.NaN), null);
    assert.equal(difficultyFromRevlogFactor(null), null);
  });

  it('exposes the FSRS factor boundaries', () => {
    assert.equal(ANKI_REVLOG_FACTOR_MIN, 100);
    assert.equal(ANKI_REVLOG_FACTOR_MAX, 1100);
    assert.equal(ANKI_DIFFICULTY_MIN, 1);
    assert.equal(ANKI_DIFFICULTY_MAX, 10);
  });
});

describe('collectRevlogDifficulties', () => {
  it('keeps the most recent difficulty of each card', () => {
    // Rows must come ordered by revlog id ascending.
    const rows = [
      [100, 700],
      [100, 764],
      [200, 222],
      [300, 0], // manual reschedule → ignored
      [300, 964],
    ];
    const map = collectRevlogDifficulties(rows);
    assert.equal(map.size, 3);
    assert.ok(Math.abs(map.get(100)! - 6.976) < 1e-9);
    assert.ok(Math.abs(map.get(200)! - 2.098) < 1e-9);
    assert.ok(Math.abs(map.get(300)! - 8.776) < 1e-9);
  });

  it('ignores malformed rows', () => {
    const map = collectRevlogDifficulties([
      [Number.NaN, 700],
      ['abc', 700],
      [400, 'not a number'],
    ]);
    assert.equal(map.size, 0);
  });
});

describe('deriveImportedFsrsState', () => {
  // 2026-11-04T00:00:00Z — the "now" of the reference import
  const NOW = 1793664000000;

  it('imports the FSRS state of a real Anki card', () => {
    // Real card from the reference .apkg:
    //   id=1790936508082 type=2 queue=2 ivl=19 due=48 reps=8 lapses=1
    //   data={"pos":10,"s":20.3746,"d":7.342,...,"lrt":1792897026}
    const fsrs = deriveImportedFsrsState({
      ankiType: 2,
      ivlDays: 19,
      dueMs: 1791168000000,
      reps: 8,
      lapses: 1,
      data: REAL_CARD_DATA,
      now: NOW,
    });

    assert.equal(fsrs.difficulty, 7.342);
    assert.equal(fsrs.stability, 20.3746);
    assert.equal(fsrs.state, 2);
    assert.equal(fsrs.reps, 8);
    assert.equal(fsrs.lapses, 1);
    assert.equal(fsrs.scheduledDays, 19);
    assert.equal(fsrs.lastReview, 1792897026 * 1000);
    assert.ok(Math.abs(fsrs.elapsedDays - (NOW - 1792897026 * 1000) / 86400000) < 1e-9);
  });

  it('falls back to the revlog difficulty for legacy collections', () => {
    const fsrs = deriveImportedFsrsState({
      ankiType: 2,
      ivlDays: 30,
      dueMs: NOW,
      reps: 4,
      lapses: 0,
      data: '{}', // schema 11: no FSRS state
      revlogDifficulty: 6.976,
      now: NOW,
    });
    assert.equal(fsrs.difficulty, 6.976);
    // No `lrt` available → last review is estimated from the due date.
    assert.equal(fsrs.lastReview, NOW - 30 * 86400000);
    assert.equal(fsrs.elapsedDays, 30);
  });

  it('keeps D = 0 for a card that was never reviewed', () => {
    const fsrs = deriveImportedFsrsState({
      ankiType: 0,
      ivlDays: 0,
      dueMs: NOW,
      reps: 0,
      lapses: 0,
      data: '{}',
      now: NOW,
    });
    assert.equal(fsrs.difficulty, 0);
    assert.equal(fsrs.state, 0);
    assert.equal(fsrs.lastReview, null);
    assert.equal(fsrs.elapsedDays, 0);
  });

  it('uses a neutral difficulty for a reviewed card with no FSRS state', () => {
    const fsrs = deriveImportedFsrsState({
      ankiType: 2,
      ivlDays: 10,
      dueMs: NOW,
      reps: 2,
      lapses: 0,
      data: '{}',
      now: NOW,
    });
    assert.equal(fsrs.difficulty, DEFAULT_IMPORTED_DIFFICULTY);
  });

  it('maps Anki\'s learning and relearning cards', () => {
    const learning = deriveImportedFsrsState({
      ankiType: 1,
      ivlDays: 0,
      dueMs: NOW,
      reps: 1,
      lapses: 0,
      data: '{"s":0.42,"d":7.36,"lrt":1792897026}',
      now: NOW,
    });
    assert.equal(learning.state, 1);
    assert.equal(learning.difficulty, 7.36);
    assert.equal(learning.stability, 0.42);

    const relearning = deriveImportedFsrsState({
      ankiType: 3,
      ivlDays: 0,
      dueMs: NOW,
      reps: 5,
      lapses: 2,
      data: '{"s":1.8,"d":9.07,"lrt":1792897026}',
      now: NOW,
    });
    assert.equal(relearning.state, 3);
    assert.equal(relearning.difficulty, 9.07);
    assert.equal(relearning.lapses, 2);
  });

  it('never produces a negative elapsed time', () => {
    const fsrs = deriveImportedFsrsState({
      ankiType: 2,
      ivlDays: 5,
      dueMs: NOW,
      reps: 1,
      lapses: 0,
      data: '{"s":10,"d":5,"lrt":1792897026}',
      now: 1000, // "now" before the last review
    });
    assert.equal(fsrs.elapsedDays, 0);
  });
});
