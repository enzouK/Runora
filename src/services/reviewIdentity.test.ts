/**
 * T16 — identidade universal da REVISÃO (revlog).
 *
 * O QUE ESTE TESTE PRENDE:
 *
 * 1. O id universal é **determinístico**: o mesmo card (GUID da nota +
 *    ordem do template) + o mesmo horário = **o mesmo id em qualquer
 *    aparelho** (é o que faz o celular e o PC terem o mesmo histórico).
 * 2. A revisão que chega do Drive é **recalculada** com esse id (o id
 *    legado do outro aparelho é trocado) — e o id universal que já veio
 *    é preservado.
 * 3. A revisão de um card **APAGADO** viaja (não é mais descartada) — é
 *    o que o addon *Review Heatmap* conta.
 * 4. A mesma revisão **não entra duas vezes** (base + delta), mesmo com
 *    ids diferentes.
 * 5. A migração local re-estampa as revisões antigas **sem mexer no USN**
 *    (o conteúdo da coleção não muda).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import {
  buildCardIdentityIndex,
  hasUniversalId,
  isUniversalReviewId,
  mergeRevlogEntries,
  reviewDedupeKeys,
  universalReviewId,
} from './reviewIdentity';
import { planReviewIdentityMigration } from './reviewMigration';
import { resolveRemoteRevlog } from './syncRevlog';
import { applyDeltaToStorage } from './syncApplyDelta';
import { applyDeltaToCollection, type SyncDelta } from './syncDelta';
import type { Card, Note, RevlogEntry, Tombstone } from '../types/runora';

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

/* ── atalhos de criação ─────────────────────────────────────────────────── */

function makeNote(partial: Partial<Note> = {}): Note {
  return {
    id: partial.id ?? 'note-1',
    guid: partial.guid ?? 'guid-1',
    deckId: partial.deckId ?? 'deck-default',
    noteTypeId: partial.noteTypeId ?? 'nt-basic',
    fields: partial.fields ?? { Frente: 'pergunta', Verso: 'resposta' },
    media: partial.media ?? [],
    tags: partial.tags ?? [],
    createdAt: partial.createdAt ?? 1000,
    updatedAt: partial.updatedAt ?? 1000,
    usn: partial.usn,
  };
}

function makeCard(partial: Partial<Card> = {}): Card {
  return {
    id: partial.id ?? 'card-1',
    noteId: partial.noteId ?? 'note-1',
    deckId: partial.deckId ?? 'deck-default',
    templateOrd: partial.templateOrd ?? 0,
    position: partial.position ?? 1,
    due: partial.due ?? 1000,
    fsrs: partial.fsrs ?? {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
    },
    createdAt: partial.createdAt ?? 1000,
    updatedAt: partial.updatedAt ?? 1000,
    usn: partial.usn,
  } as Card;
}

function makeRevlog(partial: Partial<RevlogEntry> = {}): RevlogEntry {
  return {
    id: partial.id ?? 'rev-1',
    cardId: partial.cardId ?? 'card-1',
    noteId: partial.noteId ?? 'note-1',
    rating: partial.rating ?? 3,
    reviewTime: partial.reviewTime ?? 1000,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 1,
    state: partial.state ?? 2,
    stability: partial.stability ?? 1,
    difficulty: partial.difficulty ?? 5,
    usn: partial.usn,
  };
}

function makeDelta(partial: Partial<SyncDelta> = {}): SyncDelta {
  return {
    version: 1,
    baseUsn: partial.baseUsn ?? 285,
    currentUsn: partial.currentUsn ?? 296,
    generatedAt: 1794711594605,
    deviceId: 'device-remoto',
    deviceName: 'Windows',
    decks: partial.decks ?? [],
    noteTypes: partial.noteTypes ?? [],
    notes: partial.notes ?? [],
    cards: partial.cards ?? [],
    revlog: partial.revlog ?? [],
    presets: partial.presets ?? [],
    tombstones: partial.tombstones ?? [],
    mediaManifest: partial.mediaManifest ?? {},
    noteGuids: partial.noteGuids,
  };
}

