/**
 * Aplica o **delta do Drive** no armazenamento local.
 *
 * Este é o caminho que roda quando o outro aparelho mudou alguma coisa e
 * este aparelho ainda tem a mesma base (o caso "download incremental").
 *
 * POR QUE ESTE MÓDULO EXISTE (bug de 15/11/2026):
 *
 * A aplicação do delta ficava espalhada dentro do `gdriveSync.ts` e fazia
 * três coisas erradas:
 *
 * 1. **A revisão era salva crua** (`StorageService.saveRevlog`), com o
 *    `cardId` do **aparelho de origem** → revisão órfã (aponta para um card
 *    que não existe aqui), sem dedupe e consumindo USN.
 * 2. **A deleção remota virava tombstone local pendente** (USN acima do
 *    head) → o botão do Sync ficava laranja e a deleção voltava para o
 *    Drive a cada sync (ping-pong).
 * 3. **O delta acumulado era aplicado inteiro** → o que já tinha sido
 *    aplicado entrava de novo (revisões duplicadas).
 *
 * Aqui as três coisas estão resolvidas — e, como o caminho é uma função
 * só, ele pode ser testado de verdade (veja `syncIncremental.test.ts`).
 *
 * NADA aqui mexe no FSRS, na agenda de estudo ou no formato do `.colpkg`.
 */

import type { Card, Deck, Note, NoteType, Preset, RevlogEntry } from '../types/runora';
import { StorageService } from './storage';
import { applyDelta, type SyncDelta } from './syncDelta';
import { resolveRemoteRevlog } from './syncRevlog';
import { buildCardIdentityIndex, mergeRevlogEntries } from './reviewIdentity';

/** Tipos de entidade que o delta pode trazer. */
export type DeltaEntityType = 'deck' | 'notetype' | 'note' | 'card' | 'revlog' | 'preset';

/** Ganchos para o painel de progresso / os contadores da tela. */
export interface ApplyDeltaHooks {
  /** Uma entidade do delta foi aplicada. */
  onEntity?: (type: DeltaEntityType) => void;
  /** Um tombstone (deleção) do delta foi aplicado. */
  onTombstone?: () => void;
}

/** O que a aplicação conseguiu fazer. */
export interface ApplyDeltaResult {
  /** O USN novo (o head do Drive). */
  headUsn: number;
  /** Revisões que entraram no histórico local. */
  revlogApplied: number;
  /** Revisões guardadas sem card local (o card foi apagado). */
  revlogOrphans: number;
  /** Revisões que eram repetidas (já estavam no histórico). */
  revlogDuplicates: number;
  /** Revisões legadas que ganharam o id universal. */
  revlogReplaced: number;
}

/**
 * Aplica o delta no storage local.
 *
 * @param sinceUsn só o que é **novo** para este aparelho é aplicado (o
 *                 delta do Drive é acumulado: cobre da base até o head).
 */
