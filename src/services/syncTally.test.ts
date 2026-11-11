/**
 * Testes dos contadores ao vivo do painel de sync (estilo Anki).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptySyncTally,
  bumpTally,
  tallyFromCounts,
  tallyChanged,
  tallyRemoved,
  tallySent,
  tallyReceived,
} from './syncTally';

describe('syncTally', () => {
  it('emptySyncTally() começa tudo em zero', () => {
    assert.deepEqual(emptySyncTally(), {
      addedUp: 0,
      addedDown: 0,
      removedUp: 0,
      removedDown: 0,
    });
  });

  it('bumpTally() soma incrementos sem alterar o objeto base (puro)', () => {
    const base = emptySyncTally();
    const next = bumpTally(base, { addedUp: 2, addedDown: 1 });
    assert.deepEqual(next, { addedUp: 2, addedDown: 1, removedUp: 0, removedDown: 0 });
    // o objeto original não mudou
    assert.deepEqual(base, emptySyncTally());
  });

  it('bumpTally() acumula chamadas sucessivas (sync em tempo real)', () => {
    let t = emptySyncTally();
    t = bumpTally(t, { addedDown: 3 });
    t = bumpTally(t, { addedDown: 2, removedUp: 1 });
    t = bumpTally(t, { addedUp: 1 });
    assert.deepEqual(t, { addedUp: 1, addedDown: 5, removedUp: 1, removedDown: 0 });
  });

  it('bumpTally() com campos omitidos soma zero', () => {
    const t = bumpTally(emptySyncTally(), {});
    assert.deepEqual(t, emptySyncTally());
  });

  it('tallyFromCounts() soma decks+notas+cards+presets na direção ↑', () => {
    const add = tallyFromCounts({ decks: 1, notes: 2, cards: 3 }, 'up');
    assert.deepEqual(add, { addedUp: 6 });
  });

  it('tallyFromCounts() na direção ↓', () => {
    const add = tallyFromCounts({ notes: 2, presets: 1 }, 'down');
    assert.deepEqual(add, { addedDown: 3 });
  });

  it('tallyFromCounts() ignora mídia/preferências/extensões (não são itens de coleção)', () => {
    const add = tallyFromCounts({ notes: 0, cards: 0 } as never, 'up');
    assert.deepEqual(add, {});
    // counts vazio ou undefined → nada a somar
    assert.deepEqual(tallyFromCounts(undefined, 'up'), {});
    assert.deepEqual(tallyFromCounts({}, 'down'), {});
  });

  it('tallyFromCounts() com tudo zero não gera incremento', () => {
    assert.deepEqual(tallyFromCounts({ decks: 0, notes: 0, cards: 0, presets: 0 }, 'up'), {});
  });

  it('tallyChanged()/tallyRemoved() somam as duas direções', () => {
    const t: Parameters<typeof tallyChanged>[0] = {
      addedUp: 2,
      addedDown: 3,
      removedUp: 1,
      removedDown: 4,
    };
    assert.equal(tallyChanged(t), 5);
    assert.equal(tallyRemoved(t), 5);
  });

  it('tallySent()/tallyReceived() separam ↑ e ↓', () => {
    const t: Parameters<typeof tallySent>[0] = {
      addedUp: 2,
      addedDown: 3,
      removedUp: 1,
      removedDown: 4,
    };
    assert.equal(tallySent(t), 3);
    assert.equal(tallyReceived(t), 7);
  });
});
