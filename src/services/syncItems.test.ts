/**
 * Sync item a item (Fase 4): snapshot, comparação e aplicação seletiva.
 *
 * O StorageService lê a coleção do `localStorage`, então os testes rodam
 * contra um substituto em memória do armazenamento do navegador.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import {
  cardKey,
  computeSnapshot,
  deckKey,
  diffSnapshots,
  hashValue,
  noteKey,
  SETTINGS_KEYS,
  type SyncContent,
} from './syncItems';
import { applyRemoteItems, applyRemoteItemsProgressive, mergeRemoteRevlog } from './syncApply';
import type { Card, Deck, Note, NoteType, RevlogEntry } from '../types/runora';

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

/* ── fixtures ────────────────────────────────────────────────────────────── */

function makeDeck(id: string, name: string, extra: Partial<Deck> = {}): Deck {
  return {
    id,
    name,
    description: '',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function makeNoteType(id: string, name: string): NoteType {
  return {
    id,
    name,
    fields: [{ id: 'f1', name: 'Frente', ord: 0 }],
    templates: [{ id: 't1', name: 'Card 1', ord: 0, qfmt: '{{Frente}}', afmt: '{{FrontSide}}' }],
    css: '.card {}',
    isCloze: false,
    hintsEnabled: false,
    voiceRecordingEnabled: false,
    furiganaEnabled: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeNote(id: string, guid: string, fields: Record<string, string>): Note {
  return {
    id,
    guid,
    noteTypeId: 'nt-1',
    deckId: 'deck-1',
    fields,
    media: [],
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeCard(id: string, noteId: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    noteId,
    deckId: 'deck-1',
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
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function contentOf(opts: {
  notes?: Note[];
  cards?: Card[];
  decks?: Deck[];
  noteTypes?: NoteType[];
  rollover?: number;
}): SyncContent {
  const notes = opts.notes ?? [];
  const cards = opts.cards ?? [];
  const cardNoteGuid: Record<string, string> = {};
  for (const note of notes) {
    for (const card of cards) {
      if (card.noteId === note.id && note.guid) cardNoteGuid[card.id] = note.guid;
    }
  }
  return {
    decks: opts.decks ?? [makeDeck('deck-1', 'Japonês')],
    noteTypes: opts.noteTypes ?? [makeNoteType('nt-1', 'Básico')],
    notes,
    cards,
    presets: [],
    cardNoteGuid,
    settings: {
      fsrs: undefined,
      prefs: { rolloverHour: opts.rollover ?? 4 },
      theme: 'light',
      colorTheme: 'default',
    },
  };
}

/* ── snapshot / hash ─────────────────────────────────────────────────────── */

describe('syncItems — snapshot', () => {
  it('hash é estável para o mesmo conteúdo e muda quando o conteúdo muda', () => {
    const a = computeSnapshot(contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'gato' })] }), 'd', 'PC');
    const b = computeSnapshot(contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'gato' })] }), 'd', 'PC');
    const c = computeSnapshot(contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'cão' })] }), 'd', 'PC');
    assert.equal(a.items[noteKey('g1')].hash, b.items[noteKey('g1')].hash);
    assert.notEqual(a.items[noteKey('g1')].hash, c.items[noteKey('g1')].hash);
  });

  it('hash não depende da ordem das chaves', () => {
    assert.equal(hashValue({ a: 1, b: 2 }), hashValue({ b: 2, a: 1 }));
  });

  it('notas sem GUID ficam de fora do snapshot', () => {
    const snap = computeSnapshot(contentOf({ notes: [makeNote('n1', '', { Frente: 'x' })] }), 'd', 'PC');
    // deck + tipo de nota + preferências + tema
    assert.equal(Object.keys(snap.items).length, 4);
    assert.equal(Object.keys(snap.items).some((k) => k.startsWith('note:')), false);
  });

  it('cada item guarda um rótulo legível', () => {
    const snap = computeSnapshot(
      contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'gato' })] }),
      'd',
      'PC'
    );
    assert.equal(snap.items[deckKey('Japonês')].label, 'Japonês');
    assert.equal(snap.items[noteKey('g1')].label, 'gato');
  });
});

/* ── comparação ──────────────────────────────────────────────────────────── */

