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
 *    **órfã**: apontando para um card que não existe aqui — o histórico
 *    sumia da tela e a contagem de revisões do aparelho ficava errada.
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
 * NADA aqui mexe no FSRS, na agenda de estudo ou no formato do `.colpkg`:
 * só em como a revisão recebida é guardada.
 */

import type { Card, Note, RevlogEntry } from '../types/runora';
import type { SyncDelta } from './syncDelta';

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
}

/** O que o resolvedor conseguiu fazer com as revisões recebidas. */
export interface ResolvedRevlog {
  /** Revisões prontas para guardar (já com o `cardId` LOCAL). */
  entries: RevlogEntry[];
  /** Revisões que vieram do Drive mas não puderam ser guardadas. */
  skipped: number;
  /** Revisões repetidas (a mesma revisão já estava aqui). */
  duplicates: number;
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
 *    ignorada em vez de errar).
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
 * locais, id determinístico) e sem duplicatas.
 */
export function resolveRemoteRevlog(
  remoteRevlog: RevlogEntry[],
  delta: SyncDelta,
  local: LocalRevlogContext
): ResolvedRevlog {
  const empty: ResolvedRevlog = { entries: [], skipped: 0, duplicates: 0 };
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

  // Dedupe: a mesma revisão (mesmo card local + mesmo horário) não entra
  // duas vezes — nem vinda de novo do Drive, nem repetida no histórico.
  const seen = new Set(local.revlog.map((e) => `${e.reviewTime}:${e.cardId}`));

  const entries: RevlogEntry[] = [];
  let skipped = 0;
  let duplicates = 0;

  for (const entry of remoteRevlog) {
    const card = resolveLocalCard(
      entry,
      remoteIndex,
      localById,
      localByIdentity,
      localCardsByGuid,
      delta
    );
    if (!card) {
      // revisão de um card que não existe aqui (o card foi deletado ou
      // ainda não chegou) — guardar assim deixaria a revisão órfã.
      skipped++;
      continue;
    }
    const key = `${entry.reviewTime}:${card.id}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    entries.push({
      ...entry,
      id: `rev-sync-${card.id}-${entry.reviewTime}`,
      cardId: card.id,
      noteId: card.noteId,
    });
  }

  return { entries, skipped, duplicates };
}
