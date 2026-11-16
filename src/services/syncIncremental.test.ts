/**
 * Regressão do bug do sync incremental (15/11/2026).
 *
 * O que o dono viu: criou um card (no Vite e no celular), estudou,
 * sincronizou; ao abrir o `.exe` e sincronizar, o sync repetia o erro e o
 * **botão do Sync ficava laranja** no fim.
 *
 * As medições no `.exe` e no Drive mostraram a causa (caminho incremental —
 * `downloadIncremental` + `applyDelta`):
 *
 * | Sintoma | Causa |
 * |---|---|
 * | 5 revisões duplicadas | o delta do Drive é **acumulado** e era aplicado inteiro, de novo |
 * | 14 revisões órfãs | a revisão era salva crua, com o `cardId` do **outro** aparelho |
 * | contador USN 299 (head 296) | `saveRevlog` e `restampPendingChanges` consumiam USN sem conteúdo novo |
 * | botão laranja + tombstones voltando | a deleção remota virava tombstone **local pendente** (USN acima do head) |
 *
 * Estes testes prendem os 4 defeitos — com os números reais do caso.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import { resolveRemoteRevlog } from './syncRevlog';
import { applyDeltaToStorage } from './syncApplyDelta';
import { applyDelta, type SyncDelta } from './syncDelta';
import { computeSnapshot, localSyncContent, setSyncBase } from './syncItems';
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

/** Prepara o localStorage limpo (sem o conteúdo de exemplo do app). */
function limpar(): void {
  localStorage.clear();
  localStorage.setItem('runora_seed_version', '3');
  // Aquece o storage: na 1ª leitura o app semeia os padrões (deck + tipo de
  // nota) e o backfill dá USN a eles. No app de verdade isso acontece UMA
  // vez, no boot — aqui viraria ruído no contador durante o teste.
  localSyncContent();
  localSyncContent();
}

describe('Revisão do Drive — casada com o card LOCAL (sem órfã, sem duplicata)', () => {
  beforeEach(limpar);

  it('remapeia o cardId do outro aparelho para o card local', () => {
    // o card veio da base do Drive: o id local É o id de quem gravou
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [makeCard({ id: 'card-local', noteId: 'note-local', usn: 100 })];
    const delta = makeDelta({
      revlog: [makeRevlog({ cardId: 'card-local', noteId: 'note-local', usn: 289 })],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [] });

    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].cardId, 'card-local');
    assert.equal(r.entries[0].noteId, 'note-local');
    assert.equal(r.orphans, 0);
  });

  it('casa pelo par (GUID da nota, ordem do template) quando o id é outro', () => {
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [makeCard({ id: 'card-local', noteId: 'note-local', templateOrd: 0, usn: 100 })];
    const delta = makeDelta({
      cards: [makeCard({ id: 'card-remoto', noteId: 'note-remota', templateOrd: 0, usn: 280 })],
      noteGuids: { 'note-remota': 'guid-x' },
      revlog: [makeRevlog({ cardId: 'card-remoto', noteId: 'note-remota', usn: 289 })],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [] });

    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].cardId, 'card-local', 'a revisão tem que apontar para o card local');
    assert.equal(r.entries[0].noteId, 'note-local');
  });

  it('casa pelo GUID da nota quando o card não está no delta (nota de 1 card)', () => {
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [makeCard({ id: 'card-local', noteId: 'note-local', usn: 100 })];
    const delta = makeDelta({
      noteGuids: { 'note-remota': 'guid-x' },
      revlog: [makeRevlog({ cardId: 'card-remoto', noteId: 'note-remota', usn: 289 })],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [] });

    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].cardId, 'card-local');
  });

  it('NÃO adivinha quando a nota tem mais de um card (a revisão seria do card errado)', () => {
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [
      makeCard({ id: 'card-local-0', noteId: 'note-local', templateOrd: 0, usn: 100 }),
      makeCard({ id: 'card-local-1', noteId: 'note-local', templateOrd: 1, usn: 100 }),
    ];
    const delta = makeDelta({
      noteGuids: { 'note-remota': 'guid-x' },
      revlog: [makeRevlog({ cardId: 'card-remoto', noteId: 'note-remota', usn: 289 })],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [] });

    // A revisão é GUARDADA (o addon *Review Heatmap* precisa dela), mas sem
    // card local: sem a ordem do template não dá para saber de qual card ela
    // é — e chutar apontaria a revisão para o card errado.
    assert.equal(r.entries.length, 1, 'a revisão não pode ser descartada');
    assert.equal(r.entries[0].cardId, 'card-remoto', 'sem card local, ela fica órfã');
    assert.equal(r.orphans, 1);
  });

  it('GUARDA a revisão de um card que não existe aqui (o heatmap conta ela)', () => {
    const delta = makeDelta({
      noteGuids: { 'note-remota': 'guid-y' },
      revlog: [makeRevlog({ cardId: 'card-remoto', noteId: 'note-remota', usn: 289 })],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes: [], cards: [], revlog: [] });

    // Antes (T21) esta revisão era DESCARTADA — e era por isso que o
    // celular tinha 10 revisões de card apagado e o PC tinha 16.
    assert.equal(r.entries.length, 1, 'a revisão de card apagado tem que viajar');
    assert.equal(r.orphans, 1);
    assert.equal(r.entries[0].cardId, 'card-remoto');
  });

  it('a revisão que já está no histórico não entra de novo', () => {
    const notes = [makeNote({ id: 'note-local', guid: 'guid-x', usn: 100 })];
    const cards = [makeCard({ id: 'card-local', noteId: 'note-local', usn: 100 })];
    const jaGuardada = makeRevlog({ cardId: 'card-local', noteId: 'note-local', reviewTime: 500, usn: 200 });
    const delta = makeDelta({
      revlog: [makeRevlog({ cardId: 'card-local', noteId: 'note-local', reviewTime: 500, usn: 289 })],
    });

    const r = resolveRemoteRevlog(delta.revlog, delta, { notes, cards, revlog: [jaGuardada] });

    assert.equal(r.entries.length, 0);
    assert.equal(r.duplicates, 1);
  });
});