describe('syncItems — diff item a item', () => {
  const base = computeSnapshot(
    contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'gato' })], cards: [makeCard('c1', 'n1')] }),
    'd',
    'PC'
  );

  it('mudou só aqui → localOnly', () => {
    const local = computeSnapshot(
      contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'cão' })], cards: [makeCard('c1', 'n1')] }),
      'd',
      'PC'
    );
    const diff = diffSnapshots(base, local, base);
    assert.equal(diff.localOnly.length, 1);
    assert.equal(diff.localOnly[0].key, noteKey('g1'));
    assert.equal(diff.conflicts.length, 0);
    assert.equal(diff.remoteOnly.length, 0);
  });

  it('mudou só no Drive → remoteOnly', () => {
    const remote = computeSnapshot(
      contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'cão' })], cards: [makeCard('c1', 'n1')] }),
      'd',
      'PC'
    );
    const diff = diffSnapshots(base, base, remote);
    assert.equal(diff.remoteOnly.length, 1);
    assert.equal(diff.remoteOnly[0].key, noteKey('g1'));
    assert.equal(diff.conflicts.length, 0);
  });

  it('mudou nos dois lados → disputa', () => {
    const local = computeSnapshot(
      contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'cão' })], cards: [makeCard('c1', 'n1')] }),
      'd',
      'PC'
    );
    const remote = computeSnapshot(
      contentOf({ notes: [makeNote('n1', 'g1', { Frente: 'gato!' })], cards: [makeCard('c1', 'n1')] }),
      'd',
      'PC'
    );
    const diff = diffSnapshots(base, local, remote);
    assert.equal(diff.conflicts.length, 1);
    assert.equal(diff.conflicts[0].key, noteKey('g1'));
    assert.equal(diff.conflicts[0].label, 'Nota: cão');
  });

  it('nota apagada no Drive → remoteDeleted', () => {
    const remote = computeSnapshot(contentOf({ cards: [makeCard('c1', 'n1')] }), 'd', 'PC');
    const diff = diffSnapshots(base, base, remote);
    // a nota e o card dela saem juntos
    assert.equal(diff.remoteDeleted.length, 2);
    assert.equal(
      diff.remoteDeleted.some((i) => i.key === noteKey('g1')),
      true
    );
  });

  it('nota apagada aqui → localDeleted', () => {
    const local = computeSnapshot(contentOf({ cards: [makeCard('c1', 'n1')] }), 'd', 'PC');
    const diff = diffSnapshots(base, local, base);
    assert.equal(diff.localDeleted.length, 2);
    assert.equal(
      diff.localDeleted.some((i) => i.key === noteKey('g1')),
      true
    );
  });

  it('item que não mudou não aparece em nenhum grupo', () => {
    const diff = diffSnapshots(base, base, base);
    assert.equal(
      diff.remoteOnly.length + diff.localOnly.length + diff.conflicts.length +
        diff.remoteDeleted.length + diff.localDeleted.length,
      0
    );
  });
});

/* ── aplicação seletiva ──────────────────────────────────────────────────── */

