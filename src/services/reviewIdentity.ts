/**
 * reviewIdentity — identidade universal da REVISÃO (revlog).
 *
 * A nota tem o GUID ("RG" universal), o card tem (GUID da nota, ordem do
 * template)… mas a REVISÃO não tinha identidade nenhuma: cada aparelho
 * criava o id do seu jeito (`rev-<hora>-<aleatório>`) e o sync o reescrevia
 * (`rev-sync-<card local>-<hora>`). O mesmo estudo virava **duas
 * revisões diferentes** — e, quando a base e o delta traziam a mesma
 * revisão com ids diferentes, ela entrava **duas vezes** no histórico.
 *
 * Aqui a revisão ganha uma identidade que é a MESMA em qualquer aparelho:
 *
 * ```
 * rev-<reviewTime>-<fnv1a(GUID da nota | ordem do template)>
 * ```
 *
 * O mesmo card + o mesmo horário = **o mesmo id em todos os aparelhos**.
 *
 * POR QUE ISSO NÃO MUDA O FORMATO DO `.colpkg`/DELTA:
 * o `id` da revisão é um campo **opaco** (uma string). Nenhum campo novo,
 * nenhuma estrutura nova — só o VALOR do id, que passa a ser derivado em
 * vez de aleatório.
 *
 * POR QUE A REVISÃO DE UM CARD APAGADO CONTINUA IMPORTANTE:
 * o addon *Review Heatmap* (calendário de revisões por dia) precisa contar
 * as revisões **mesmo que o card seja apagado depois** — e o número tem que
 * ser **igual em todos os aparelhos**. Por isso a revisão de card apagado
 * **viaja** no sync (não é mais descartada) e mantém a identidade do card
 * que ela pertence, mesmo depois de o card não existir mais.
 */
import type { Card, Note, RevlogEntry, Tombstone } from '../types/runora';
import { fnv1aHash } from './noteIdentity';

/** Identidade universal de um card: (GUID da nota dona, ordem do template). */
export interface CardIdentity {
  guid: string;
  templateOrd: number;
}

/** O id universal tem este formato: `rev-<hora>-<hash de 8 hex>`. */
const UNIVERSAL_ID = /^rev-(\d+)-([0-9a-f]{8})$/;

/** Chave universal do card (a que atravessa os aparelhos). */
export function cardIdentityKey(identity: CardIdentity): string {
  return `${identity.guid}|${identity.templateOrd}`;
}

/**
 * ID universal e determinístico de uma revisão.
 *
 * O mesmo card (identidade universal) + o mesmo horário → o mesmo id em
 * qualquer aparelho, sem depender de nada que o outro aparelho tenha.
 */
export function universalReviewId(reviewTime: number, identity: CardIdentity): string {
  return `rev-${reviewTime}-${fnv1aHash(cardIdentityKey(identity))}`;
}

/** O id já é universal (nascido pelo app novo)? */
export function isUniversalReviewId(id: string): boolean {
  return UNIVERSAL_ID.test(id);
}

/**
 * Índice de identidade dos cards: id do card (no aparelho que o tem) →
 * identidade universal (GUID da nota + ordem do template).
 *
 * Entra no índice:
 * - os cards **vivos** (a identidade vem da nota dona, pelo seu GUID);
 * - os cards **apagados** (a identidade vem do *tombstone*, que já carrega
 *   o GUID e a ordem — sem isso a revisão de um card deletado ficaria sem
 *   identidade e cada aparelho daria um id diferente para ela).
 */
export function buildCardIdentityIndex(
  notes: Note[],
  cards: Card[],
  tombstones: Tombstone[] = []
): Map<string, CardIdentity> {
  const index = new Map<string, CardIdentity>();

  const guidByNoteId = new Map<string, string>();
  for (const note of notes) {
    const guid = note.guid?.trim();
    if (guid) guidByNoteId.set(note.id, guid);
  }

  for (const card of cards) {
    const guid = guidByNoteId.get(card.noteId);
    if (!guid) continue;
    index.set(card.id, { guid, templateOrd: card.templateOrd ?? 0 });
  }

  // card apagado: o tombstone é a "certidão de óbito" com a identidade
  for (const tomb of tombstones) {
    if (tomb.type !== 'card') continue;
    const guid = tomb.guid?.trim();
    if (!guid || tomb.templateOrd === undefined) continue;
    index.set(tomb.id, { guid, templateOrd: tomb.templateOrd });
  }

  return index;
}

