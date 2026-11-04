import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  difficultyToPercent,
  formatDifficultyPercent,
  hasDifficulty,
} from './difficulty';

describe('difficultyToPercent', () => {
  it('maps the FSRS range (1..10) onto Anki\'s percentage scale (0..100)', () => {
    assert.equal(difficultyToPercent(DIFFICULTY_MIN), 0);
    assert.equal(difficultyToPercent(5.5), 50);
    assert.equal(difficultyToPercent(DIFFICULTY_MAX), 100);
  });

  it('matches the Anki reference points', () => {
    // Anki: rslib/src/card/mod.rs -> (difficulty - 1.0) / 9.0,
    // then rslib/src/browser_table.rs -> format!("{:.0}%", s.difficulty() * 100.0)
    assert.equal(Math.round(difficultyToPercent(1)), 0);
    assert.equal(Math.round(difficultyToPercent(2)), 11);
    assert.equal(Math.round(difficultyToPercent(3)), 22);
    assert.equal(Math.round(difficultyToPercent(4)), 33);
    assert.equal(Math.round(difficultyToPercent(5)), 44);
    assert.equal(Math.round(difficultyToPercent(6)), 56);
    assert.equal(Math.round(difficultyToPercent(7)), 67);
    assert.equal(Math.round(difficultyToPercent(8)), 78);
    assert.equal(Math.round(difficultyToPercent(9)), 89);
    assert.equal(Math.round(difficultyToPercent(10)), 100);
  });

  it('clamps values outside the valid FSRS range', () => {
    assert.equal(difficultyToPercent(0), 0);
    assert.equal(difficultyToPercent(-5), 0);
    assert.equal(difficultyToPercent(15), 100);
  });

  it('returns 0 for non-finite input', () => {
    assert.equal(difficultyToPercent(Number.NaN), 0);
    assert.equal(difficultyToPercent(Number.POSITIVE_INFINITY), 0);
  });
});

describe('formatDifficultyPercent', () => {
  it('renders the value as a rounded integer percentage', () => {
    assert.equal(formatDifficultyPercent(5), '44%');
    assert.equal(formatDifficultyPercent(5.5), '50%');
    assert.equal(formatDifficultyPercent(1), '0%');
    assert.equal(formatDifficultyPercent(10), '100%');
  });

  it('rounds like Rust\'s "{:.0}" (half away from zero)', () => {
    // 4.95 -> 43.888...% -> 44%
    assert.equal(formatDifficultyPercent(4.95), '44%');
    // 5.5 -> 50% exactly
    assert.equal(formatDifficultyPercent(5.5), '50%');
  });
});

describe('hasDifficulty', () => {
  it('is false for cards that were never reviewed (difficulty 0)', () => {
    assert.equal(hasDifficulty(0), false);
    assert.equal(hasDifficulty(-1), false);
    assert.equal(hasDifficulty(Number.NaN), false);
  });

  it('is true for any value inside the FSRS range', () => {
    assert.equal(hasDifficulty(1), true);
    assert.equal(hasDifficulty(5.5), true);
    assert.equal(hasDifficulty(10), true);
  });
});