function limpar(): void {
  localStorage.clear();
  localStorage.setItem('runora_seed_version', '3');
}

describe('T16 — o id universal da revisão', () => {
  it('o mesmo card + o mesmo horário = o mesmo id em qualquer aparelho', () => {
    const a = universalReviewId(1794774974470, { guid: 'guid-x', templateOrd: 0 });
    const b = universalReviewId(1794774974470, { guid: 'guid-x', templateOrd: 0 });
    assert.equal(a, b);
    assert.ok(isUniversalReviewId(a), `o id tem que ter o formato universal: ${a}`);
  });

  it('card diferente ou horário diferente = id diferente', () => {
    const base = universalReviewId(1000, { guid: 'guid-x', templateOrd: 0 });
    assert.notEqual(base, universalReviewId(1000, { guid: 'guid-y', templateOrd: 0 }));
    assert.notEqual(base, universalReviewId(1000, { guid: 'guid-x', templateOrd: 1 }));
    assert.notEqual(base, universalReviewId(1001, { guid: 'guid-x', templateOrd: 0 }));
  });

  it('o id legado (aleatório) não é universal', () => {
    assert.equal(isUniversalReviewId('rev-1794774974470-9upa'), false);
    assert.equal(isUniversalReviewId('rev-sync-card-x-1794774974470'), false);
  });

  it('o card apagado continua com identidade (vem do tombstone)', () => {
    const tombstone: Tombstone = {
      type: 'card',
      id: 'card-apagado',
      guid: 'guid-x',
      templateOrd: 0,
      usn: 10,
      deletedAt: 1,
    };
    const index = buildCardIdentityIndex([], [], [tombstone]);
    assert.deepEqual(index.get('card-apagado'), { guid: 'guid-x', templateOrd: 0 });
  });
});

describe('T16 — a revisão que chega do Drive', () => {
  beforeEach(limpar);

  it('recalcula o id legado para o universal', () => {
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [makeCard({ id: 'card-local', noteId: 'note-local', usn: 100 })];
    const delta = makeDelta({
      revlog: [
        makeRevlog({
          id: 'rev-1794536503877-0d1h',
          cardId: 'card-local',
          noteId: 'note-local',
          reviewTime: 1794536503875,
          usn: 209,
        }),
      ],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [] });

    assert.equal(r.entries.length, 1);
    assert.equal(
      r.entries[0].id,
      universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 })
    );
  });

  it('preserva o id universal que veio (o outro aparelho calculou o mesmo)', () => {
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [makeCard({ id: 'card-local', noteId: 'note-local', usn: 100 })];
    const idUniversal = universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 });
    const delta = makeDelta({
      revlog: [
        makeRevlog({
          id: idUniversal,
          cardId: 'card-local',
          noteId: 'note-local',
          reviewTime: 1794536503875,
          usn: 209,
        }),
      ],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [] });

    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].id, idUniversal);
  });

  it('a revisão de um card APAGADO viaja (o heatmap conta ela)', () => {
    const delta = makeDelta({
      noteGuids: { 'note-remota': 'guid-y' },
      revlog: [
        makeRevlog({ id: 'rev-1', cardId: 'card-remoto', noteId: 'note-remota', usn: 289 }),
      ],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes: [], cards: [], revlog: [] });

    assert.equal(r.entries.length, 1, 'a revisão não pode ser descartada');
    assert.equal(r.orphans, 1);
  });

  it('a revisão de um card apagado ganha o id universal pelo tombstone', () => {
    const tombstones: Tombstone[] = [
      {
        type: 'card',
        id: 'card-remoto',
        guid: 'guid-y',
        templateOrd: 0,
        usn: 293,
        deletedAt: 1,
      },
    ];
    const delta = makeDelta({
      tombstones,
      revlog: [
        makeRevlog({
          id: 'rev-1793456624818-n3uf',
          cardId: 'card-remoto',
          noteId: 'note-remota',
          reviewTime: 1793456624818,
          usn: 207,
        }),
      ],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes: [], cards: [], revlog: [] });

    assert.equal(r.entries.length, 1);
    assert.equal(
      r.entries[0].id,
      universalReviewId(1793456624818, { guid: 'guid-y', templateOrd: 0 })
    );
  });
});

