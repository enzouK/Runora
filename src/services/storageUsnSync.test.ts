/**
 * Coerência do USN entre aparelhos (a causa das revisões que "sumiam").
 *
 * O USN é um contador COMPARTILHADO. O problema que este arquivo cobre:
 *
 * 1. O aparelho ficou offline e o outro avançou o head (ex.: 244). O
 *    contador local continuou em 207.
 * 2. As mudanças feitas aqui ganharam USNs 208-211 — **abaixo** do head.
 * 3. Quando o Drive foi lido, o contador subiu para 244 e aquelas mudanças
 *    ficaram "no passado": `getCardsSince(244)` devolve vazio → nenhum delta
 *    as carregava → o outro aparelho nunca recebia as revisões.
 *
 * As correções testadas aqui:
 * - o conteúdo que vem do Drive faz o contador local acompanhar o head;
 * - as mudanças locais pendentes ganham USN novo (acima do head) e voltam
 *   para o delta.
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

describe('USN — o contador acompanha o head quando o conteúdo vem do Drive', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('aplicar do Drive SEM renumerar ainda assim adota o USN mais alto', () => {
    // o Drive tem um deck com USN 244 (o head compartilhado)
    StorageService.withoutUsnBump(() => {
      StorageService.saveDecks([
        { id: 'deck-j', name: 'Japanese', description: '', createdAt: 1, updatedAt: 1, usn: 244 } as any,
      ]);
    });

    assert.ok(
      StorageService.getCurrentUsn() >= 244,
      'o contador local não pode ficar para trás do head do Drive'
    );
  });

  it('a próxima mudança local fica ACIMA do head (e não no passado)', () => {
    StorageService.withoutUsnBump(() => {
      StorageService.saveDecks([
        { id: 'deck-j', name: 'Japanese', description: '', createdAt: 1, updatedAt: 1, usn: 244 } as any,
      ]);
    });

    // o usuário revisa um card aqui (item NOVO, sem USN → o app dá o próximo)
    StorageService.saveCards([makeCard({ usn: undefined })]);

    const usn = StorageService.getCards()[0].usn ?? 0;
    assert.ok(usn > 244, `a mudança local tem USN ${usn} — precisa ser > 244`);
  });
});

describe('USN — as mudanças locais pendentes ganham USN acima do head', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reestampa o card e o revlog pendentes e os devolve para o delta', () => {
    // situação real: o aparelho estava em 207, o Drive foi para 244
    StorageService.saveCards([makeCard({ id: 'card-antigo', usn: 205 })]);
    StorageService.saveNotes([makeNote({ id: 'note-1', usn: 205 })]);
    // revisão feita aqui, com o contador ainda atrás do head
    StorageService.saveCards([makeCard({ id: 'card-revisado', usn: 208 })]);
    StorageService.saveRevlog({
      id: 'rev-1',
      cardId: 'card-revisado',
      noteId: 'note-1',
      rating: 3,
      reviewTime: 1000,
      elapsedDays: 0,
      scheduledDays: 1,
      state: 2,
      stability: 1,
      difficulty: 5,
      usn: 209,
    } as any);

    // o Drive é lido: o contador sobe para o head 244
    StorageService.adoptUsnCounter(244);
    const lastSynced = 207;
    assert.equal(
      StorageService.getCardsSince(244).length,
      0,
      'antes do reestamp a mudança pendente é invisível para o delta'
    );

    const reestampados = StorageService.restampPendingChanges(lastSynced, 244);
    assert.equal(reestampados, 2, 'o card revisado e o revlog precisam ser reestampados');

    // agora a mudança pendente voltou para o delta
    const noDelta = StorageService.getCardsSince(244);
    assert.equal(noDelta.length, 1);
    assert.equal(noDelta[0].id, 'card-revisado');
    assert.ok((noDelta[0].usn ?? 0) > 244, 'o USN novo precisa ficar acima do head');
    assert.equal(StorageService.getRevlogSince(244).length, 1);
  });

  it('NÃO reestampa o que já era do Drive (USN abaixo do último sync)', () => {
    StorageService.saveCards([makeCard({ id: 'card-do-drive', usn: 100 })]);
    StorageService.adoptUsnCounter(244);

    const reestampados = StorageService.restampPendingChanges(207, 244);

    assert.equal(reestampados, 0, 'item que já estava sincronizado não vira pendente');
    assert.equal(StorageService.getCards()[0].usn, 100);
  });

  it('NÃO reestampa o que já está acima do head (já é pendente de verdade)', () => {
    // USN 270 com head 260 → já está no "futuro" (pendente de verdade)
    StorageService.saveCards([makeCard({ id: 'card-novo', usn: 270 })]);
    StorageService.adoptUsnCounter(260);

    const reestampados = StorageService.restampPendingChanges(207, 260);

    assert.equal(reestampados, 0);
    assert.equal(StorageService.getCards()[0].usn, 270);
  });

  it('reestampa o que ficou ABAIXO do head (a mudança que se escondeu)', () => {
    // USN 250 com head 260 → ficou "no passado" (o caso que sumia do delta)
    StorageService.saveCards([makeCard({ id: 'card-perdido', usn: 250 })]);
    StorageService.adoptUsnCounter(260);

    const reestampados = StorageService.restampPendingChanges(207, 260);

    assert.equal(reestampados, 1, 'a mudança que ficou no passado precisa voltar');
    assert.ok((StorageService.getCards()[0].usn ?? 0) > 260);
  });

  it('o conteúdo dos itens NÃO muda no reestamp (só o USN)', () => {
    StorageService.saveCards([
      makeCard({ id: 'card-revisado', usn: 208, due: 999, fsrs: { ...makeCard().fsrs, state: 2, reps: 3 } }),
    ]);
    const antes = StorageService.getCards()[0];

    StorageService.adoptUsnCounter(244);
    StorageService.restampPendingChanges(207, 244);

    const depois = StorageService.getCards()[0];
    assert.equal(depois.due, antes.due, 'a agenda não pode mudar');
    assert.deepEqual(depois.fsrs, antes.fsrs, 'o FSRS não pode mudar');
    assert.notEqual(depois.usn, antes.usn, 'mas o USN tem de mudar');
  });
});