describe('syncApply — aplica só o que foi escolhido', () => {
  beforeEach(() => {
    localStorage.clear();
    StorageService.saveDecks([makeDeck('deck-1', 'Japonês')]);
    StorageService.saveNoteTypes([makeNoteType('nt-1', 'Básico')]);
    StorageService.saveNotes([makeNote('n1', 'g1', { Frente: 'gato' })]);
    StorageService.saveCards([makeCard('c1', 'n1')]);
  });

  const remoteData = {
    decks: [makeDeck('deck-1', 'Japonês')],
    noteTypes: [makeNoteType('nt-1', 'Básico')],
    notes: [makeNote('n1', 'g1', { Frente: 'cão' })],
    cards: [makeCard('c1', 'n1')],
    presets: [],
  };

  it('aplica a nota escolhida e mexe nas outras de fora', () => {
    const remote = {
      ...remoteData,
      notes: [makeNote('n1', 'g1', { Frente: 'cão' }), makeNote('n2', 'g2', { Frente: 'novo' })],
    };
    const r = applyRemoteItems(remote, new Set([noteKey('g2')]));
    assert.equal(r.notes, 1);
    const notes = StorageService.getNotes();
    assert.equal(notes.find((n) => n.guid === 'g1')!.fields.Frente, 'gato');
    assert.equal(notes.find((n) => n.guid === 'g2')!.fields.Frente, 'novo');
  });

  it('atualiza o card (FSRS) só quando a chave do card entra', () => {
    const remoteCard = makeCard('c1', 'n1', {
      due: 1234,
      fsrs: { ...makeCard('c1', 'n1').fsrs, stability: 9, state: 2 },
    });
    const remote = { ...remoteData, cards: [remoteCard] };

    applyRemoteItems(remote, new Set());
    assert.equal(StorageService.getCards()[0].fsrs.stability, 0);

    applyRemoteItems(remote, new Set([cardKey('g1', 0)]));
    assert.equal(StorageService.getCards()[0].fsrs.stability, 9);
  });

  it('deck e tipo de nota são casados pelo nome', () => {
    const remote = {
      ...remoteData,
      decks: [makeDeck('deck-remote', 'Japonês', { description: 'do outro device' })],
      noteTypes: [makeNoteType('nt-remote', 'Básico')],
    };
    const r = applyRemoteItems(remote, new Set([deckKey('Japonês')]));
    assert.equal(r.decks, 1);
    const deck = StorageService.getDecks().find((d) => d.name === 'Japonês')!;
    assert.equal(deck.id, 'deck-1'); // o id local é preservado
    assert.equal(deck.description, 'do outro device');
  });

  it('nota apagada no Drive é removida aqui', () => {
    const remote = { ...remoteData, notes: [] };
    const r = applyRemoteItems(remote, new Set([noteKey('g1')]));
    assert.equal(r.deleted, 1);
    assert.equal(StorageService.getNotes().length, 0);
  });

  it('deck apagado no Drive some daqui quando não sobrou nota', () => {
    const remote = { ...remoteData, notes: [], decks: [] };
    applyRemoteItems(remote, new Set([noteKey('g1'), deckKey('Japonês')]));
    assert.equal(
      StorageService.getDecks().some((d) => d.name === 'Japonês'),
      false
    );
  });

  it('histórico de revisões é remapeado para o card local', () => {
    const entry: RevlogEntry = {
      id: 'r1',
      cardId: 'c1',
      noteId: 'n1',
      rating: 3,
      reviewTime: 1000,
      elapsedDays: 0,
      scheduledDays: 1,
      state: 2,
      stability: 1,
      difficulty: 5,
    };
    const n = mergeRemoteRevlog([entry], { ...remoteData, revlog: [entry] });
    assert.equal(n, 1);
    const local = StorageService.getRevlog();
    assert.equal(local.length, 1);
    assert.equal(local[0].cardId, 'c1');
    assert.equal(local[0].id.startsWith('rev-sync-'), true);
  });

  it('revisão repetida não entra de novo', () => {
    const entry: RevlogEntry = {
      id: 'r1',
      cardId: 'c1',
      noteId: 'n1',
      rating: 3,
      reviewTime: 1000,
      elapsedDays: 0,
      scheduledDays: 1,
      state: 2,
      stability: 1,
      difficulty: 5,
    };
    mergeRemoteRevlog([entry], { ...remoteData, revlog: [entry] });
    const again = mergeRemoteRevlog([entry], { ...remoteData, revlog: [entry] });
    assert.equal(again, 0);
    assert.equal(StorageService.getRevlog().length, 1);
  });

  it('preferências globais só entram quando a chave entra', () => {
    const remote = {
      ...remoteData,
      settings: { prefs: { rolloverHour: 7 }, theme: 'dark' as const, colorTheme: 'blue' },
    };
    applyRemoteItems(remote, new Set());
    assert.equal(StorageService.getRolloverHour(), 4);
    applyRemoteItems(remote, new Set([SETTINGS_KEYS.prefs]));
    assert.equal(StorageService.getRolloverHour(), 7);
  });
});

describe('exclusões e o marcador do sync (runora_deleted_at)', () => {  it('deleteNote/deleteDeck/deletePreset marcam a última exclusão', () => {
    const start = StorageService.getLastDeletedAt();

    StorageService.saveNotes([makeNote('n-del', 'g-del', { Frente: 'x' })]);
    StorageService.saveCards([makeCard('c-del', 'n-del')]);
    StorageService.deleteNote('n-del');
    const mark1 = StorageService.getLastDeletedAt();
    assert.ok(mark1 > 0, 'deleteNote registra o marcador');

    StorageService.saveDecks([makeDeck('deck-del', 'Temporário')]);
    StorageService.deleteDeck('deck-del');
    const mark2 = StorageService.getLastDeletedAt();
    assert.ok(mark2 > 0 && mark2 >= mark1, 'deleteDeck registra o marcador');
    assert.equal(StorageService.getDecks().some((d) => d.id === 'deck-del'), false);

    const preset = StorageService.createPreset('Preset temporário');
    StorageService.deletePreset(preset.id);
    const mark3 = StorageService.getLastDeletedAt();
    assert.ok(mark3 > 0 && mark3 >= mark2, 'deletePreset registra o marcador');

    // nada ficou para trás
    assert.equal(StorageService.getNotes().some((n) => n.id === 'n-del'), false);
    assert.equal(StorageService.getCards().some((c) => c.id === 'c-del'), false);
    assert.ok(mark1 >= start || start === 0);
  });

  it('excluir um deck aparece no diff como localDeleted', () => {
    // base: deck + tipo de nota + configurações (sem nota/card)
    const base = computeSnapshot(contentOf({}), 'dev', 'PC');
    // depois o deck inteiro saiu da coleção
    const local = computeSnapshot(
      { ...contentOf({}), decks: [] },
      'dev',
      'PC'
    );
    // o Drive ainda tem o deck (remoto = base); quem apagou foi o local
    const diff = diffSnapshots(base, local, base);
    assert.equal(diff.localDeleted.length, 1);
    assert.equal(diff.localDeleted[0].key, deckKey('Japonês'));
  });
});

