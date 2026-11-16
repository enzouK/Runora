/**
 * Revisões (revlog) que chegam pelo **delta incremental**.
 *
 * POR QUE ESTE MÓDULO EXISTE (bug de 15/11/2026):
 *
 * O caminho incremental aplicava a revisão exatamente como ela veio do
 * Drive: `StorageService.saveRevlog(entry)`. Isso quebrava três coisas:
 *
 * 1. **O `cardId` é o do aparelho de origem.** Cada aparelho tem os seus
 *    ids (o card é reconhecido entre aparelhos pelo par *(GUID da nota,
 *    ordem do template)*). Salvar a revisão crua deixava uma revisão
 *    apontando para um card que não existe aqui.
 * 2. **Sem dedupe.** O delta do Drive é **acumulado** (cobre da base até o
 *    head) e pode ser aplicado mais de uma vez → a mesma revisão entrava
 *    duplicada no histórico.
 * 3. **Consumia USN.** `saveRevlog` chamava `nextUsn()` mesmo com a
 *    revisão já teniendo USN → o contador compartilhado andava sem
 *    conteúdo novo (e o aparelho passava a "publicar" um delta vazio).
 *
 * O caminho **completo** (base + delta) já faz isso certo, em
 * `mergeRemoteRevlog` (`syncApply.ts`). Aqui está o mesmo cuidado para o
 * caminho incremental — com a diferença de que aqui só se conhece o
 * **delta** (não a coleção inteira do outro aparelho).
 *
 * A IDENTIDADE DA REVISÃO (T16, 15/11/2026):
 *
 * A revisão agora tem um id **universal** (o mesmo card + o mesmo horário
 * = o mesmo id em qualquer aparelho — ver `reviewIdentity.ts`). E a
 * revisão de um card **apagado** não é mais descartada: ela é guardada
 * (é o que o addon *Review Heatmap* conta) e continua sendo a mesma
 * revisão nos dois aparelhos.
 *
 * NADA aqui mexe no FSRS, na agenda de estudo ou no formato do `.colpkg`:
 * só em como a revisão recebida é guardada.
 */

import type { Card, Note, RevlogEntry, Tombstone } from '../types/runora';
import type { SyncDelta } from './syncDelta';
import {
  buildCardIdentityIndex,
  hasUniversalId,
  reviewDedupeKeys,
  universalReviewId,
  type CardIdentity,
} from './reviewIdentity';

/** Identidade universal de um card (a que atravessa os aparelhos). */
export interface RemoteCardRef {
  /** GUID da nota dona. */
  guid: string;
  /** Ordem do template do card. */
  templateOrd: number;
}

/** A coleção local (o que este aparelho tem). */
export interface LocalRevlogContext {
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
  /** Cards apagados (tombstones) — a identidade do card continua neles. */
  tombstones?: Tombstone[];
}

/** O que o resolvedor conseguiu fazer com as revisões recebidas. */
export interface ResolvedRevlog {
  /** Revisões prontas para guardar (já com o `cardId` LOCAL). */
  entries: RevlogEntry[];
  /** Revisões repetidas (a mesma revisão já estava aqui). */
  duplicates: number;
  /** Revisões guardadas sem card local (o card foi apagado). */
  orphans: number;
}

/**
 * Índice dos cards REMOTOS: id do card (no aparelho de origem) →
 * identidade universal (GUID da nota + ordem do template).
 *
 * Só dá para montar com o que está no delta: os cards que mudaram desde a
 * base e o mapa `id da nota → GUID`.
 */
export function buildRemoteCardIndex(delta: SyncDelta): Map<string, RemoteCardRef> {
  const index = new Map<string, RemoteCardRef>();

  // GUID da nota: ou vem no próprio delta (nota nova/editada) ou no mapa
  // `noteGuids` (notas de antes da base — é o que permite casar um card
  // que só apareceu no delta).
  const guidByNoteId = new Map<string, string>();
  for (const note of delta.notes ?? []) {
    const guid = note.guid?.trim();
    if (guid) guidByNoteId.set(note.id, guid);
  }
  for (const [noteId, guid] of Object.entries(delta.noteGuids ?? {})) {
    if (guid?.trim()) guidByNoteId.set(noteId, guid.trim());
  }

  for (const card of delta.cards ?? []) {
    const guid = guidByNoteId.get(card.noteId);
    if (!guid) continue;
    index.set(card.id, { guid, templateOrd: card.templateOrd });
  }

  return index;
}

/**
 * Casar uma revisão remota com o card **local** que ela pertence.
 *
 * Três tentativas, da mais segura para a mais "~":
 *
 * 1. **Mesmo id**: os cards que vieram da base do Drive mantêm o id do
 *    aparelho que a gravou — então o `cardId` da revisão bate direto.
 * 2. **Identidade universal**: o delta traz o card (com o `templateOrd`) e
 *    o mapa `nota → GUID` → casa pelo par *(GUID, ordem)*.
 * 3. **Só o GUID da nota**: o delta traz o `noteId` da revisão e o mapa
 *    `noteGuids`. Quando a nota tem **um** card aqui, esse card é
 *    certamente o remoto. Com mais de um card, a ordem do template remoto
 *    é desconhecida — e chutar seria atribuir a revisão ao card errado
 *    (isto mexeria na agenda de estudo: por isso, nesse caso, a revisão é
 *    guardada como órfã, sem card local, em vez de errar).
 */
