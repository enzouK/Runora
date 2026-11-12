/**
 * Etapa 7c — o USN (o "número da mudança") precisa enxergar as EDIÇÕES.
 *
 * Antes: editar uma nota mantinha o USN antigo, e o delta incremental do
 * Drive não via a edição — o sync dizia "sincronizado" e a mudança ficava
 * só naquele aparelho.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import type { Card, Note } from '../types/runora';

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
  };
}

describe('USN — edições entram no delta', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('nota editada ganha USN novo (o antigo não era preservado)', () => {
    const nota = makeNote({ usn: 5 });
    StorageService.saveNotes([nota]);
    const usnDepoisDoPrimeiroSave = StorageService.getCurrentUsn();
    assert.ok(usnDepoisDoPrimeiroSave > 0);

    // edita o conteúdo (como o editor faz)
    const notas = StorageService.getNotes();
    const editada = { ...notas[0], fields: { Frente: 'pergunta nova', Verso: 'resposta' }, updatedAt: 2000 };
    StorageService.saveNotes([editada]);

    const salva = StorageService.getNotes()[0];
    assert.notEqual(salva.usn, 5, 'a edição tem de ganhar um USN novo');
    assert.ok((salva.usn ?? 0) > usnDepoisDoPrimeiroSave);
  });

  it('nota que NÃO mudou não ganha USN novo', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    // salva exatamente o que já estava guardado
    StorageService.saveNotes(StorageService.getNotes());

    assert.equal(StorageService.getNotes()[0].usn, 5, 'sem mudança, o USN fica');
    assert.ok(StorageService.getCurrentUsn() >= usn1);
  });

  it('só o updatedAt não conta como mudança de conteúdo', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const notas = StorageService.getNotes();
    StorageService.saveNotes([{ ...notas[0], updatedAt: 9999 }]);
    assert.equal(StorageService.getNotes()[0].usn, 5);
  });

  it('card revisto ganha USN novo', () => {
    StorageService.saveCards([makeCard({ usn: 7 })]);
    const cards = StorageService.getCards();
    StorageService.saveCards([
      { ...cards[0], fsrs: { ...cards[0].fsrs, reps: 3, state: 2 }, updatedAt: 3000 },
    ]);
    assert.notEqual(StorageService.getCards()[0].usn, 7);
  });

  it('upsert do Drive NÃO renumera o USN local', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    // o Drive manda a nota com o USN dele (num espaço de USN compartilhado)
    StorageService.upsertNote(makeNote({ usn: 42, fields: { Frente: 'do drive', Verso: 'x' } }));
    const salva = StorageService.getNotes()[0];
    assert.equal(salva.usn, 42, 'o USN do Drive é preservado');
    assert.equal(salva.fields.Frente, 'do drive');
  });

  it('upsert do Drive não marca mudança local pendente', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const antes = StorageService.getCurrentUsn();
    StorageService.upsertNote(makeNote({ usn: 42, fields: { Frente: 'do drive', Verso: 'x' } }));
    // o conteúdo mudou, mas o USN local não avançou (não é mudança local)
    assert.equal(StorageService.getNotes()[0].usn, 42);
    assert.ok(StorageService.getCurrentUsn() >= antes);
  });
});

describe('USN — o contador só avança quando o conteúdo muda', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('salvar sem mudar nada NÃO cria uma versão nova', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    // salva exatamente o que já estava guardado (o que o app faz ao abrir)
    StorageService.saveNotes(StorageService.getNotes());

    assert.equal(
      StorageService.getCurrentUsn(),
      usn1,
      'sem mudança de conteúdo, o contador precisa ficar parado'
    );
  });

  it('salvar a coleção inteira várias vezes não cria versões novas', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    for (let i = 0; i < 5; i++) StorageService.saveNotes(StorageService.getNotes());

    assert.equal(StorageService.getCurrentUsn(), usn1);
  });

  it('uma edição avança o contador UMA vez (e só uma)', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    const notas = StorageService.getNotes();
    StorageService.saveNotes([{ ...notas[0], fields: { Frente: 'editada', Verso: 'x' } }]);
    const usn2 = StorageService.getCurrentUsn();
    assert.equal(usn2, usn1 + 1, 'uma edição = uma versão');

    // salvar de novo o MESMO conteúdo não cria outra versão
    StorageService.saveNotes(StorageService.getNotes());
    assert.equal(StorageService.getCurrentUsn(), usn2);
  });

  it('nota nova (sem USN) recebe USN e entra no delta', () => {
    StorageService.saveNotes([makeNote()]);
    const salva = StorageService.getNotes()[0];
    assert.ok((salva.usn ?? 0) > 0, 'nota nova precisa de USN');
    assert.equal(StorageService.getNotesSince(0).length, 1);
  });

  it('o contador acompanha o maior USN já guardado (base compartilhada)', () => {
    StorageService.saveNotes([makeNote({ usn: 40 })]);
    assert.ok(StorageService.getCurrentUsn() >= 40);
  });
});

describe('USN — deleção também é mudança real', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('apagar uma nota avança o contador (senão o delete vira backup completo)', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    StorageService.deleteNote('note-1');

    assert.equal(
      StorageService.getCurrentUsn(),
      usn1 + 1,
      'a deleção precisa criar uma versão nova (o tombstone depende disso)'
    );
    assert.equal(StorageService.getNotes().length, 0);
  });

  it('o tombstone da deleção fica ACIMA do último USN sincronizado', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    StorageService.deleteNote('note-1');

    // o filtro do delta só pega tombstone com usn > sinceUsn
    const tombstones = StorageService.getAllSyncTombstonesSince(usn1);
    assert.equal(tombstones.length, 1, 'a deleção tem que entrar no delta');
    assert.equal(tombstones[0].type, 'note');
  });

  it('apagar um card avança o contador também', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    StorageService.saveCards([makeCard({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    StorageService.deleteCard('card-1');

    assert.equal(StorageService.getCurrentUsn(), usn1 + 1);
    assert.equal(StorageService.getCards().length, 0);
  });

  it('apagar o que não existe não cria versão nova', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    StorageService.deleteNote('nao-existe');
    StorageService.deleteCard('nao-existe');

    assert.equal(StorageService.getCurrentUsn(), usn1);
  });

  it('deleção que vem do Drive (sem renumerar) não cria versão nova', () => {
    StorageService.saveNotes([makeNote({ usn: 5 })]);
    const usn1 = StorageService.getCurrentUsn();

    // o outro aparelho já deletou: o USN novo é o DELE
    StorageService.withoutUsnBump(() => StorageService.deleteNote('note-1'));

    assert.equal(
      StorageService.getCurrentUsn(),
      usn1,
      'aplicar deleção do Drive não pode criar versão local'
    );
  });
});

describe('USN — identidade entre aparelhos (o `id` é local de cada aparelho)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('nota do Drive com id DIFERENTE mas o mesmo GUID NÃO duplica', () => {
    // aqui a nota tem o id 'note-local'
    StorageService.saveNotes([makeNote({ id: 'note-local', guid: 'g1', usn: 10 })]);

    // no outro aparelho a MESMA nota tem outro id (cada aparelho cria o seu)
    StorageService.upsertNote(
      makeNote({ id: 'note-remoto', guid: 'g1', usn: 20, tags: ['do-drive'] })
    );

    const notas = StorageService.getNotes();
    assert.equal(notas.length, 1, 'a nota não pode duplicar');
    assert.equal(notas[0].id, 'note-local', 'o id local é preservado');
    assert.deepEqual(notas[0].tags, ['do-drive'], 'o conteúdo do Drive entrou');
    assert.equal(notas[0].usn, 20, 'o USN é o do Drive');
  });

  it('card do Drive com noteId DIFERENTE não duplica (a identidade é o GUID + ordem)', () => {
    StorageService.saveNotes([makeNote({ id: 'note-local', guid: 'g1', usn: 10 })]);
    StorageService.saveCards([makeCard({ id: 'card-local', noteId: 'note-local', usn: 10 })]);

    // o card veio do outro aparelho: o noteId é o id da nota LÁ
    StorageService.upsertCard(
      makeCard({ id: 'card-remoto', noteId: 'note-remoto', usn: 21 }),
      'g1'
    );

    const cards = StorageService.getCards();
    assert.equal(cards.length, 1, 'o card não pode duplicar');
    assert.equal(cards[0].id, 'card-local', 'o id local é preservado');
    assert.equal(cards[0].noteId, 'note-local', 'o card continua apontando para a nota local');
    assert.equal(cards[0].usn, 21);
  });

  it('deck do Drive com id DIFERENTE não duplica (a identidade é o nome)', () => {
    StorageService.saveDecks([
      { id: 'deck-local', name: 'Japanese', description: '', createdAt: 1, updatedAt: 1, usn: 5 } as any,
    ]);
    StorageService.upsertDeck({
      id: 'deck-remoto',
      name: 'Japanese',
      description: 'outro texto',
      createdAt: 1,
      updatedAt: 2,
      usn: 9,
    } as any);

    const decks = StorageService.getDecks();
    const jp = decks.filter((d) => d.name === 'Japanese');
    assert.equal(jp.length, 1, 'o deck não pode duplicar');
    assert.equal(jp[0].id, 'deck-local');
  });

  it('a nota local é achada pelo GUID que veio do outro aparelho', () => {
    StorageService.saveNotes([makeNote({ id: 'note-local', guid: 'g1', usn: 10 })]);
    StorageService.saveCards([makeCard({ id: 'card-local', noteId: 'note-local', usn: 10 })]);

    // o outro aparelho manda o tombstone com o GUID (o id dele não vale aqui)
    assert.equal(StorageService.findNoteIdByGuid('g1'), 'note-local');
    assert.equal(StorageService.findCardIdByIdentity('g1', 0), 'card-local');
    assert.equal(StorageService.findNoteIdByGuid('g2'), undefined);
  });
});

describe('USN — contador compartilhado entre aparelhos', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adota o contador do Drive quando ele é maior', () => {
    StorageService.adoptUsnCounter(190);
    assert.equal(StorageService.getCurrentUsn(), 190);
  });

  it('nunca volta o contador para trás', () => {
    StorageService.adoptUsnCounter(190);
    StorageService.adoptUsnCounter(12);
    assert.equal(StorageService.getCurrentUsn(), 190);
  });

  it('ignora valores inválidos', () => {
    StorageService.adoptUsnCounter(0);
    StorageService.adoptUsnCounter(-5);
    StorageService.adoptUsnCounter(Number.NaN);
    assert.equal(StorageService.getCurrentUsn(), 0);
  });

  it('a próxima edição fica DEPOIS do USN adotado (o delta a enxerga)', () => {
    StorageService.adoptUsnCounter(190);
    StorageService.saveNotes([makeNote({ usn: 190 })]);
    const notas = StorageService.getNotes();
    StorageService.saveNotes([{ ...notas[0], fields: { Frente: 'editada', Verso: 'x' } }]);
    const usn = StorageService.getNotes()[0].usn ?? 0;
    assert.ok(usn > 190, `esperado USN > 190, veio ${usn}`);
    assert.equal(StorageService.getNotesSince(190).length, 1, 'a edição aparece no delta');
  });
});
