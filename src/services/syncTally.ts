/**
 * Contadores ao vivo do painel de sync (estilo Anki).
 *
 * Convenção das setas (igual ao Anki):
 *   ↑ = enviado deste aparelho para o Drive
 *   ↓ = recebido do Drive (outro aparelho)
 *
 * O tally é ACUMULADO durante o sync inteiro — cada emissão de progresso
 * traz o total até aquele momento, para o painel só precisar exibir.
 * Todas as funções são puras (devolvem objeto novo) — seguras para React.
 */

export interface SyncTally {
  /** Adicionados/modificados enviados daqui (↑). */
  addedUp: number;
  /** Adicionados/modificados recebidos da nuvem (↓). */
  addedDown: number;
  /** Removidos enviados daqui (↑). */
  removedUp: number;
  /** Removidos recebidos da nuvem (↓). */
  removedDown: number;
}

export type SyncTallyDirection = 'up' | 'down';

/** Tally zerado — o sync começa todos os contadores em 0. */
export function emptySyncTally(): SyncTally {
  return { addedUp: 0, addedDown: 0, removedUp: 0, removedDown: 0 };
}

/** Soma incrementos ao tally (devolve objeto novo; campos omitidos = 0). */
export function bumpTally(base: SyncTally, add: Partial<SyncTally>): SyncTally {
  return {
    addedUp: base.addedUp + (add.addedUp ?? 0),
    addedDown: base.addedDown + (add.addedDown ?? 0),
    removedUp: base.removedUp + (add.removedUp ?? 0),
    removedDown: base.removedDown + (add.removedDown ?? 0),
  };
}

/**
 * Conta itens de coleção (decks/notas/cards/presets) como "adicionados/modificados"
 * na direção dada. Mídia, preferências e extensões NÃO entram no tally —
 * aparecem no contador por parte ("12 de 81 notas"), como no Anki.
 */
export function tallyFromCounts(
  counts: { decks?: number; notes?: number; cards?: number; presets?: number } | undefined,
  direction: SyncTallyDirection
): Partial<SyncTally> {
  const items =
    (counts?.decks ?? 0) + (counts?.notes ?? 0) + (counts?.cards ?? 0) + (counts?.presets ?? 0);
  if (items === 0) return {};
  return direction === 'up' ? { addedUp: items } : { addedDown: items };
}

/**
 * O que uma MESCLA envia daqui (↑): itens que só mudaram aqui + disputas
 * vencidas pela versão daqui; itens apagados daqui contam como "Removidos ↑".
 * Note types e preferências não são itens de coleção (ficam fora, como no
 * tallyFromCounts). Uso no caminho de mescla do sync (mergeAndUpload), que
 * sobe o estado combinado — o que ele acrescenta ao Drive é exatamente isto.
 */
export function tallyUpFromLocalDiff(
  diff: {
    localOnly: { kind: string }[];
    localDeleted: { kind: string }[];
    conflicts: { kind: string }[];
  },
  conflictWinner?: 'local' | 'remote'
): Partial<SyncTally> {
  const counts = { decks: 0, notes: 0, cards: 0, presets: 0 };
  const byKind: Record<string, keyof typeof counts> = {
    deck: 'decks',
    note: 'notes',
    card: 'cards',
    preset: 'presets',
  };
  const bump = (kind: string): void => {
    const slot = byKind[kind];
    if (slot) counts[slot]++;
  };
  for (const item of diff.localOnly) bump(item.kind);
  if (conflictWinner === 'local') for (const item of diff.conflicts) bump(item.kind);
  const removed = diff.localDeleted.filter((t) => byKind[t.kind]).length;
  const add = tallyFromCounts(counts, 'up');
  return removed > 0 ? { ...add, removedUp: removed } : add;
}

/** Total de adicionados/modificados (as duas direções). */
export function tallyChanged(t: SyncTally): number {
  return t.addedUp + t.addedDown;
}

/** Total de removidos (as duas direções). */
export function tallyRemoved(t: SyncTally): number {
  return t.removedUp + t.removedDown;
}

/** Total enviado daqui (↑). */
export function tallySent(t: SyncTally): number {
  return t.addedUp + t.removedUp;
}

/** Total recebido da nuvem (↓). */
export function tallyReceived(t: SyncTally): number {
  return t.addedDown + t.removedDown;
}
