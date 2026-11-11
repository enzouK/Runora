/**
 * Detecção de "aparelho antigo" no Google Drive.
 *
 * Por que existe: o Runora passou por duas fases de formato de sync.
 *
 * - Fase antiga: o app sobe um backup completo (`.colpkg`) + um `meta.json`.
 * - Fase nova (Etapa 5+): o app sobe um estado unificado
 *   (`runora-sync-state.json`) e marca o `meta.json` com `syncFormat: 'state'`.
 *
 * O `meta.json` é reescrito em TODO sync (inclusive pelos apps antigos),
 * então ele é o marcador confiável de "o Drive mudou". E como só o app novo
 * escreve o marcador, a ausência dele significa: "o último backup do Drive
 * veio de um app que não conhece o estado unificado".
 *
 * Nesse caso o backup completo é a fonte da verdade: o delta incremental não
 * serve e a mescla precisa ser refeita por inteiro (e o usuário precisa ser
 * avisado para atualizar aquele aparelho).
 *
 * IMPORTANTE: a comparação NÃO pode ser feita pela data do `.colpkg` — o
 * próprio app novo escreve `.colpkg` quando faz um sync completo, e aí a
 * data seria sempre "mais nova" que o estado (falso positivo que travava o
 * sync). Por isso a detecção olha o CONTEÚDO do META, não as datas.
 */

/** Campos do META do Drive usados na detecção. */
export interface DriveMetaFormat {
  /** Id do aparelho que escreveu o META. */
  deviceId?: string;
  /** Marcador de formato — presente só em apps que conhecem o estado unificado. */
  syncFormat?: 'state';
}

/**
 * O META do Drive foi escrito por um app antigo?
 *
 * @param meta META do Drive (null quando não há backup nenhum)
 * @param currentDeviceId id do aparelho atual
 */
export function isOldFormatBackup(
  meta: DriveMetaFormat | null | undefined,
  currentDeviceId: string
): boolean {
  // Sem META não há backup para comparar.
  if (!meta) return false;
  // App atualizado: o marcador está presente → formato novo, tudo certo.
  if (meta.syncFormat === 'state') return false;
  // Foi este próprio aparelho que escreveu (build anterior à atualização):
  // não é "outro aparelho" — não precisa avisar ninguém.
  if (meta.deviceId && meta.deviceId === currentDeviceId) return false;
  // META sem marcador, vindo de outro aparelho → app antigo.
  return true;
}

/** Aviso mostrado ao usuário quando um app antigo escreveu no Drive. */
export const OLD_DEVICE_WARNING =
  'Outro aparelho (versão antiga) enviou um backup completo — ' +
  'atualize esse aparelho para evitar conflitos.';