/**
 * As chaves que identificam uma revisão para o **dedupe**.
 *
 * São duas, porque a revisão pode chegar de um card que não existe mais:
 * - `identity`: (horário + GUID + ordem) → a mesma revisão em qualquer
 *   aparelho;
 * - `card`: (horário + id do card) → reserva para quando a identidade não
 *   pode ser resolvida (o card já foi apagado e não há tombstone).
 *
 * O dedupe considera as DUAS: uma revisão é repetida se casar por
 * qualquer uma delas.
 */
export function reviewDedupeKeys(
  entry: RevlogEntry,
  identity?: CardIdentity
): string[] {
  const keys: string[] = [];
  if (identity) keys.push(`id:${entry.reviewTime}|${cardIdentityKey(identity)}`);
  keys.push(`card:${entry.reviewTime}|${entry.cardId}`);
  return keys;
}

/**
 * A revisão já tem o id universal? (nasceu no app novo)
 *
 * Serve para decidir se vale a pena RECALCULAR o id de uma revisão que
 * veio do Drive: se ela já é universal, o id que chegou é o mesmo que
 * qualquer aparelho calcularia → guardar como veio.
 */
export function hasUniversalId(entry: RevlogEntry): boolean {
  return isUniversalReviewId(entry.id);
}

/** Resultado da mescla do histórico local com o que veio do Drive. */
export interface MergeRevlogResult {
  /** O histórico novo (o local, com as correções e as novidades). */
  merged: RevlogEntry[];
  /** Revisões novas que entraram. */
  applied: number;
  /** Revisões repetidas (a mesma revisão já estava aqui). */
  duplicates: number;
  /** Revisões legadas que foram atualizadas para o id universal. */
  replaced: number;
}

/**
 * Mescla as revisões que chegaram do Drive no histórico local.
 *
 * Três regras:
 *
 * 1. **A mesma revisão não entra duas vezes.** O casamento é pela
 *    identidade universal (GUID + ordem + horário) e, quando a identidade
 *    não é possível (card já apagado), pelo (horário + id do card).
 * 2. **O id universal vence.** Se a revisão que está aqui é legada
 *    (`rev-<hora>-<aleatório>`) e a que chegou do Drive já tem o id
 *    universal, a local é **atualizada** — é assim que os dois aparelhos
 *    passam a ter o mesmo id para a mesma revisão.
 * 3. **Nenhuma revisão é descartada.** A revisão de um card apagado fica
 *    guardada (é o que o *Review Heatmap* conta).
 */
export function mergeRevlogEntries(
  local: RevlogEntry[],
  incoming: RevlogEntry[],
  resolveIdentity: (entry: RevlogEntry) => CardIdentity | undefined
): MergeRevlogResult {
  const merged = [...local];

  // chave → índice da revisão local
  const indexByKey = new Map<string, number>();
  local.forEach((entry, i) => {
    const identity = resolveIdentity(entry);
    for (const key of reviewDedupeKeys(entry, identity)) indexByKey.set(key, i);
  });

  let applied = 0;
  let duplicates = 0;
  let replaced = 0;

  for (const entry of incoming) {
    const identity = resolveIdentity(entry);
    const keys = reviewDedupeKeys(entry, identity);

    let found = -1;
    for (const key of keys) {
      const idx = indexByKey.get(key);
      if (idx !== undefined) {
        found = idx;
        break;
      }
    }

    if (found >= 0) {
      const atual = merged[found];
      if (hasUniversalId(entry) && !hasUniversalId(atual)) {
        // a revisão que chegou tem o id universal → a local (legada) vira ela
        merged[found] = entry;
        replaced++;
        for (const key of reviewDedupeKeys(atual, resolveIdentity(atual))) {
          indexByKey.delete(key);
        }
        for (const key of keys) indexByKey.set(key, found);
      } else {
        duplicates++;
      }
      continue;
    }

    merged.push(entry);
    const idx = merged.length - 1;
    for (const key of keys) indexByKey.set(key, idx);
    applied++;
  }

  return { merged, applied, duplicates, replaced };
}