describe('T16 — a mesma revisão não entra duas vezes', () => {
  beforeEach(limpar);

  it('base e delta com ids diferentes = uma revisão só', () => {
    // a base do Drive tem a revisão com o id legado; o delta tem a mesma
    // revisão com o id universal (o outro aparelho já migrou).
    const base = makeRevlog({
      id: 'rev-sync-card-x-1794536503875',
      cardId: 'card-x',
      reviewTime: 1794536503875,
      usn: 209,
    });
    const delta = makeRevlog({
      id: universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 }),
      cardId: 'card-x',
      reviewTime: 1794536503875,
      usn: 209,
    });

    const r = mergeRevlogEntries([base], [delta], () => ({
      guid: 'guid-x',
      templateOrd: 0,
    }));

    assert.equal(r.merged.length, 1, 'a revisão não pode entrar duplicada');
    assert.equal(r.replaced, 1, 'o id universal substitui o legado');
    assert.equal(r.merged[0].id, delta.id);
  });

  it('a mesma revisão com o MESMO id é ignorada', () => {
    const entry = makeRevlog({
      id: universalReviewId(1000, { guid: 'guid-x', templateOrd: 0 }),
      cardId: 'card-x',
      reviewTime: 1000,
    });
    const r = mergeRevlogEntries([entry], [entry], () => ({ guid: 'guid-x', templateOrd: 0 }));
    assert.equal(r.merged.length, 1);
    assert.equal(r.duplicates, 1);
    assert.equal(r.applied, 0);
  });

  it('no merge base+delta a revisão não é contada 2×', () => {
    const colecao = {
      decks: [] as any[],
      noteTypes: [] as any[],
      notes: [makeNote({ id: 'n1', guid: 'guid-x' })],
      cards: [makeCard({ id: 'c1', noteId: 'n1' })],
      revlog: [
        makeRevlog({
          id: 'rev-sync-card-x-1794536503875',
          cardId: 'c1',
          noteId: 'n1',
          reviewTime: 1794536503875,
          usn: 209,
        }),
      ] as RevlogEntry[],
    };
    const delta = makeDelta({
      revlog: [
        makeRevlog({
          id: universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 }),
          cardId: 'c1',
          noteId: 'n1',
          reviewTime: 1794536503875,
          usn: 209,
        }),
      ],
    });

    applyDeltaToCollection(colecao, delta);

    assert.equal(colecao.revlog.length, 1, 'a revisão entrou 2× (base + delta)');
    assert.equal(
      colecao.revlog[0].id,
      universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 })
    );
  });
});

