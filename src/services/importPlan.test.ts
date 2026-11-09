/**
 * importPlan — plano de importação: análise + aplicação nos dois modos.
 *
 * StorageService lê a coleção de `localStorage`; como os outros testes de
 * serviço, roda sobre um MemoryStorage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import {
  analyzeImport,
  applyImportPlan,
  type ImportableCollection,
} from './importPlan';
import type { Card, Deck, Note, NoteType } from '../types/runora';

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

function makeDeck(id: string, name: string): Deck {
  return { id, name, description: '', createdAt: 1, updatedAt: 1 };
}

function makeNoteType(id: string, name: string, isCloze = false): NoteType {
  return {
    id,
    name,
    isCloze,
    css: '',
    hintsEnabled: false,
    voiceRecordingEnabled: false,
    furiganaEnabled: false,
    fields: [
      { id: 'f1', name: 'Frente', ord: 0 },
      { id: 'f2', name: 'Verso', ord: 1 },
    ],
    templates: [
      { id: 't1', name: 'Card 1', ord: 0, qfmt: '{{Frente}}', afmt: '{{Frente}}<hr>{{Verso}}' },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeNote(partial: Partial<Note> & { id: string }): Note {
  return {
    noteTypeId: 'nt-a',
    deckId: 'deck-in',
    fields: { Frente: 'gato', Verso: 'cat' },
    media: [],
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

function makeCard(partial: Partial<Card> & { id: string; noteId: string }): Card {
  return {
    deckId: 'deck-in',
    templateOrd: 0,
    due: 0,
    fsrs: {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
    },
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

function collectionData(partial: Partial<ImportableCollection> = {}): ImportableCollection {
  return {
    kind: 'runora',
    decks: [makeDeck('deck-in', 'Japanese')],
    noteTypes: [makeNoteType('nt-a', 'Básico')],
    notes: [makeNote({ id: 'note-in-1', guid: 'guid-A' })],
    cards: [makeCard({ id: 'card-in-1', noteId: 'note-in-1' })],
    ...partial,
  };
}

describe('analyzeImport', () => {
  beforeEach(() => {
    localStorage.clear();
    // Impede o re-seed dos decks/presets de fábrica nos testes com seed manual
    localStorage.setItem('runora_seed_version', '3');
  });

  it('coleção local vazia: tudo é novo, nada é conflito', async () => {
    const plan = analyzeImport(collectionData());
    assert.equal(plan.summary.newNotesCount, 1);
    assert.equal(plan.summary.existingNotesCount, 0);
    assert.equal(plan.summary.newCardsCount, 1);
    assert.deepEqual(plan.summary.newDeckNames, ['Japanese']);
  });

  it('a mesma nota (GUID igual) é reconhecida, mesmo com id diferente', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({ id: 'note-local-1', guid: 'guid-B', deckId: 'deck-loc', noteTypeId: 'nt-loc' }),
    ]));
    localStorage.setItem('runora_cards', JSON.stringify([
      makeCard({ id: 'card-local-1', noteId: 'note-local-1', deckId: 'deck-loc' }),
    ]));
    localStorage.setItem('runora_decks', JSON.stringify([
      makeDeck('deck-loc', 'Japanese'),
    ]));
    localStorage.setItem('runora_notetypes', JSON.stringify([makeNoteType('nt-loc', 'Básico')]));

    const plan = analyzeImport(collectionData());
    assert.equal(plan.summary.existingNotesCount, 1);
    assert.equal(plan.summary.newCardsCount, 0); // mesma nota, mesmo template
    assert.equal(plan.deckLinks.get('deck-in'), 'deck-loc'); // casou por nome
    assert.equal(plan.noteLinks.get('note-in-1'), 'note-local-1');
  });

  it('sem GUID dos dois lados: assinatura por conteúdo reconhece a nota', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({
        id: 'note-local-open',
        // sem guid —
        fields: { Frente: ' <b>gato</b> ', Verso: 'cat ' }, // conteúdo equivalente
        noteTypeId: 'nt-loc',
        deckId: 'deck-loc',
      }),
    ]));
    localStorage.setItem('runora_decks', JSON.stringify([makeDeck('deck-loc', 'Japanese')]));
    localStorage.setItem('runora_notetypes', JSON.stringify([makeNoteType('nt-loc', 'Básico')]));

    const incoming = collectionData({
      notes: [makeNote({ id: 'note-in-1', fields: { Frente: 'gato', Verso: 'cat' } })],
    });
    const plan = analyzeImport(incoming);
    assert.equal(plan.summary.existingNotesCount, 1);
    assert.equal(plan.noteLinks.get('note-in-1'), 'note-local-open');
  });

  it('conteúdo diferente não casa (nota nova mesmo com o mesmo tipo/deck)', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({ id: 'note-local-1', fields: { Frente: 'cão', Verso: 'dog' } }),
    ]));
    const plan = analyzeImport(collectionData({ notes: [makeNote({ id: 'note-in-1', guid: 'guid-A' })] }));
    assert.equal(plan.summary.newNotesCount, 1);
    assert.equal(plan.summary.existingNotesCount, 0);
  });

  it('garante GUID nas notas do pacote que não tinham (backfill na análise)', async () => {
    const data = collectionData({
      notes: [makeNote({ id: 'note-in-x', guid: undefined as unknown as string })],
    });
    const plan = analyzeImport(data);
    assert.ok(plan.data.notes[0].guid && plan.data.notes[0].guid!.length >= 16);
  });

  it('mesma nota (mesmo GUID) com conteúdo diferente entra como conflito de conteúdo', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({ id: 'note-local-1', guid: 'guid-A', fields: { Frente: 'gato', Verso: 'cat (editado aqui)' } }),
    ]));
    const plan = analyzeImport(collectionData());
    assert.equal(plan.summary.existingNotesCount, 1);
    assert.equal(plan.summary.conflictingNotesCount, 1); // há disputa a perguntar
  });

  it('mesma nota com conteúdo idêntico não é conflito (nem dispara pergunta)', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({ id: 'note-local-1', guid: 'guid-A' }),
    ]));
    const plan = analyzeImport(collectionData());
    assert.equal(plan.summary.conflictingNotesCount, 0);
  });
});

describe('applyImportPlan', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('runora_seed_version', '3');
  });

  it('modo keep: nota existente fica intacta; a nova entra', async () => {
    seedLocalOneNote('card-local-old', { stability: 5 });
    const data = collectionData({
      notes: [
        makeNote({ id: 'note-in-1', guid: 'guid-A' }), // existente
        makeNote({ id: 'note-in-2', guid: 'guid-N', fields: { Frente: 'cão', Verso: 'dog' } }),
      ],
      cards: [
        makeCard({ id: 'card-in-1', noteId: 'note-in-1', fsrs: dummyFsrs({ stability: 99 }) }),
        makeCard({ id: 'card-in-2', noteId: 'note-in-2' }),
      ],
    });
    const plan = analyzeImport(data);
    const r = await applyImportPlan(plan, 'keep');

    const notes = StorageService.getNotes();
    assert.equal(notes.length, 2);
    const kept = notes.find((n) => n.guid === 'guid-A')!;
    assert.equal(kept.createdAt, 2000); // não mexe na de cá
    assert.equal(r.keptDuplicates, 1);
    assert.equal(r.addedNotes, 1);

    const cards = StorageService.getCards();
    const keptCard = cards.find((c) => c.noteId === kept.id)!;
    assert.equal(keptCard.id, 'card-local-old');
    assert.equal(keptCard.fsrs.stability, 5); // progresso de cá intacto
    assert.equal(cards.length, 2); // + o card da nota nova
  });

  it('modo overwrite: FSRS fica com a versão estudada mais recentemente', async () => {
    seedLocalOneNote('card-local-old', { stability: 5, lastReview: 5_000 });
    const data = collectionData({
      cards: [
        makeCard({
          id: 'card-in-1',
          noteId: 'note-in-1',
          fsrs: dummyFsrs({ stability: 9, lastReview: 6_000 }), // estudada DEPOIS
        }),
      ],
    });
    const r = await applyImportPlan(analyzeImport(data), 'overwrite');
    assert.equal(r.updatedCards, 1);

    const card = StorageService.getCards().find((c) => c.id === 'card-local-old')!;
    assert.equal(card.fsrs.stability, 9); // venceu a mais recente
    assert.equal(card.fsrs.lastReview, 6_000);

    // E o inverso: local mais recente fica com a de cá
    localStorage.clear();
    seedLocalOneNote('card-local-new', { stability: 7, lastReview: 99_000 });
    await applyImportPlan(analyzeImport(collectionData({
      cards: [makeCard({ id: 'card-in-1', noteId: 'note-in-1', fsrs: dummyFsrs({ stability: 99, lastReview: 6_000 }) })],
    })), 'overwrite');
    const card2 = StorageService.getCards().find((c) => c.id === 'card-local-new')!;
    assert.equal(card2.fsrs.stability, 7);
    assert.equal(card2.fsrs.lastReview, 99_000);
  });

  it('overwrite: nota existente recebe o conteúdo do pacote e o deck casa por nome', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({
        id: 'note-local-1',
        guid: 'guid-A',
        deckId: 'deck-loc',
        fields: { Frente: 'gato', Verso: 'cat (antigo)' },
        createdAt: 2000,
        updatedAt: 3000,
      }),
    ]));
    localStorage.setItem('runora_cards', JSON.stringify([
      makeCard({ id: 'card-local-1', noteId: 'note-local-1', deckId: 'deck-loc' }),
    ]));
    localStorage.setItem('runora_decks', JSON.stringify([makeDeck('deck-loc', 'Japanese')]));

    const data = collectionData({
      notes: [makeNote({ id: 'note-in-1', guid: 'guid-A', deckId: 'deck-in', updatedAt: 4000 })],
      cards: [makeCard({ id: 'card-in-1', noteId: 'note-in-1', deckId: 'deck-in' })],
    });
    const r = await applyImportPlan(analyzeImport(data), 'overwrite');

    const note = StorageService.getNotes().find((n) => n.guid === 'guid-A')!;
    assert.equal(note.id, 'note-local-1'); // mesmo "físico" de cá
    assert.equal(note.deckId, 'deck-loc'); // mesmo deck (casado por nome)
    assert.equal(note.fields.Verso, 'cat'); // conteúdo do pacote venceu
    assert.equal(note.createdAt, 1000); // a mais antiga das duas
    assert.equal(note.updatedAt, 4000); // a mais recente das duas
    assert.equal(r.addedDecks, 0); // "Japanese" já existia — nada duplicado
    assert.equal(StorageService.getDecks().length, 1);
  });

  it('revlog: união sem duplicar (mesma revisão dos dois lados entra uma vez)', async () => {
    const e = (id: number, cardId: string) => ({
      id: String(id),
      cardId,
      noteId: 'n',
      rating: 3 as const,
      reviewTime: id,
      elapsedDays: 0,
      scheduledDays: 1,
      state: 2 as const,
      stability: 1,
      difficulty: 5,
    });
    localStorage.setItem('runora_revlog', JSON.stringify([
      e(1000, 'card-local-1'),
      e(2000, 'card-local-1'),
    ]));
    const data = collectionData({
      revlog: [e(2000, 'card-local-1'), e(3000, 'card-local-1')],
    });
    const before = StorageService.getRevlog().length;
    const r = await applyImportPlan(analyzeImport(data), 'overwrite');
    const after = StorageService.getRevlog();
    assert.equal(after.length, before + r.addedRevlog);
    assert.equal(r.addedRevlog, 1); // só a revisão 3000 era nova
    assert.equal(after.filter((x) => x.reviewTime === 2000).length, 1);
  });

  it('FSRS global: em keep fica o de cá; em overwrite entra o do arquivo', async () => {
    seedLocalOneNote('card-local-1', {});
    const withFsrs = collectionData({
      fsrsParameters: { requestRetention: 0.8, maximumInterval: 100, w: new Array(19).fill(0.5), enableFuzz: false },
    });

    // o plano avisa que os parâmetros são diferentes
    const plan = analyzeImport(withFsrs);
    assert.equal(plan.summary.globalFsrsChanged, true);

    // keep: preserva o de cá
    await applyImportPlan(plan, 'keep');
    assert.notEqual(StorageService.getFSRSSettings().requestRetention, 0.8); // preservou

    // overwrite: entra o do arquivo
    await applyImportPlan(analyzeImport(withFsrs), 'overwrite');
    assert.equal(StorageService.getFSRSSettings().requestRetention, 0.8);

    // coleção vazia: restauração simples (entra em qualquer modo)
    localStorage.clear();
    await applyImportPlan(analyzeImport(withFsrs), 'keep');
    assert.equal(StorageService.getFSRSSettings().requestRetention, 0.8);
  });

  it('opções do deck (parâmetros FSRS do deck) diferentes entram no plano', async () => {
    seedLocalOneNote('card-local-1', {});
    const localDeck = StorageService.getDecks().find((d) => d.name === 'Japanese')!;
    localDeck.fsrsParams = { requestRetention: 0.9, w: [1, 2, 3] };
    StorageService.saveDecks([localDeck]);

    const incoming = collectionData({
      decks: [
        {
          ...makeDeck('deck-in', 'Japanese'),
          fsrsParams: { requestRetention: 0.7, w: [9, 9, 9] },
        },
      ],
    });
    const plan = analyzeImport(incoming);
    assert.equal(plan.summary.changedDecksCount, 1);

    await applyImportPlan(plan, 'overwrite');
    const deck = StorageService.getDecks().find((d) => d.name === 'Japanese')!;
    assert.equal(deck.fsrsParams?.requestRetention, 0.7);
  });

  it('preset com o mesmo nome (id diferente) não vira duplicado', async () => {
    localStorage.setItem('runora_presets', JSON.stringify([
      {
        id: 'preset-local',
        name: 'Meu Preset',
        dailyLimits: { newCardsPerDay: 10, maxReviewsPerDay: 100 },
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
        fsrsParams: { requestRetention: 0.9, maximumInterval: 36500 },
        createdAt: 1,
        updatedAt: 1,
      },
    ]));
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({ id: 'note-local-1', guid: 'guid-A', deckId: 'deck-loc' }),
    ]));
    localStorage.setItem('runora_cards', JSON.stringify([
      makeCard({ id: 'card-local-1', noteId: 'note-local-1', deckId: 'deck-loc' }),
    ]));
    localStorage.setItem('runora_decks', JSON.stringify([
      { ...makeDeck('deck-loc', 'Japanese'), presetId: 'preset-local' },
    ]));

    const incoming = collectionData({
      decks: [{ ...makeDeck('deck-in', 'Japanese'), presetId: 'preset-remoto' }],
      presets: [
        {
          id: 'preset-remoto',
          name: 'Meu Preset', // mesmo nome, id de outro dispositivo
          dailyLimits: { newCardsPerDay: 10, maxReviewsPerDay: 100 },
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
          fsrsParams: { requestRetention: 0.9, maximumInterval: 36500 },
          createdAt: 5,
          updatedAt: 5,
        },
      ],
    });

    const plan = analyzeImport(incoming);
    assert.equal(plan.presetLinks.get('preset-remoto'), 'preset-local'); // casou pelo nome
    await applyImportPlan(plan, 'overwrite');

    const presets = StorageService.getPresets();
    assert.equal(presets.filter((p) => p.name === 'Meu Preset').length, 1); // não duplicou
    const deck = StorageService.getDecks().find((d) => d.name === 'Japanese')!;
    assert.equal(deck.presetId, 'preset-local'); // o deck aponta para o preset de casa
  });

  it('deck com as mesmas opções não conta como mudança', () => {
    seedLocalOneNote('card-local-1', {});
    const plan = analyzeImport(collectionData());
    assert.equal(plan.summary.changedDecksCount, 0);
    assert.equal(plan.summary.globalFsrsChanged, false);
  });

  it('deck igual com cards com datas diferentes: o plano precisa avisar que vai mudar', async () => {
    seedLocalOneNote('card-local-1', { stability: 3, lastReview: 1_000 });
    const data = collectionData({
      cards: [
        makeCard({
          id: 'card-in-1',
          noteId: 'note-in-1',
          due: 999_000,
          fsrs: dummyFsrs({ stability: 8, lastReview: 5_000 }),
        }),
      ],
    });
    const plan = analyzeImport(data);
    // nada é novo e o conteúdo é igual — mas o AGENDAMENTO é diferente
    assert.equal(plan.summary.newNotesCount, 0);
    assert.equal(plan.summary.newCardsCount, 0);
    assert.equal(plan.summary.conflictingNotesCount, 0);
    assert.equal(plan.summary.changedCardsCount, 1); // <- o que faltava

    // e a aplicação realmente traz a data do arquivo
    const r = await applyImportPlan(plan, 'overwrite');
    assert.equal(r.updatedCards, 1);
    const card = StorageService.getCards().find((c) => c.id === 'card-local-1')!;
    assert.equal(card.due, 999_000);
    assert.equal(card.fsrs.stability, 8);
  });

  it('cards com o mesmo agendamento não contam como mudança', () => {
    seedLocalOneNote('card-local-1', { stability: 3, lastReview: 1_000 });
    const data = collectionData({
      cards: [
        makeCard({
          id: 'card-in-1',
          noteId: 'note-in-1',
          fsrs: dummyFsrs({ stability: 3, lastReview: 1_000 }),
        }),
      ],
    });
    const plan = analyzeImport(data);
    assert.equal(plan.summary.changedCardsCount, 0);
  });

  it('revlog novo (cards estudados no outro device) também é mudança a fazer', () => {
    seedLocalOneNote('card-local-1', { stability: 3, lastReview: 1_000 });
    const data = collectionData({
      revlog: [
        {
          id: 'r1',
          cardId: 'card-in-1',
          noteId: 'note-in-1',
          rating: 3 as const,
          reviewTime: 7000,
          elapsedDays: 0,
          scheduledDays: 1,
          state: 2 as const,
          stability: 1,
          difficulty: 5,
        },
      ],
    });
    const plan = analyzeImport(data);
    assert.equal(plan.summary.newRevlogCount, 1);
  });

  it('id em choque de conteúdo diferente recebe id novo (nada é sobrescrito por engano)', async () => {
    localStorage.setItem('runora_notes', JSON.stringify([
      makeNote({ id: 'note-in-1', guid: 'guid-OUTRA', fields: { Frente: 'outra' } }),
    ]));
    const data = collectionData({ notes: [makeNote({ id: 'note-in-1', guid: 'guid-A' })] });
    const r = await applyImportPlan(analyzeImport(data), 'keep');
    assert.equal(r.addedNotes, 1);
    const notes = StorageService.getNotes();
    const added = notes.find((n) => n.guid === 'guid-A')!;
    assert.notEqual(added.id, 'note-in-1'); // colidiu → id novo
  });

  it('grava em lotes pequenos e avança o contador ao vivo', async () => {
    // 20 notas novas → o contador deve andar em pedaços pequenos
    const notas = Array.from({ length: 20 }, (_, i) =>
      makeNote({
        id: `note-in-${i}`,
        guid: `guid-${i}`,
        fields: { Frente: `frente ${i}`, Verso: `verso ${i}` },
      })
    );
    const cards = notas.map((n) => makeCard({ id: `card-in-${n.id}`, noteId: n.id }));
    const eventos: { part: string; done: number; total: number }[] = [];
    await applyImportPlan(analyzeImport(collectionData({ notes: notas, cards })), 'overwrite', (p) =>
      eventos.push({ ...p })
    );

    const partes = new Set(eventos.map((e) => e.part));
    assert.ok(partes.has('notes'), 'progresso das notas');
    assert.ok(partes.has('cards'), 'progresso dos cards');

    // contador nunca anda de 0 e termina no total
    for (const e of eventos) {
      assert.ok(e.done > 0);
      assert.ok(e.done <= e.total);
    }
    const cardsEventos = eventos.filter((e) => e.part === 'cards');
    assert.equal(cardsEventos[cardsEventos.length - 1].done, 20);
    // e os passos são pequenos (de 2 em 2 no deck do usuário)
    assert.ok(cardsEventos.length >= 10, `esperava muitos passos, veio ${cardsEventos.length}`);
    assert.ok(cardsEventos[0].done <= 2, 'primeiro lote de no máximo 2');
  });
});

// ── helpers ──

function dummyFsrs(p: Partial<Card['fsrs']>): Card['fsrs'] {
  return {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    ...p,
  };
}

/** Uma nota+card local existente (nota em 2000 — é a "de cá"). */
function seedLocalOneNote(cardId: string, fsrs: Partial<Card['fsrs']>): void {
  localStorage.setItem('runora_notes', JSON.stringify([
    makeNote({ id: 'note-local-A', guid: 'guid-A', deckId: 'deck-loc', createdAt: 2000, updatedAt: 2000 }),
  ]));
  localStorage.setItem('runora_cards', JSON.stringify([
    makeCard({
      id: cardId,
      noteId: 'note-local-A',
      deckId: 'deck-loc',
      createdAt: 2000,
      updatedAt: 2000,
      fsrs: dummyFsrs(fsrs),
    }),
  ]));
  localStorage.setItem('runora_decks', JSON.stringify([makeDeck('deck-loc', 'Japanese')]));
}


