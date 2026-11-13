/**
 * "Este aparelho está com o conteúdo VELHO?" — o sinal que decide se o
 * app precisa baixar a base (o `.colpkg`) de novo.
 *
 * O caso real que estes testes cobrem (bug das revisões que não chegavam):
 *
 * - O `.exe` revisou 2 cards e reenviou o backup completo → o Drive ficou
 *   com 7 revisões e o emulador continuava com 3.
 * - O emulador, porém, tinha 2 deleções LOCAIS com USN 244 (o head) → o
 *   "maior USN" (que contava os tombstones) dizia 244 = head → o aparelho
 *   achava que estava em dia e nunca buscava a base.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isBehindRemote, isMissingRemoteItems } from './syncBehind';
import type { CollectionCounts } from './syncBehind';

const contagens = (parcial: Partial<CollectionCounts> = {}): CollectionCounts => ({
  decks: 2,
  notes: 81,
  cards: 81,
  noteTypes: 4,
  revlog: 7,
  ...parcial,
});

describe('sinal de "conteúdo atrás do head" — as contagens do STATE', () => {
  it('detecta que faltam revisões (Drive 7, aparelho 3)', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      remoteBaseUsn: 244,
      remoteCounts: contagens({ revlog: 7 }),
      localBaseUsn: 0,
      localCounts: contagens({ revlog: 3 }),
      localContentMaxUsn: 206,
      pendingDeletions: {},
    });
    assert.equal(atrasado, true, 'faltam 4 revisões → o aparelho precisa da base');
  });

  it('NÃO acusa atraso quando as contagens batem (o .exe: 7 revisões dos dois lados)', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      remoteBaseUsn: 244,
      remoteCounts: contagens({ revlog: 7 }),
      localBaseUsn: 244,
      localCounts: contagens({ revlog: 7 }),
      localContentMaxUsn: 211,
      pendingDeletions: {},
    });
    assert.equal(atrasado, false, 'mesma base e mesmas contagens → nada a fazer');
  });

  it('a deleção local pendente NÃO vira falso positivo (item deletado ainda está no Drive)', () => {
    // o Drive tem 81 notas; aqui há 80 porque uma foi deletada (e a
    // deleção ainda não subiu) → não falta conteúdo, só falta subir.
    const faltando = isMissingRemoteItems(
      contagens({ notes: 81 }),
      contagens({ notes: 80 }),
      { note: 1 }
    );
    assert.equal(faltando, false, 'a deleção local explica a diferença');
  });

  it('a deleção local pendente NÃO esconde uma falta real de conteúdo', () => {
    // o Drive tem 81 notas; aqui há 79 (1 deletada localmente) → ainda
    // faltam 2 do Drive.
    const faltando = isMissingRemoteItems(
      contagens({ notes: 81 }),
      contagens({ notes: 79 }),
      { note: 1 }
    );
    assert.equal(faltando, true, 'mesmo com a deleção pendente, falta conteúdo');
  });
});

describe('sinal de "conteúdo atrás do head" — a base (baseUsn)', () => {
  it('base do Drive mais nova que a nossa → atrás (o delta não cobre a base)', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 300,
      remoteBaseUsn: 300,
      remoteCounts: contagens(),
      localBaseUsn: 244,
      localCounts: contagens(),
      localContentMaxUsn: 300,
      pendingDeletions: {},
    });
    assert.equal(atrasado, true);
  });

  it('base igual → não está atrasado (mesmo que o conteúdo tenha USN menor)', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      remoteBaseUsn: 244,
      remoteCounts: contagens(),
      localBaseUsn: 244,
      localCounts: contagens(),
      // o conteúdo é menor que o head porque a última mudança foi uma
      // deleção local (o head conta a deleção, o conteúdo não)
      localContentMaxUsn: 211,
      pendingDeletions: { note: 1 },
    });
    assert.equal(atrasado, false, 'com a base em dia não se baixa 72,9 MB à toa');
  });

  it('base igual → as contagens não podem mandar baixar a base de novo', () => {
    // caso real depois da recuperação: o Drive tem 7 revisões e este
    // aparelho tem 5 (2 revisões são de cards que ele não tem) — com a
    // base em dia, isso NÃO pode virar "baixa a coleção inteira".
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      remoteBaseUsn: 244,
      remoteCounts: contagens({ revlog: 7 }),
      localBaseUsn: 244,
      localCounts: contagens({ revlog: 5 }),
      localContentMaxUsn: 211,
      pendingDeletions: {},
    });
    assert.equal(atrasado, false, 'com a base em dia não se baixa 72,9 MB à toa');
  });
});

describe('sinal de "conteúdo atrás do head" — o USN do conteúdo (sem contagens)', () => {
  it('sem STATE com contagens e sem base conhecida, o conteúdo mais velho que o head → atrás', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      localBaseUsn: 0,
      localCounts: contagens(),
      localContentMaxUsn: 206,
      pendingDeletions: {},
    });
    assert.equal(atrasado, true);
  });

  it('sem base conhecida e conteúdo no head → não está atrasado', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      localBaseUsn: 0,
      localCounts: contagens(),
      localContentMaxUsn: 244,
      pendingDeletions: {},
    });
    assert.equal(atrasado, false);
  });

  it('base conhecida e igual → o USN do conteúdo não manda baixar a base', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 244,
      remoteBaseUsn: 244,
      localBaseUsn: 244,
      localCounts: contagens(),
      localContentMaxUsn: 206,
      pendingDeletions: {},
    });
    assert.equal(atrasado, false);
  });

  it('head 0 (Drive sem estado) → nunca "atrás"', () => {
    const atrasado = isBehindRemote({
      remoteHeadUsn: 0,
      localBaseUsn: 0,
      localCounts: contagens(),
      localContentMaxUsn: 1,
      pendingDeletions: {},
    });
    assert.equal(atrasado, false);
  });
});