describe('T16 — a migração local (cada aparelho, sozinho, sem tráfego)', () => {
  beforeEach(limpar);

  /** O plano da migração (função pura) — para conferir o que ela faria. */
  const planejar = () =>
    planReviewIdentityMigration({
      revlog: StorageService.getRevlog(),
      notes: StorageService.getNotes(),
      cards: StorageService.getCards(),
      tombstones: StorageService.getCardTombstones(),
    });

  it('re-estampa a revisão legada e NÃO mexe no USN', () => {
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-x', usn: 100 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 100 })]);
    StorageService.adoptUsnCounter(296);
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-1794536503877-0d1h', cardId: 'card-1', noteId: 'note-1', reviewTime: 1794536503875, usn: 209 })
    );
    const antes = StorageService.getCurrentUsn();

    const r = planejar();
    StorageService.migrateReviewIdentity();

    assert.equal(r.changed, 1);
    assert.equal(StorageService.getRevlog()[0].id, universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 }));
    assert.equal(StorageService.getRevlog()[0].usn, 209, 'o USN da revisão é preservado');
    assert.equal(StorageService.getCurrentUsn(), antes, 'o contador não pode andar');
  });

  it('tira a revisão repetida (a mesma revisão 2× com ids diferentes)', () => {
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-x', usn: 100 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 100 })]);
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-1794536503877-0d1h', cardId: 'card-1', noteId: 'note-1', reviewTime: 1794536503875, usn: 209 })
    );
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-sync-card-1-1794536503875', cardId: 'card-1', noteId: 'note-1', reviewTime: 1794536503875, usn: 209 })
    );

    const r = planejar();
    StorageService.migrateReviewIdentity();

    assert.equal(r.removed, 1);
    assert.equal(StorageService.getRevlog().length, 1);
  });

  it('a migração é idempotente (abrir o app de novo não muda nada)', () => {
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-x', usn: 100 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 100 })]);
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-1794536503877-0d1h', cardId: 'card-1', noteId: 'note-1', reviewTime: 1794536503875, usn: 209 })
    );

    StorageService.migrateReviewIdentity();
    const idDepois = StorageService.getRevlog()[0].id;
    const r = planejar();

    assert.equal(r.changed, 0);
    assert.equal(StorageService.getRevlog()[0].id, idDepois);
  });

  it('a revisão de card APAGADO continua guardada (o heatmap conta ela)', () => {
    // card apagado: não há card local e não há tombstone → a identidade não
    // é possível → a revisão fica com o id que tinha (NUNCA é descartada).
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-1793456624818-n3uf', cardId: 'card-apagado', noteId: 'note-apagada', reviewTime: 1793456624818, usn: 207 })
    );

    const r = planejar();

    assert.equal(r.changed, 0);
    assert.equal(StorageService.getRevlog().length, 1, 'a revisão não pode ser descartada');
  });

  it('no instante da DELEÇÃO a revisão já ganha o id universal', () => {
    // O tombstone é limpo depois que a deleção é publicada → a identidade
    // do card apagado só existe enquanto ele está lá. Por isso a migração
    // também roda no momento da deleção.
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-x', usn: 100 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 100 })]);
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-1794536503877-0d1h', cardId: 'card-1', noteId: 'note-1', reviewTime: 1794536503875, usn: 209 })
    );

    StorageService.deleteCard('card-1');

    assert.equal(
      StorageService.getRevlog()[0].id,
      universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 }),
      'a revisão do card apagado tem que ganhar o id universal'
    );
    assert.equal(StorageService.getRevlog().length, 1, 'a revisão não pode ser descartada');
  });

  it('apagar a NOTA também dá o id universal às revisões dos cards dela', () => {
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-x', usn: 100 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 100 })]);
    StorageService.saveRevlog(
      makeRevlog({ id: 'rev-1794536503877-0d1h', cardId: 'card-1', noteId: 'note-1', reviewTime: 1794536503875, usn: 209 })
    );

    StorageService.deleteNote('note-1');

    assert.equal(
      StorageService.getRevlog()[0].id,
      universalReviewId(1794536503875, { guid: 'guid-x', templateOrd: 0 })
    );
    assert.equal(StorageService.getRevlog().length, 1);
  });
});

