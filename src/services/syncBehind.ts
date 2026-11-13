/**
 * "Este aparelho está com o conteúdo VELHO?" — a decisão que destrava o
 * download da base (o `.colpkg`) quando o delta sozinho não basta.
 *
 * POR QUE ISTO EXISTE (a causa das revisões que não chegavam):
 *
 * O USN é um contador COMPARTILHADO. Quando o outro aparelho reenvia o
 * backup completo, o delta vai vazio e o head pode nem andar — mas o
 * conteúdo do Drive é novo. O aparelho que ficou para trás precisa saber
 * disso para baixar a base de novo.
 *
 * Três sinais, do mais confiável para o mais frágil:
 *
 * 1. **A base do Drive é mais nova que a nossa** (`baseUsn`): definitivo —
 *    o delta é relativo à base, então sem a base nova o resultado seria um
 *    estado misturado.
 * 2. **As contagens do STATE não batem com as daqui**: o Drive tem mais
 *    revisões/notas/cards do que este aparelho → falta conteúdo aqui.
 *    (Foi o caso do emulador: 7 revisões no Drive, 3 aqui.)
 * 3. **O USN do conteúdo** é menor que o head: último recurso (STATE sem
 *    contagens). Aqui valem só os ITENS — os tombstones (deleções locais)
 *    NÃO contam: uma deleção com USN alto não prova que o resto do
 *    conteúdo está atualizado (foi exatamente o que mascarou o conteúdo
 *    velho do emulador: tombstone em 244, conteúdo em 206).
 */

/** Contagens da coleção (as mesmas que o STATE do Drive publica). */
export interface CollectionCounts {
  decks: number;
  notes: number;
  cards: number;
  noteTypes: number;
  revlog: number;
}

/** Tudo que a decisão precisa saber (nada de I/O aqui — é puro). */
export interface BehindInput {
  /** Head (USN) que o Drive anuncia. */
  remoteHeadUsn: number;
  /** USN da base (o `.colpkg`) que está no Drive. */
  remoteBaseUsn?: number;
  /** Contagens da coleção que estão no Drive (STATE). */
  remoteCounts?: CollectionCounts;
  /** USN da base que ESTE aparelho tem (0 = não sabe). */
  localBaseUsn: number;
  /** Contagens da coleção local. */
  localCounts: CollectionCounts;
  /** Maior USN do CONTEÚDUTO local (sem as deleções). */
  localContentMaxUsn: number;
  /** Deleções locais que ainda não subiram, por tipo do tombstone. */
  pendingDeletions: Record<string, number>;
}

/** Tipo do tombstone → chave das contagens da coleção. */
const TOMBSTONE_TO_COUNT: Record<string, keyof CollectionCounts> = {
  deck: 'decks',
  notetype: 'noteTypes',
  note: 'notes',
  card: 'cards',
  revlog: 'revlog',
};

/**
 * O Drive tem MAIS itens do que este aparelho (e a diferença não é
 * explicada pelas deleções locais pendentes)?
 *
 * Um item deletado aqui ainda existe no Drive até a deleção subir — então
 * ele NÃO conta como "faltando" (evita o falso positivo que faria o
 * aparelho baixar 72,9 MB à toa depois de cada exclusão).
 */
export function isMissingRemoteItems(
  remoteCounts: CollectionCounts | undefined,
  localCounts: CollectionCounts,
  pendingDeletions: Record<string, number>
): boolean {
  if (!remoteCounts) return false;
  for (const chave of Object.keys(localCounts) as Array<keyof CollectionCounts>) {
    const totalRemoto = remoteCounts[chave];
    if (typeof totalRemoto !== 'number') continue;
    const tipo = Object.keys(TOMBSTONE_TO_COUNT).find((t) => TOMBSTONE_TO_COUNT[t] === chave);
    const pendentes = tipo ? (pendingDeletions[tipo] ?? 0) : 0;
    if (totalRemoto > localCounts[chave] + pendentes) return true;
  }
  return false;
}

/**
 * O aparelho está com o conteúdo atrás do Drive?
 *
 * Ver a documentação do topo do arquivo para o papel de cada sinal.
 *
 * Resumo:
 * - com a base CONHECIDA e igual à do Drive → não está atrás (o delta e o
 *   `lastSyncedUsn` dão conta do resto);
 * - com a base do Drive mais nova → está atrás (tem que buscar a base);
 * - sem saber qual base tem (app recém-atualizado, ou aparelho que ficou
 *   para trás) → as contagens do STATE (e, sem elas, o USN do conteúdo)
 *   dizem se falta conteúdo aqui.
 */
export function isBehindRemote(input: BehindInput): boolean {
  const { remoteHeadUsn, remoteBaseUsn, remoteCounts, localBaseUsn } = input;
  if (remoteHeadUsn <= 0) return false;

  // 1) a base do Drive é mais nova que a nossa → estamos atrás
  if (localBaseUsn > 0 && remoteBaseUsn && remoteBaseUsn > localBaseUsn) return true;

  // 2) base conhecida e igual à do Drive → o delta relativo a ela + o
  //    `lastSyncedUsn` (o head que já aplicamos) dão conta do resto.
  //    Sem baixar nada.
  if (localBaseUsn > 0) return false;

  // 3) NÃO sabemos qual base temos → sinal de recuperação: as contagens do
  //    STATE dizem que falta conteúdo aqui?
  if (
    remoteCounts &&
    isMissingRemoteItems(remoteCounts, input.localCounts, input.pendingDeletions)
  ) {
    return true;
  }

  // 4) sem contagens (STATE antigo): decide pelo USN do CONTEÚDUTO
  if (!remoteCounts) {
    return input.localContentMaxUsn < remoteHeadUsn;
  }
  return false;
}