describe('syncApply — aplicação progressiva (contador ao vivo)', () => {
  beforeEach(() => {
    localStorage.clear();
    StorageService.saveDecks([makeDeck('deck-1', 'Japonês')]);
    StorageService.saveNoteTypes([makeNoteType('nt-1', 'Básico')]);
    StorageService.saveNotes([]);
    StorageService.saveCards([]);
  });

  it('aplica as notas e announces o contador crescendo', async () => {
    // 20 notas remotas → mais de um lote (o contador anda de poucos em poucos)
    const notes = Array.from({ length: 20 }, (_, i) =>
      makeNote(`n${i}`, `g${i}`, { Frente: `texto ${i}` })
    );
    const remote = {
      decks: [makeDeck('deck-1', 'Japonês')],
      noteTypes: [makeNoteType('nt-1', 'Básico')],
      notes,
      cards: notes.map((n, i) => makeCard(`c${i}`, n.id)),
      presets: [],
    };
    const keys = new Set<string>([
      ...notes.map((n) => noteKey(n.guid ?? '')),
      ...notes.map((_, i) => cardKey(`g${i}`, 0)),
    ]);

    const eventos: { part: string; done: number; total: number }[] = [];
    const r = await applyRemoteItemsProgressive(remote, keys, (p) =>
      eventos.push({ part: p.part, done: p.done, total: p.total })
    );

    assert.equal(r.notes, 20);
    assert.equal(r.cards, 20);
    assert.equal(StorageService.getNotes().length, 20);

    // o contador de notas aparece e termina completo
    const notas = eventos.filter((e) => e.part === 'notes');
    assert.ok(notas.length > 0, 'o contador de notas é emitido');
    assert.equal(notas[notas.length - 1].done, 20);
    assert.equal(notas[notas.length - 1].total, 20);
    // os valores andam para frente (nunca voltam)
    for (let i = 1; i < notas.length; i++) {
      assert.ok(notas[i].done >= notas[i - 1].done, 'o contador não volta atrás');
    }
    // cards também são contados
    const cards = eventos.filter((e) => e.part === 'cards');
    assert.equal(cards[cards.length - 1].done, 20);
  });

  it('aplica só as chaves pedidas (igual à aplicação normal)', async () => {
    const remote = {
      decks: [makeDeck('deck-1', 'Japonês')],
      noteTypes: [makeNoteType('nt-1', 'Básico')],
      notes: [
        makeNote('n1', 'g1', { Frente: 'um' }),
        makeNote('n2', 'g2', { Frente: 'dois' }),
      ],
      cards: [],
      presets: [],
    };
    const r = await applyRemoteItemsProgressive(remote, new Set([noteKey('g2')]));
    assert.equal(r.notes, 1);
    assert.equal(StorageService.getNotes().length, 1);
    assert.equal(StorageService.getNotes()[0].guid, 'g2');
  });

  it('card de nota com GUID contendo ":" é aplicado (a chave não pode ser quebrada)', async () => {
    const guid = "qh:`|s[hZ!";
    StorageService.saveNotes([makeNote('n1', guid, { Frente: 'gato' })]);
    StorageService.saveCards([makeCard('c1', 'n1')]);
    const remote = {
      decks: [makeDeck('deck-1', 'Japonês')],
      noteTypes: [makeNoteType('nt-1', 'Básico')],
      notes: [makeNote('n1', guid, { Frente: 'cão' })],
      cards: [makeCard('c1', 'n1', { due: 99 })],
      presets: [],
    };
    const r = await applyRemoteItemsProgressive(
      remote,
      new Set([noteKey(guid), cardKey(guid, 0)])
    );
    assert.equal(r.notes, 1);
    assert.equal(r.cards, 1);
    assert.equal(StorageService.getCards().length, 1);
    assert.equal(StorageService.getCards()[0].due, 99);
  });
});
