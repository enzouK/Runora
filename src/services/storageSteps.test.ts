import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';

describe('parseSteps', () => {
  it('reads the classic Anki-style step strings', () => {
    assert.deepEqual(StorageService.parseSteps('1m 10m'), [1, 10]);
    assert.deepEqual(StorageService.parseSteps('10m'), [10]);
    assert.deepEqual(StorageService.parseSteps('30s 5m'), [0.5, 5]);
    assert.deepEqual(StorageService.parseSteps('5m 1h'), [5, 60]);
    assert.deepEqual(StorageService.parseSteps('1h 1d'), [60, 1440]);
  });

  it('reads bare minutes', () => {
    assert.deepEqual(StorageService.parseSteps('1 10'), [1, 10]);
    assert.deepEqual(StorageService.parseSteps('1.5'), [1.5]);
    assert.deepEqual(StorageService.parseSteps('1,5'), [1.5]);
  });

  it('reads the compound format', () => {
    assert.deepEqual(StorageService.parseSteps('1m30s'), [1.5]);
    assert.deepEqual(StorageService.parseSteps('1h30m'), [90]);
    assert.deepEqual(StorageService.parseSteps('1d3h'), [1620]);
    assert.deepEqual(StorageService.parseSteps('1m30s 10m'), [1.5, 10]);
  });

  it('accepts "min" as a spelled-out "m"', () => {
    assert.deepEqual(StorageService.parseSteps('1min 10min'), [1, 10]);
  });

  it('rejects anything it cannot make sense of', () => {
    assert.equal(StorageService.parseSteps(''), null);
    assert.equal(StorageService.parseSteps('   '), null);
    assert.equal(StorageService.parseSteps('abc'), null);
    assert.equal(StorageService.parseSteps('1x'), null);
    assert.equal(StorageService.parseSteps('1m garbage'), null);
    assert.equal(StorageService.parseSteps('0m'), null);
    // A month is not a valid learning step.
    assert.equal(StorageService.parseSteps('1mo'), null);
  });
});

describe('formatSteps', () => {
  it('keeps the classic step strings unchanged', () => {
    assert.equal(StorageService.formatSteps([1, 10]), '1m 10m');
    assert.equal(StorageService.formatSteps([10]), '10m');
    assert.equal(StorageService.formatSteps([0.5]), '30s');
    assert.equal(StorageService.formatSteps([60]), '1h');
    assert.equal(StorageService.formatSteps([1440]), '1d');
  });

  it('writes fractional minutes in the compound format instead of a decimal', () => {
    assert.equal(StorageService.formatSteps([1.5]), '1m30s');
    assert.equal(StorageService.formatSteps([90]), '1h30m');
  });

  it('round-trips through parseSteps', () => {
    const samples = [[1, 10], [10], [0.5], [60], [1440], [1.5], [90], [0.25]];
    for (const steps of samples) {
      assert.deepEqual(StorageService.parseSteps(StorageService.formatSteps(steps)), steps);
    }
  });
});

describe('stepsToAnkiMinutes', () => {
  it('exports whole minutes, the way Anki stores them', () => {
    assert.deepEqual(StorageService.stepsToAnkiMinutes('1m 10m'), [1, 10]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes('10m'), [10]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes('1h'), [60]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes('1d'), [1440]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes('30s'), [1]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes('1.5m'), [2]);
  });

  it('rounds a compound step to the nearest minute', () => {
    assert.deepEqual(StorageService.stepsToAnkiMinutes('1m30s'), [2]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes('1m 10m'), [1, 10]);
  });

  it('falls back to the Anki default when the steps cannot be read', () => {
    assert.deepEqual(StorageService.stepsToAnkiMinutes('nonsense'), [1, 10]);
    assert.deepEqual(StorageService.stepsToAnkiMinutes(''), []);
    assert.deepEqual(StorageService.stepsToAnkiMinutes(null), []);
    assert.deepEqual(StorageService.stepsToAnkiMinutes(undefined), []);
  });
});