function resolveLocalCard(
  entry: RevlogEntry,
  remoteIndex: Map<string, RemoteCardRef>,
  localById: Map<string, Card>,
  localByIdentity: Map<string, Card>,
  localCardsByGuid: Map<string, Card[]>,
  delta: SyncDelta
): Card | undefined {
  // 1) mesmo id
  const porId = localById.get(entry.cardId);
  if (porId) return porId;

  // 2) identidade universal (GUID + ordem do template)
  const ref = remoteIndex.get(entry.cardId);
  if (ref) {
    const card = localByIdentity.get(`${ref.guid}:${ref.templateOrd}`);
    if (card) return card;
  }

  // 3) o GUID da nota (vem no `noteGuids` do delta)
  const guid = (delta.noteGuids ?? {})[entry.noteId]?.trim();
  if (guid) {
    const cards = localCardsByGuid.get(guid) ?? [];
    if (cards.length === 1) return cards[0];
  }

  return undefined;
}

/**
 * Resolve as revisões do delta para os cards locais.
 *
 * O resultado já está no formato do histórico local (`cardId`/`noteId`
 * locais, id universal) e sem duplicatas.
 *
 * A REVISÃO DE UM CARD APAGADO **é guardada** (não é descartada): ela
 * fica invisível na tela de estudo, mas continua no histórico — é o que
 * o *Review Heatmap* conta, e o número tem que ser o mesmo em todos os
 * aparelhos.
 */
export function resolveRemoteRevlog(
  remoteRevlog: RevlogEntry[],
  delta: SyncDelta,
  local: LocalRevlogContext
): ResolvedRevlog {
  const empty: ResolvedRevlog = { entries: [], duplicates: 0, orphans: 0 };
  if (!remoteRevlog || remoteRevlog.length === 0) return empty;

  const remoteIndex = buildRemoteCardIndex(delta);

  // (GUID, ordem) → card local
  const localByIdentity = new Map<string, Card>();
  const localCardsByGuid = new Map<string, Card[]>();
  const localById = new Map<string, Card>();
  const guidByNoteId = new Map<string, string>();
  for (const note of local.notes) {
    const guid = note.guid?.trim();
    if (guid) guidByNoteId.set(note.id, guid);
  }
  for (const card of local.cards) {
    localById.set(card.id, card);
    const guid = guidByNoteId.get(card.noteId);
    if (!guid) continue;
    localByIdentity.set(`${guid}:${card.templateOrd}`, card);
    const lista = localCardsByGuid.get(guid) ?? [];
    lista.push(card);
    localCardsByGuid.set(guid, lista);
  }

  // Identidade de QUALQUER card que este aparelho conhece — inclusive os
  // apagados (o tombstone carrega o GUID e a ordem do template).
  const identityIndex = buildCardIdentityIndex(
    local.notes,
    local.cards,
    [...(local.tombstones ?? []), ...(delta.tombstones ?? [])]
  );
  for (const [cardId, ref] of remoteIndex) {
    identityIndex.set(cardId, { guid: ref.guid, templateOrd: ref.templateOrd });
  }

  const entries: RevlogEntry[] = [];
  let duplicates = 0;
  let orphans = 0;

  // Dedupe: a mesma revisão (mesma identidade + mesmo horário) não entra
  // duas vezes — nem vinda de novo do Drive, nem repetida no histórico.
  // As duas chaves são usadas (identidade universal e card local): a
  // revisão de um card apagado não tem identidade resolvível, e aí é o
  // id do card (que é o do aparelho de origem) que casa com ela.
  const seen = new Set<string>();
  for (const localEntry of local.revlog) {
    const localIdentity = identityIndex.get(localEntry.cardId);
    for (const key of reviewDedupeKeys(localEntry, localIdentity)) seen.add(key);
  }

  for (const entry of remoteRevlog) {
    const card = resolveLocalCard(
      entry,
      remoteIndex,
      localById,
      localByIdentity,
      localCardsByGuid,
      delta
    );

    // A identidade do card da revisão (para o id universal e para o dedupe).
    // Vem do card que casou, do índice de identidade ou — quando a revisão
    // já nasceu no app novo — do próprio id (que é universal).
    const identity: CardIdentity | undefined =
      card && guidByNoteId.get(card.noteId)
        ? { guid: guidByNoteId.get(card.noteId)!, templateOrd: card.templateOrd ?? 0 }
        : identityIndex.get(entry.cardId);

    // O id final: o universal (calculado aqui ou o que veio, que já é o
    // mesmo em qualquer aparelho). Uma revisão legada sem identidade
    // possível fica com o id que veio — nunca se perde revisão.
    const id = hasUniversalId(entry)
      ? entry.id
      : identity
        ? universalReviewId(entry.reviewTime, identity)
        : entry.id;

    const mapped: RevlogEntry = {
      ...entry,
      id,
      cardId: card?.id ?? entry.cardId,
      noteId: card?.noteId ?? entry.noteId,
    };
    if (!card) orphans++;

    // Dedupe: a mesma revisão (mesma identidade + mesmo horário) não entra
    // duas vezes — nem vinda de novo do Drive, nem repetida no histórico.
    const keys = reviewDedupeKeys(mapped, identity);
    if (keys.some((key) => seen.has(key))) {
      duplicates++;
      continue;
    }
    for (const key of keys) seen.add(key);

    entries.push(mapped);
  }

  return { entries, duplicates, orphans };
}
