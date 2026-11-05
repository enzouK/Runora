/**
 * The FSRS scope resolution — global → preset → deck.
 *
 * StorageService reads the collection from `localStorage`, so the tests run
 * against a tiny in-memory stand-in for the browser storage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import { DEFAULT_FSRS_WEIGHTS } from '../fsrs/constants';
import { FSRS } from '../fsrs/algorithm';
import type { Deck, Preset } from '../types/runora';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

/** A preset with only the fields the FSRS resolution touches. */
function makePreset(id: string, fsrsParams: Preset['fsrsParams']): Preset {
  return {
    id,
    name: id,
    dailyLimits: { newCardsPerDay: 20, maxReviewsPerDay: 200 },
    schedulerConfig: {
      learningSteps: '1m 10m',
      insertionOrder: 'sequential',
      relearningSteps: '10m',
      leechThreshold: 8,
      leechAction: 'suspend',
    },
    displayOrder: {
      newGatherOrder: 'deck',
      newSortOrder: 'template',
      newReviewOrder: 'mix',
      learnReviewOrder: 'mix',
      reviewSortOrder: 'dueRandom',
    },
    audioConfig: { disableAutoplay: false },
    fsrsParams,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeDeck(id: string, presetId: string, fsrsOverride?: Deck['fsrsOverride']): Deck {
  return {
    id,
    name: id,
    description: '',
    presetId,
    fsrsOverride,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** The FSRS-5 weight set: 19 values, the fixed decay of 0.5. */
const FSRS5_WEIGHTS = DEFAULT_FSRS_WEIGHTS.slice(0, 19);

function seed(presets: Preset[], decks: Deck[], settings?: unknown): void {
  localStorage.setItem('runora_seed_version', '3');
  localStorage.setItem('runora_presets', JSON.stringify(presets));
  localStorage.setItem('runora_decks', JSON.stringify(decks));
  if (settings) localStorage.setItem('runora_fsrs_settings', JSON.stringify(settings));
  else localStorage.removeItem('runora_fsrs_settings');
}

describe('StorageService.getEffectiveFSRSParams', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('resolves the retention of the preset the deck follows', () => {
    seed(
      [
        makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 }),
        makePreset('preset-hard', { requestRetention: 0.85, maximumInterval: 18000 }),
      ],
      [makeDeck('deck-a', 'preset-hard')]
    );

    const params = StorageService.getEffectiveFSRSParams('deck-a');
    assert.equal(params.requestRetention, 0.85);
    assert.equal(params.maximumInterval, 18000);
  });

  it('lets the deck override win over its preset', () => {
    seed(
      [
        makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 }),
        makePreset('preset-hard', { requestRetention: 0.85, maximumInterval: 18000 }),
      ],
      [
        makeDeck('deck-a', 'preset-hard', {
          requestRetention: 0.95,
          maximumInterval: 9000,
        }),
      ]
    );

    const params = StorageService.getEffectiveFSRSParams('deck-a');
    assert.equal(params.requestRetention, 0.95);
    assert.equal(params.maximumInterval, 9000);
  });

  it('takes the weights of the preset when the deck has none', () => {
    seed(
      [
        makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 }),
        makePreset('preset-tuned', {
          requestRetention: 0.9,
          maximumInterval: 36500,
          w: [...DEFAULT_FSRS_WEIGHTS],
        }),
      ],
      [makeDeck('deck-a', 'preset-tuned')]
    );

    const params = StorageService.getEffectiveFSRSParams('deck-a');
    assert.equal(params.w.length, 21);
    assert.equal(params.w[20], DEFAULT_FSRS_WEIGHTS[20]);
  });

  it('keeps inheriting the weights when only the retention is overridden', () => {
    seed(
      [
        makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 }),
        makePreset('preset-tuned', {
          requestRetention: 0.9,
          maximumInterval: 36500,
          w: [...DEFAULT_FSRS_WEIGHTS],
        }),
      ],
      [
        makeDeck('deck-a', 'preset-tuned', {
          requestRetention: 0.95,
          maximumInterval: 36500,
        }),
      ]
    );

    const params = StorageService.getEffectiveFSRSParams('deck-a');
    assert.equal(params.requestRetention, 0.95);
    assert.equal(params.w.length, 21);
  });

  it('takes the weights of the deck override over the preset ones', () => {
    seed(
      [
        makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 }),
        makePreset('preset-tuned', {
          requestRetention: 0.9,
          maximumInterval: 36500,
          w: [...DEFAULT_FSRS_WEIGHTS],
        }),
      ],
      [
        makeDeck('deck-a', 'preset-tuned', {
          requestRetention: 0.9,
          maximumInterval: 36500,
          w: [...FSRS5_WEIGHTS],
        }),
      ]
    );

    const params = StorageService.getEffectiveFSRSParams('deck-a');
    assert.equal(params.w.length, 19);
  });

  it('follows the factory sheet for an unknown deck', () => {
    seed(
      [makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 })],
      [],
      {
        requestRetention: 0.8,
        maximumInterval: 12345,
        w: [...FSRS5_WEIGHTS],
        enableFuzz: true,
      }
    );

    const params = StorageService.getEffectiveFSRSParams('deck-does-not-exist');
    // The factory sheet is what a deck without a preset follows.
    assert.equal(params.requestRetention, 0.9);
    assert.equal(params.maximumInterval, 36500);
    // It defines no weights, so the global ones are inherited.
    assert.equal(params.w.length, 19);
  });

  it('gives each deck its own decay through the resolved weights', () => {
    seed(
      [
        makePreset('preset-default', { requestRetention: 0.9, maximumInterval: 36500 }),
        makePreset('preset-fsrs6', {
          requestRetention: 0.9,
          maximumInterval: 36500,
          w: [...DEFAULT_FSRS_WEIGHTS],
        }),
        makePreset('preset-fsrs5', {
          requestRetention: 0.9,
          maximumInterval: 36500,
          w: [...FSRS5_WEIGHTS],
        }),
      ],
      [makeDeck('deck-6', 'preset-fsrs6'), makeDeck('deck-5', 'preset-fsrs5')]
    );

    const engine6 = new FSRS(StorageService.getEffectiveFSRSParams('deck-6'));
    const engine5 = new FSRS(StorageService.getEffectiveFSRSParams('deck-5'));

    assert.equal(engine6.decay(), DEFAULT_FSRS_WEIGHTS[20]);
    assert.equal(engine5.decay(), 0.5);
    // The two decay exponents must actually change the retrievability curve.
    assert.notEqual(engine6.retrievability(10, 20), engine5.retrievability(10, 20));
  });
});