describe('Delta acumulado — só o que é NOVO é aplicado', () => {
  beforeEach(limpar);

  it('não reaplica o que já foi aplicado (o delta do Drive é acumulado)', () => {
    const delta = makeDelta({
      revlog: [makeRevlog({ cardId: 'card-1', usn: 289 })],
      tombstones: [{ type: 'note', id: 'note-1', guid: 'guid-1', usn: 296, deletedAt: 1 } as Tombstone],
    });

    const entidades: string[] = [];
    const tombstones: number[] = [];

    // 1ª aplicação: tudo é novo (lastSynced = 285)
    applyDelta(
      delta,
      (e, type) => entidades.push(`${type}:${(e as RevlogEntry).id}`),
      (t) => tombstones.push(t.usn),
      285
    );
    assert.deepEqual(entidades, ['revlog:rev-1']);
    assert.deepEqual(tombstones, [296]);

    // 2ª aplicação: o aparelho já está no head (296) → nada é reaplicado
    entidades.length = 0;
    tombstones.length = 0;
    applyDelta(
      delta,
      (e, type) => entidades.push(`${type}:${(e as RevlogEntry).id}`),
      (t) => tombstones.push(t.usn),
      296
    );
    assert.deepEqual(entidades, [], 'a revisão não pode entrar duplicada');
    assert.deepEqual(tombstones, [], 'a deleção não pode ser reaplicada');
  });
});

describe('O contador de USN só anda com mudança REAL', () => {
  beforeEach(limpar);

  it('reestampar sem nada pendente NÃO avança o contador', () => {
    StorageService.adoptUsnCounter(296);
    const antes = StorageService.getCurrentUsn();

    const reestampados = StorageService.restampPendingChanges(285, 296);

    assert.equal(reestampados, 0);
    assert.equal(
      StorageService.getCurrentUsn(),
      antes,
      'o contador andou sem nenhuma mudança de conteúdo'
    );
  });

  it('salvar uma revisão que JÁ tem USN NÃO avança o contador', () => {
    StorageService.adoptUsnCounter(296);
    const antes = StorageService.getCurrentUsn();

    StorageService.saveRevlog(makeRevlog({ id: 'rev-do-drive', cardId: 'card-1', usn: 289 }));

    assert.equal(StorageService.getCurrentUsn(), antes, 'o contador andou sem conteúdo novo');
    assert.equal(StorageService.getRevlog().length, 1);
    assert.equal(StorageService.getRevlog()[0].usn, 289, 'a revisão mantém o USN de quem a fez');
  });
});