export function applyDeltaToStorage(
  delta: SyncDelta,
  sinceUsn: number,
  hooks: ApplyDeltaHooks = {}
): ApplyDeltaResult {
  // As revisões são aplicadas DEPOIS das notas/cards (elas precisam do
  // card local para ser casadas) — por isso ficam guardadas aqui e são
  // resolvidas no fim.
  const revlogRemoto: RevlogEntry[] = [];

  const headUsn = applyDelta(
    delta,
    // applyEntity: cria/atualiza a entidade no storage local
    (entity, type) => {
      switch (type) {
        case 'deck':
          StorageService.upsertDeck(entity as Deck);
          break;
        case 'notetype':
          StorageService.upsertNoteType(entity as NoteType);
          break;
        case 'note':
          StorageService.upsertNote(entity as Note);
          break;
        case 'card': {
          const card = entity as Card;
          // o `noteId` do card é o id da nota NO APARELHO DE ORIGEM: o delta
          // traz o mapa id → GUID para casar a nota localmente
          StorageService.upsertCard(card, delta.noteGuids?.[card.noteId]);
          break;
        }
        case 'revlog':
          revlogRemoto.push(entity as RevlogEntry);
          break;
        case 'preset':
          StorageService.upsertPreset(entity as Preset);
          break;
      }
      hooks.onEntity?.(type as DeltaEntityType);
    },
    // applyTombstone: aplica a deleção que veio do Drive
    (tombstone) => {
      // O `id` do tombstone é LOCAL do aparelho que deletou — aqui se casa
      // pela identidade universal (GUID da nota / nome do deck) para apagar
      // o item certo.
      //
      // A deleção vem do Drive: o USN novo JÁ existe (é o do outro
      // aparelho) → o tombstone local carrega o **USN do Drive**
      // (`remoteUsn`). Sem isso, ele nasceria com o USN do contador local
      // (acima do head) → viraria "mudança local pendente" → o botão Sync
      // ficaria laranja e a deleção voltaria para o Drive a cada sync.
      switch (tombstone.type) {
        case 'deck': {
          const id = StorageService.findDeckIdByName(tombstone.name) ?? tombstone.id;
          StorageService.withoutUsnBump(() =>
            StorageService.deleteDeck(id, { remoteUsn: tombstone.usn })
          );
          break;
        }
        case 'notetype': {
          const id = StorageService.findNoteTypeIdByName(tombstone.name) ?? tombstone.id;
          StorageService.withoutUsnBump(() =>
            StorageService.deleteNoteType(id, { remoteUsn: tombstone.usn })
          );
          break;
        }
        case 'note': {
          const id = StorageService.findNoteIdByGuid(tombstone.guid) ?? tombstone.id;
          StorageService.withoutUsnBump(() =>
            StorageService.deleteNote(id, { remoteUsn: tombstone.usn })
          );
          break;
        }
        case 'card': {
          const id =
            StorageService.findCardIdByIdentity(tombstone.guid, tombstone.templateOrd) ??
            tombstone.id;
          StorageService.withoutUsnBump(() =>
            StorageService.deleteCard(id, { remoteUsn: tombstone.usn })
          );
          break;
        }
        case 'revlog':
          // Revlog não tem delete individual — ignora (limpeza via sync completo se necessário)
          break;
        case 'preset': {
          const id = StorageService.findPresetIdByName(tombstone.name) ?? tombstone.id;
          StorageService.withoutUsnBump(() =>
            StorageService.deletePreset(id, { remoteUsn: tombstone.usn })
          );
          break;
        }
      }
      hooks.onTombstone?.();
    },
    // só o que é NOVO para este aparelho (o delta do Drive é acumulado)
    sinceUsn
  );

  // ── Revisões que vieram do Drive ──
  // O `cardId` delas é o do aparelho de origem: aqui cada revisão é
  // casada com o card LOCAL (remap), as repetidas são descartadas e
  // NENHUMA delas consome USN (o contador é compartilhado — ele só anda
  // com mudança real de conteúdo).
  //
  // A revisão de um card APAGADO é guardada do mesmo jeito (vira órfã):
  // ela é invisível na tela de estudo, mas continua no histórico — é o
  // que o addon *Review Heatmap* conta, e o número tem que ser o mesmo
  // em todos os aparelhos.
  let revlogApplied = 0;
  let revlogOrphans = 0;
  let revlogDuplicates = 0;
  let revlogReplaced = 0;
  if (revlogRemoto.length > 0) {
    const localRevlog = StorageService.getRevlog();
    const resolvidas = resolveRemoteRevlog(revlogRemoto, delta, {
      notes: StorageService.getNotes(),
      cards: StorageService.getCards(),
      revlog: localRevlog,
      tombstones: StorageService.getCardTombstones(),
    });
    revlogOrphans = resolvidas.orphans;

    const identityIndex = buildCardIdentityIndex(
      StorageService.getNotes(),
      StorageService.getCards(),
      [...StorageService.getCardTombstones(), ...(delta.tombstones ?? [])]
    );
    const mescladas = mergeRevlogEntries(localRevlog, resolvidas.entries, (entry) =>
      identityIndex.get(entry.cardId)
    );
    revlogApplied = mescladas.applied;
    revlogDuplicates = mescladas.duplicates;
    revlogReplaced = mescladas.replaced;
    if (mescladas.merged.length !== localRevlog.length || mescladas.replaced > 0) {
      StorageService.saveRevlogAll(mescladas.merged);
    }
  }

  return {
    headUsn,
    revlogApplied,
    revlogOrphans,
    revlogDuplicates,
    revlogReplaced,
  };
}