describe('T16 — as chaves de dedupe', () => {
  it('a identidade e o card são as duas chaves (a órfã casa pelo card)', () => {
    const entry = makeRevlog({ cardId: 'card-x', reviewTime: 1000 });
    const comIdentidade = reviewDedupeKeys(entry, { guid: 'guid-x', templateOrd: 0 });
    assert.equal(comIdentidade.length, 2);
    assert.ok(comIdentidade.some((k) => k.includes('guid-x')));
    assert.ok(comIdentidade.some((k) => k.includes('card-x')));

    const semIdentidade = reviewDedupeKeys(entry, undefined);
    assert.equal(semIdentidade.length, 1);
    assert.ok(semIdentidade[0].includes('card-x'));
  });

  it('hasUniversalId reconhece o id novo', () => {
    const novo = makeRevlog({ id: universalReviewId(1000, { guid: 'g', templateOrd: 0 }) });
    const legado = makeRevlog({ id: 'rev-1000-abc' });
    assert.equal(hasUniversalId(novo), true);
    assert.equal(hasUniversalId(legado), false);
  });
});

describe('T16 — o caminho incremental guarda a órfã', () => {
  beforeEach(limpar);

  it('aplicar o delta guarda a revisão de card apagado e não duplica', () => {
    const delta = makeDelta({
      revlog: [
        makeRevlog({ id: 'rev-1', cardId: 'card-remoto', noteId: 'note-remota', reviewTime: 1794711535226, usn: 289 }),
      ],
    });

    const primeiro = applyDeltaToStorage(delta, 285);
    assert.equal(primeiro.revlogApplied, 1);
    assert.equal(primeiro.revlogOrphans, 1);
    assert.equal(StorageService.getRevlog().length, 1);

    // o delta do Drive é acumulado: aplicar de novo não duplica
    const segundo = applyDeltaToStorage(delta, 296);
    assert.equal(segundo.revlogApplied, 0);
    assert.equal(StorageService.getRevlog().length, 1);
  });
});

describe('T16 — o ciclo real: celular e PC com o MESMO histórico', () => {
  beforeEach(limpar);

  it('5 revisões de um card que foi apagado chegam no outro aparelho', () => {
    // ── o PC: estuda 5 vezes e DEPOIS apaga o card ──
    const reviews = [1000, 2000, 3000, 4000, 5000].map((t) =>
      makeRevlog({
        id: universalReviewId(t, { guid: 'guid-x', templateOrd: 0 }),
        cardId: 'card-pc',
        noteId: 'note-pc',
        reviewTime: t,
        usn: 200,
      })
    );

    // ── o delta que o PC publica (as revisões + a deleção do card) ──
    const tombstones: Tombstone[] = [
      {
        type: 'note',
        id: 'note-pc',
        guid: 'guid-x',
        usn: 210,
        deletedAt: 1,
      },
      {
        type: 'card',
        id: 'card-pc',
        guid: 'guid-x',
        templateOrd: 0,
        usn: 210,
        deletedAt: 1,
      },
    ];
    const delta = makeDelta({ revlog: reviews, tombstones, currentUsn: 210 });

    // ── o celular, que não tinha nada: aplica o delta ──
    const r = applyDeltaToStorage(delta, 100);

    assert.equal(r.revlogApplied, 5, 'as 5 revisões têm que chegar');
    assert.equal(r.revlogOrphans, 5, 'o card foi apagado → as 5 são órfãs');
    const local = StorageService.getRevlog();
    assert.equal(local.length, 5);
    assert.deepEqual(
      local.map((e) => e.id).sort(),
      reviews.map((e) => e.id).sort(),
      'os ids têm que ser os MESMOS nos dois aparelhos'
    );

    // ── o celular recebe a base (que tem as mesmas revisões) + o delta ──
    // (a base e o delta se sobrepõem: a revisão não pode entrar 2×)
    const colecao = {
      decks: [] as any[],
      noteTypes: [] as any[],
      notes: [] as any[],
      cards: [] as any[],
      revlog: reviews.map((e) => ({ ...e })) as RevlogEntry[],
    };
    applyDeltaToCollection(colecao, delta);
    assert.equal(colecao.revlog.length, 5, 'a revisão entrou 2× (base + delta)');

    // ── e a contagem do celular é a mesma do PC ──
    assert.equal(StorageService.getCollectionCounts().revlog, 5);
  });
});