describe('Deleção que veio do Drive NÃO vira mudança local pendente', () => {
  beforeEach(limpar);

  it('o tombstone local carrega o USN do Drive (o botão Sync não fica laranja)', () => {
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-1', usn: 280 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 280 })]);
    StorageService.adoptUsnCounter(296);
    const lastSynced = 296;

    // o outro aparelho deletou (USN 296 no Drive) → o tombstone local
    // precisa carregar ESSE USN, não um novo (acima do head).
    StorageService.withoutUsnBump(() =>
      StorageService.deleteNote('note-1', { remoteUsn: 296 })
    );

    const pendentes = StorageService.getAllSyncTombstonesSince(lastSynced);
    assert.equal(
      pendentes.length,
      0,
      'a deleção já está no Drive — não pode virar pendência local (botão laranja)'
    );
    assert.equal(
      StorageService.getCurrentUsn(),
      296,
      'a aplicação de uma deleção remota não pode mexer no contador'
    );
  });

  it('a contagem de deleções pendentes fica correta (o aparelho não se acha atrás)', () => {
    StorageService.saveNotes([makeNote({ id: 'note-1', guid: 'guid-1', usn: 280 })]);
    StorageService.saveCards([makeCard({ id: 'card-1', noteId: 'note-1', usn: 280 })]);
    StorageService.adoptUsnCounter(296);

    StorageService.withoutUsnBump(() =>
      StorageService.deleteNote('note-1', { remoteUsn: 293 })
    );

    const pendentes = StorageService.getPendingDeletionCounts(296);
    assert.equal(pendentes.note ?? 0, 0, 'a deleção já está sincronizada');
  });
});

describe('O caso real do dono — aplicar o delta inteiro sem estragar o estado', () => {
  beforeEach(limpar);

  it('delta com 2 revisões + 4 pares de deleções: contador parado, sem duplicata, sem ping-pong', () => {
    // ── o estado local do `.exe` (antes de aplicar) ──
    const notas = [
      makeNote({ id: 'note-a', guid: 'guid-a', usn: 280 }),
      makeNote({ id: 'note-b', guid: 'guid-b', usn: 280 }),
    ];
    const cards = [
      makeCard({ id: 'card-a', noteId: 'note-a', usn: 280 }),
      makeCard({ id: 'card-b', noteId: 'note-b', usn: 280 }),
    ];
    StorageService.saveNotes(notas);
    StorageService.saveCards(cards);
    StorageService.adoptUsnCounter(285);
    const lastSynced = 285;
    const head = 296;

    // ── o delta do Drive (o caso medido: 2 revisões + 8 tombstones) ──
    const revlog = [
      makeRevlog({ id: 'rev-1', cardId: 'card-remoto', noteId: 'note-remota', reviewTime: 1794711535226, usn: 289 }),
      makeRevlog({ id: 'rev-2', cardId: 'card-remoto', noteId: 'note-remota', reviewTime: 1794711535748, usn: 291 }),
    ];
    const tombstones: Tombstone[] = [
      { type: 'note', id: 'note-remota', guid: 'guid-c', usn: 293, deletedAt: 1 },
      { type: 'card', id: 'card-remoto', guid: 'guid-c', templateOrd: 0, usn: 293, deletedAt: 1 },
      { type: 'note', id: 'note-a', guid: 'guid-a', usn: 296, deletedAt: 2 },
      { type: 'card', id: 'card-a', guid: 'guid-a', templateOrd: 0, usn: 296, deletedAt: 2 },
    ];
    const delta = makeDelta({
      revlog,
      tombstones,
      noteGuids: { 'note-remota': 'guid-c' },
      currentUsn: head,
    });

    // ── aplica o delta como o `downloadIncremental` faz (código real) ──
    const resultado = applyDeltaToStorage(delta, lastSynced);

    // ── o que NÃO pode acontecer ──
    // (o `downloadIncremental` adota o head do Drive no fim — o contador
    //  fica no head, e não ACIMA dele)
    StorageService.adoptUsnCounter(head);
    assert.equal(
      StorageService.getCurrentUsn(),
      head,
      'o contador não pode andar sem conteúdo novo (era 296 → 299)'
    );
    assert.equal(
      StorageService.getAllSyncTombstonesSince(head).length,
      0,
      'as deleções do Drive não podem voltar como pendência local'
    );
    // A revisão de um card APAGADO é guardada (T16): ela é invisível na
    // tela de estudo, mas continua no histórico — é o que o *Review
    // Heatmap* conta, e o número tem que ser o mesmo em todos os aparelhos.
    assert.equal(StorageService.getRevlog().length, 2, 'as 2 revisões foram guardadas');
    assert.equal(resultado.revlogOrphans, 2, 'as 2 revisões são de um card que não existe aqui');
    assert.equal(resultado.revlogApplied, 2);
    assert.equal(resultado.headUsn, head);

    // ── o próximo sync (o delta do Drive é acumulado) ──
    const resultado2 = applyDeltaToStorage(delta, head);
    assert.equal(resultado2.revlogApplied, 0, 'a revisão não pode entrar duplicada');
    assert.equal(StorageService.getRevlog().length, 2, 'o histórico não pode ter repetida');
  });

  it('a revisão que É de um card existente entra uma vez só, sem consumir USN', () => {
    // ── o estado local do `.exe` ──
    StorageService.saveNotes([makeNote({ id: 'note-a', guid: 'guid-a', usn: 280 })]);
    StorageService.saveCards([makeCard({ id: 'card-a', noteId: 'note-a', usn: 280 })]);
    StorageService.adoptUsnCounter(285);
    const lastSynced = 285;
    const head = 296;

    // ── o delta do Drive: a revisão do card que existe aqui ──
    const delta = makeDelta({
      revlog: [makeRevlog({ id: 'rev-1', cardId: 'card-a', noteId: 'note-a', reviewTime: 1794711535226, usn: 289 })],
      currentUsn: head,
    });

    const resultado = applyDeltaToStorage(delta, lastSynced);
    StorageService.adoptUsnCounter(head);

    assert.equal(resultado.revlogApplied, 1);
    assert.equal(StorageService.getRevlog().length, 1);
    assert.equal(StorageService.getRevlog()[0].cardId, 'card-a', 'a revisão aponta para o card local');
    assert.equal(
      StorageService.getCurrentUsn(),
      head,
      'guardar uma revisão que veio do Drive não pode mexer no contador'
    );

    // ── o próximo sync (o delta do Drive é acumulado) ──
    const resultado2 = applyDeltaToStorage(delta, head);
    assert.equal(resultado2.revlogApplied, 0, 'a revisão não pode entrar duplicada');
    assert.equal(StorageService.getRevlog().length, 1, 'o histórico não pode ter repetida');
  });
});

