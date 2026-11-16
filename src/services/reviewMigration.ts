/**
 * Migração local da identidade das revisões (T16, 15/11/2026).
 *
 * O QUE ELA FAZ:
 *
 * 1. **Re-estampa o id das revisões antigas.** Antes, o id da revisão era
 *    `rev-<hora>-<aleatório>` (ou `rev-sync-<card local>-<hora>`, criado
 *    pelo sync) — ou seja, **diferente em cada aparelho** para a mesma
 *    revisão. Agora o id é derivado da identidade do card (GUID da nota +
 *    ordem do template): o mesmo card + o mesmo horário = **o mesmo id em
 *    qualquer aparelho**.
 *
 * 2. **Aponta a revisão para o card LOCAL**, quando a revisão chegou do
 *    outro aparelho com o id de card de lá (a revisão continua a mesma,
 *    mas agora ela "pertence" ao card daqui → o histórico do card mostra
 *    tudo).
 *
 * 3. **Tira a revisão repetida** (a mesma revisão entrando 2× com ids
 *    diferentes).
 *
 * POR QUE CADA APARELHO FAZ SOZINHO:
 * o id universal é **derivado** (não é sincronizado): cada aparelho
 * calcula o mesmo valor a partir da mesma identidade → os ids convergem
 * sem nenhum tráfego de rede e sem mexer no USN (o conteúdo não muda — só
 * o rótulo do id).
 *
 * POR QUE ELA PRECISA RODAR NO MOMENTO DA DELEÇÃO:
 * a identidade de um card APAGADO só existe no *tombstone* dele — e o
 * tombstone é **limpo depois de publicado** (senão a deleção voltaria para
 * o Drive a cada sync). Se a migração só rodasse na abertura do app, uma
 * card apagada + sincronizada sem reiniciar o app ficaria sem identidade
 * para sempre — e cada aparelho daria um id diferente para a revisão
 * dela. Por isso a migração também roda **no instante em que o card é
 * apagado** (enquanto a identidade ainda está fresquinha).
 *
 * A revisão de um card APAGADO continua guardada: ela é o que o addon
 * *Review Heatmap* conta (e o número tem que bater em todos os aparelhos).
 */
import type { Card, Note, RevlogEntry, Tombstone } from '../types/runora';
import {
  buildCardIdentityIndex,
  hasUniversalId,
  reviewDedupeKeys,
  universalReviewId,
} from './reviewIdentity';

/** O que a migração mudou. */
export interface ReviewMigrationResult {
  /** Revisões que ganharam o id universal. */
  changed: number;
  /** Revisões repetidas que foram removidas. */
  removed: number;
  /** Revisões que passaram a apontar para o card local. */
  remapped: number;
  /** O histórico mudou? (se não, nem precisa gravar) */
  mudou: boolean;
}

/** O que a migração precisa saber (e de onde vem). */
export interface ReviewMigrationInput {
  revlog: RevlogEntry[];
  notes: Note[];
  cards: Card[];
  /** Cards apagados (tombstones) — a identidade do card continua neles. */
  tombstones: Tombstone[];
}

/**
 * Calcula o histórico migrado (sem gravar nada).
 *
 * É uma função pura: quem chama decide onde ler e onde gravar. Isso
 * permite o `storage.ts` usar a migração no instante da deleção sem criar
 * um ciclo de importação.
 */
export function planReviewIdentityMigration(
  input: ReviewMigrationInput
): ReviewMigrationResult & { entries: RevlogEntry[] } {
  const result: ReviewMigrationResult & { entries: RevlogEntry[] } = {
    changed: 0,
    removed: 0,
    remapped: 0,
    mudou: false,
    entries: input.revlog,
  };
  if (input.revlog.length === 0) return result;

  const identities = buildCardIdentityIndex(input.notes, input.cards, input.tombstones);

  // (GUID, ordem) → card local (para a revisão apontar para o card daqui)
  const cardByIdentity = new Map<string, Card>();
  const guidByNoteId = new Map<string, string>();
  for (const note of input.notes) {
    const guid = note.guid?.trim();
    if (guid) guidByNoteId.set(note.id, guid);
  }
  for (const card of input.cards) {
    const guid = guidByNoteId.get(card.noteId);
    if (!guid) continue;
    cardByIdentity.set(`${guid}:${card.templateOrd ?? 0}`, card);
  }

  const seen = new Set<string>();
  const migrated: RevlogEntry[] = [];

  for (const entry of input.revlog) {
    const identity = identities.get(entry.cardId);

    // 1. o id universal (se a identidade do card é conhecida)
    let fixed = entry;
    if (!hasUniversalId(entry) && identity) {
      fixed = { ...fixed, id: universalReviewId(entry.reviewTime, identity) };
      result.changed++;
    }

    // 2. a revisão aponta para o card LOCAL (aqui o id do card é local)
    if (identity) {
      const localCard = cardByIdentity.get(`${identity.guid}:${identity.templateOrd ?? 0}`);
      if (localCard && (fixed.cardId !== localCard.id || fixed.noteId !== localCard.noteId)) {
        fixed = { ...fixed, cardId: localCard.id, noteId: localCard.noteId };
        result.remapped++;
      }
    }

    // 3. a mesma revisão não pode ficar 2×
    const keys = reviewDedupeKeys(fixed, identity);
    if (keys.some((key) => seen.has(key))) {
      result.removed++;
      continue;
    }
    for (const key of keys) seen.add(key);
    migrated.push(fixed);
  }

  result.entries = migrated;
  result.mudou = result.changed > 0 || result.removed > 0 || result.remapped > 0;
  return result;
}