describe('O botão do Sync NÃO fica laranja depois de aplicar o delta', () => {
  beforeEach(limpar);

  it('depois do download do delta o aparelho não tem nada pendente', () => {
    // ── o estado local (base em 285) ──
    StorageService.saveNotes([makeNote({ id: 'note-a', guid: 'guid-a', usn: 280 })]);
    StorageService.saveCards([makeCard({ id: 'card-a', noteId: 'note-a', usn: 280 })]);
    StorageService.adoptUsnCounter(285);
    const lastSynced = 285;
    const head = 296;

    // ── o delta do Drive (revisão + 1 par de deleção) ──
    const delta = makeDelta({
      revlog: [makeRevlog({ id: 'rev-1', cardId: 'card-a', noteId: 'note-a', reviewTime: 1794711535226, usn: 289 })],
      tombstones: [
        { type: 'note', id: 'note-b', guid: 'guid-b', usn: 293, deletedAt: 1 } as Tombstone,
        { type: 'card', id: 'card-b', guid: 'guid-b', templateOrd: 0, usn: 293, deletedAt: 1 } as Tombstone,
      ],
      currentUsn: head,
    });

    // ── o download incremental (o caminho real) ──
    applyDeltaToStorage(delta, lastSynced);

    // ── o fim do fluxo real (gdriveSync.ts: setLastSynced/adopt/base) ──
    StorageService.adoptUsnCounter(head);
    setSyncBase(computeSnapshot(localSyncContent(), 'device-local', 'PC'));

    assert.equal(
      StorageService.getCurrentUsn(),
      head,
      'o contador não pode ficar acima do head (senão o aparelho acha que tem o que publicar)'
    );
    assert.equal(
      StorageService.getAllSyncTombstonesSince(head).length,
      0,
      'a deleção do Drive não pode virar pendência local'
    );
    assert.equal(
      StorageService.getPendingDeletionCounts(head).notes ?? 0,
      0,
      'a contagem de deleções pendentes tem que ficar zerada'
    );
  });
});
