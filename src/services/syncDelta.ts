/**
 * Fase 7 — Sync incremental (estilo Anki).
 *
 * Formato de delta para o Google Drive (substitui o .colpkg completo).
 * Em vez de subir/baixar a coleção inteira, enviamos apenas o que mudou
 * desde o último USN sincronizado.
 */

import type { Deck, NoteType, Note, Card, RevlogEntry, Preset, Tombstone } from '../types/runora';

/** Versão do formato de delta. */
export const DELTA_FORMAT_VERSION = 1;

/** Payload de um delta de sync (o que mudou desde lastSyncedUsn). */
export interface SyncDelta {
  /** Versão do formato. */
  version: number;
  /** USN do último sync bem-sucedido (base comum). */
  baseUsn: number;
  /** USN atual após este delta. */
  currentUsn: number;
  /** Timestamp da geração deste delta. */
  generatedAt: number;
  /** Device que gerou este delta. */
  deviceId: string;
  /** Nome do device. */
  deviceName: string;
  /** Entidades criadas/atualizadas desde baseUsn. */
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
  presets: Preset[];
  /** Tombstones (itens deletados) desde baseUsn. */
  tombstones: Tombstone[];
  /** Manifest de mídia: { filename: sha256 } — apenas mídia nova/modificada. */
  mediaManifest: Record<string, string>;
  /**
   * Mapa `id da nota` (no aparelho que gerou o delta) → GUID da nota.
   *
   * O id de uma nota é LOCAL de cada aparelho: dois aparelhos que importaram
   * o mesmo .apkg têm ids diferentes para a MESMA nota. Sem este mapa, o
   * outro aparelho não consegue casar o card com a nota certa (e pode criar
   * uma nota duplicada).
   */
  noteGuids?: Record<string, string>;
}

/** Conflito detectado: mesma entidade (GUID) com USN divergente nos dois lados. */
export interface SyncConflict {
  /** Tipo da entidade em conflito. */
  type: 'deck' | 'notetype' | 'note' | 'card' | 'preset';
  /** ID local da entidade. */
  localId: string;
  /** ID remoto da entidade (pode ser diferente se GUID casar mas IDs não). */
  remoteId: string;
  /** GUID da entidade (chave de identidade universal). */
  guid?: string;
  /** USN local. */
  localUsn: number;
  /** USN remoto. */
  remoteUsn: number;
  /** Dados locais (para apresentação ao usuário). */
  localData: unknown;
  /** Dados remotos (para apresentação ao usuário). */
  remoteData: unknown;
}

/** Resultado da detecção de conflitos entre delta local e remoto. */
export interface ConflictDetectionResult {
  /** Lista de conflitos detectados. */
  conflicts: SyncConflict[];
  /** true se há conflitos que precisam de resolução do usuário. */
  hasConflicts: boolean;
}

/**
 * Detecta conflitos entre entidades locais e remotas.
 * Conflito = mesma entidade (casada por GUID para notas, por ID para demais)
 * foi modificada nos dois lados desde o último sync comum (baseUsn).
 */
export function detectConflicts(
  baseUsn: number,
  local: { decks: Deck[]; noteTypes: NoteType[]; notes: Note[]; cards: Card[]; presets: Preset[] },
  remote: { decks: Deck[]; noteTypes: NoteType[]; notes: Note[]; cards: Card[]; presets: Preset[] }
): ConflictDetectionResult {
  const conflicts: SyncConflict[] = [];

  // Helper: compara duas listas de entidades por chave de identidade
  const compareLists = <T extends { id: string; usn?: number; guid?: string }>(
    type: SyncConflict['type'],
    localList: T[],
    remoteList: T[],
    getIdentity: (item: T) => string
  ) => {
    const localMap = new Map<string, T>();
    const remoteMap = new Map<string, T>();

    for (const item of localList) {
      if ((item.usn ?? 0) > baseUsn) localMap.set(getIdentity(item), item);
    }
    for (const item of remoteList) {
      if ((item.usn ?? 0) > baseUsn) remoteMap.set(getIdentity(item), item);
    }

    for (const [identity, localItem] of localMap) {
      const remoteItem = remoteMap.get(identity);
      if (remoteItem) {
        const localUsn = localItem.usn ?? 0;
        const remoteUsn = remoteItem.usn ?? 0;
        // Conflito se ambos mudaram desde baseUsn E os USNs divergem
        if (localUsn > baseUsn && remoteUsn > baseUsn && localUsn !== remoteUsn) {
          conflicts.push({
            type,
            localId: localItem.id,
            remoteId: remoteItem.id,
            guid: 'guid' in localItem ? localItem.guid : undefined,
            localUsn,
            remoteUsn,
            localData: localItem,
            remoteData: remoteItem,
          });
        }
      }
    }
  };

  // Decks: identidade = name (hierárquico)
  compareLists('deck', local.decks, remote.decks, (d) => d.name);

  // NoteTypes: identidade = name
  compareLists('notetype', local.noteTypes, remote.noteTypes, (nt) => nt.name);

  // Presets: identidade = name
  compareLists('preset', local.presets, remote.presets, (p) => p.name);

  // Notes: identidade = GUID (universal)
  compareLists('note', local.notes, remote.notes, (n) => n.guid ?? n.id);

  // Cards: identidade = noteId + templateOrd (único por nota)
  compareLists('card', local.cards, remote.cards, (c) => `${c.noteId}:${c.templateOrd}`);

  return { conflicts, hasConflicts: conflicts.length > 0 };
}

/** Metadado do delta no Drive (arquivo separado do payload). */
export interface DeltaMeta {
  app: 'runora';
  version: number;
  /** USN do último sync completo (base comum). */
  baseUsn: number;
  /** USN do último sync bem-sucedido (head). */
  headUsn: number;
  /** Timestamp do último sync. */
  syncedAt: number;
  /** Device que fez o último upload. */
  deviceId: string;
  /** Nome do device. */
  deviceName: string;
  /** Contagem de itens no delta atual. */
  counts: {
    decks: number;
    noteTypes: number;
    notes: number;
    cards: number;
    revlog: number;
    presets: number;
    tombstones: number;
    mediaFiles: number;
  };
}

/**
 * Estado unificado do sync incremental (Fase 8).
 * Substitui: delta-meta.json + delta.json + delta-media-manifest.json + partes incrementais do meta.json.
 * Mantém compatibilidade: pode ser lido como DeltaMeta (campos em comum).
 *
 * T6 (2026-11-12): fundiu também o META do backup completo neste arquivo
 * (version 2). O `runora-sync-meta.json` deixa de ser escrito; o que só
 * existia nele virou os campos `appVersion` e `collectionCounts` abaixo.
 * Leitores aceitam version 1 (campos novos ausentes → fallback) e 2.
 */
export interface SyncState {
  app: 'runora';
  version: number;           // 1 = formato original · 2 = META fundido (T6)
  /** USN do último sync completo (base comum). */
  baseUsn: number;
  /** USN do último sync incremental bem-sucedido (head). */
  headUsn: number;
  /** Timestamp do último sync incremental. */
  syncedAt: number;
  /** Device que fez o último upload incremental. */
  deviceId: string;
  /** Nome do device. */
  deviceName: string;
  /** Contagem de itens no delta atual. */
  counts: {
    decks: number;
    noteTypes: number;
    notes: number;
    cards: number;
    revlog: number;
    presets: number;
    tombstones: number;
    mediaFiles: number;
  };
  /** Delta payload inline (notas, decks, cards, etc. que mudaram). */
  delta: SyncDelta;
  /** Media manifest inline (hash → filename). */
  mediaManifest: Record<string, string>;
  /** Hash das preferências+temas (para pular download se não mudou). */
  extrasHash?: string;
  /** Hash das extensões (para pular download se não mudou). */
  addonsHash?: string;
  /** (v2) Versão do app que subiu este estado — era o META. */
  appVersion?: string;
  /** (v2) Contagens da COLEÇÃO INTEIRA — era o `counts` do META
   * (atenção: `counts` acima é do DELTA, não da coleção). */
  collectionCounts?: {
    decks: number;
    notes: number;
    cards: number;
    noteTypes: number;
    media: number;
    revlog: number;
  };
}

/** Versão do formato do estado unificado que este app ESCREVE. */
export const STATE_FORMAT_VERSION = 2;

/**
 * T6: monta um objeto com a mesma cara do SyncMeta (que era o
 * runora-sync-meta.json) a partir do STATE — para o resto do sync
 * (extras/addons, mescla completa, painel) continuar funcionando sem
 * reescrita geral. Campos que só existiam no META (v1 do STATE) recebem
 * fallback razoável.
 */
export function metaFromState(state: SyncState): {
  app: 'runora';
  version: 1;
  uploadedAt: number;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  counts: {
    decks: number;
    notes: number;
    cards: number;
    noteTypes: number;
    media: number;
    revlog: number;
  };
  extrasHash?: string;
  addonsHash?: string;
  syncFormat?: 'state';
} {
  const c = state.collectionCounts ?? {
    decks: state.counts.decks,
    notes: state.counts.notes,
    cards: state.counts.cards,
    noteTypes: state.counts.noteTypes,
    media: state.counts.mediaFiles,
    revlog: state.counts.revlog,
  };
  return {
    app: 'runora',
    version: 1,
    uploadedAt: state.syncedAt,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    appVersion: state.appVersion ?? '0.1.0',
    counts: c,
    extrasHash: state.extrasHash,
    addonsHash: state.addonsHash,
    syncFormat: 'state',
  };
}

/** Converte SyncState para DeltaMeta (compatibilidade com código antigo). */
export function syncStateToDeltaMeta(state: SyncState): DeltaMeta {
  return {
    app: state.app,
    version: state.version,
    baseUsn: state.baseUsn,
    headUsn: state.headUsn,
    syncedAt: state.syncedAt,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    counts: state.counts,
  };
}

/** Nomes dos arquivos no Drive para o sync incremental. */
export const DELTA_FILES = {
  /** Metadado do delta (pequeno, lido primeiro). */
  META: 'runora-sync-delta-meta.json',
  /** Payload do delta (pode ser grande, lido sob demanda). */
  PAYLOAD: 'runora-sync-delta.json',
  /** Manifest de mídia (SHA256 -> filename). */
  MEDIA_MANIFEST: 'runora-sync-media-manifest.json',
  /** Arquivos de mídia individuais (pasta). */
  MEDIA_FOLDER: 'runora-sync-media/',
} as const;

/**
 * Constrói um delta com as mudanças desde `baseUsn`.
 * Usado no upload incremental.
 */
export function buildDelta(
  baseUsn: number,
  currentUsn: number,
  deviceId: string,
  deviceName: string,
  data: {
    decks: Deck[];
    noteTypes: NoteType[];
    notes: Note[];
    cards: Card[];
    revlog: RevlogEntry[];
    presets: Preset[];
    tombstones: Tombstone[];
    mediaManifest: Record<string, string>;
    /** Mapa id-da-nota → GUID (identidade entre aparelhos). */
    noteGuids?: Record<string, string>;
  }
): SyncDelta {
  return {
    version: DELTA_FORMAT_VERSION,
    baseUsn,
    currentUsn,
    generatedAt: Date.now(),
    deviceId,
    deviceName,
    decks: data.decks,
    noteTypes: data.noteTypes,
    notes: data.notes,
    cards: data.cards,
    revlog: data.revlog,
    presets: data.presets,
    tombstones: data.tombstones,
    mediaManifest: data.mediaManifest,
    noteGuids: data.noteGuids,
  };
}

/**
 * Identidade universal de um item entre aparelhos.
 *
 * O `id` de um item é LOCAL (cada aparelho cria o seu): a nota se reconhece
 * pelo GUID, o card pelo (GUID da nota + ordem do template) e deck/tipo/
 * preset pelo NOME. Sem isso, um item que veio de outro aparelho entraria
 * DUPLICADO aqui.
 */
function identityOf(
  type: string,
  item: { id: string; guid?: string; name?: string; templateOrd?: number; noteId?: string },
  noteGuids: Record<string, string>
): string {
  switch (type) {
    case 'note':
      return `note:${item.guid ?? item.id}`;
    case 'card': {
      const guid = item.noteId ? noteGuids[item.noteId] : undefined;
      return `card:${guid ?? item.noteId ?? ''}:${item.templateOrd ?? item.id}`;
    }
    case 'deck':
      return `deck:${item.name ?? item.id}`;
    case 'notetype':
      return `notetype:${item.name ?? item.id}`;
    case 'preset':
      return `preset:${item.name ?? item.id}`;
    default:
      return `${type}:${item.id}`;
  }
}

/** Identidade universal de um tombstone (o `id` é local do aparelho que deletou). */
function tombIdentity(t: Tombstone): string {
  switch (t.type) {
    case 'note':
      return `note:${t.guid ?? t.id}`;
    case 'card':
      return `card:${t.guid ?? ''}:${t.templateOrd ?? t.id}`;
    case 'deck':
      return `deck:${t.name ?? t.id}`;
    case 'notetype':
      return `notetype:${t.name ?? t.id}`;
    case 'preset':
      return `preset:${t.name ?? t.id}`;
    default:
      return `${t.type}:${t.id}`;
  }
}

/**
 * Junta o delta que já está no Drive com as mudanças novas deste aparelho.
 *
 * O delta do Drive cobre (baseUsn → headUsn). Cada envio incremental
 * acrescenta só as mudanças deste aparelho — sem esta soma, o delta anterior
 * seria jogado fora e as mudanças antigas nunca chegariam aos outros
 * aparelhos (que só recebem o delta mais recente).
 *
 * A versão mais nova do mesmo item vence (o aparelho que acaba de mexer nele
 * tem a razão) e um item deletado sai do delta: o apply sobe o tombstone
 * antes do item, então manter os dois faria o item "ressuscitar".
 */
export function mergeDeltas(previous: SyncDelta | null, added: SyncDelta): SyncDelta {
  if (!previous) return added;

  const noteGuids: Record<string, string> = {
    ...(previous.noteGuids ?? {}),
    ...(added.noteGuids ?? {}),
  };

  const tombstones: Tombstone[] = [...previous.tombstones];
  const tombKeys = new Set(tombstones.map((t) => tombIdentity(t)));
  for (const t of added.tombstones) {
    const key = tombIdentity(t);
    if (!tombKeys.has(key)) {
      tombstones.push(t);
      tombKeys.add(key);
    }
  }

  const alive = <T extends { id: string }>(items: T[], type: string): T[] =>
    items.filter((i) => !tombKeys.has(identityOf(type, i, noteGuids)));

  const upsert = <T extends { id: string }>(list: T[], items: T[], type: string): T[] => {
    const out = [...list];
    for (const item of items) {
      const key = identityOf(type, item, noteGuids);
      const idx = out.findIndex((x) => identityOf(type, x, noteGuids) === key);
      if (idx >= 0) out[idx] = item;
      else out.push(item);
    }
    return out;
  };

  return {
    ...added,
    baseUsn: Math.min(previous.baseUsn, added.baseUsn),
    currentUsn: Math.max(previous.currentUsn, added.currentUsn),
    decks: alive(upsert(previous.decks, added.decks, 'deck'), 'deck'),
    noteTypes: alive(upsert(previous.noteTypes, added.noteTypes, 'notetype'), 'notetype'),
    notes: alive(upsert(previous.notes, added.notes, 'note'), 'note'),
    cards: alive(upsert(previous.cards, added.cards, 'card'), 'card'),
    revlog: alive(upsert(previous.revlog, added.revlog, 'revlog'), 'revlog'),
    presets: alive(upsert(previous.presets, added.presets, 'preset'), 'preset'),
    tombstones,
    mediaManifest: { ...previous.mediaManifest, ...added.mediaManifest },
    noteGuids,
  };
}

/**
 * Aplica o delta do Drive por cima da coleção que veio do .colpkg.
 *
 * O .colpkg é a base (o estado até o último sync completo) e o delta são as
 * mudanças depois disso — os dois juntos são a verdade do Drive.
 */
export function applyDeltaToCollection(
  collection: {
    decks: Deck[];
    noteTypes: NoteType[];
    notes: Note[];
    cards: Card[];
    presets?: Preset[];
    revlog?: RevlogEntry[];
  },
  delta: SyncDelta
): void {
  const noteGuids: Record<string, string> = delta.noteGuids ?? {};

  // O `.colpkg` e o delta podem ter vindo de aparelhos diferentes: a
  // identidade entre eles é o GUID (nota), (GUID + ordem) (card) e o NOME
  // (deck/tipo/preset) — o `id` é local de cada aparelho.
  const remove = <T extends { id: string; guid?: string; name?: string; templateOrd?: number; noteId?: string }>(
    list: T[] | undefined,
    type: string,
    tomb: Tombstone
  ) => {
    if (!list) return;
    // casar pela identidade universal (GUID/nome) E pelo id local (tombstone
    // antigo, sem a identidade universal)
    const idx = list.findIndex(
      (x) => identityOf(type, x, noteGuids) === tombIdentity(tomb) || x.id === tomb.id
    );
    if (idx >= 0) list.splice(idx, 1);
  };

  const upsert = <T extends { id: string; guid?: string; name?: string; templateOrd?: number; noteId?: string }>(
    list: T[] | undefined,
    items: T[],
    type: string
  ) => {
    if (!list) return;
    for (const item of items) {
      const key = identityOf(type, item, noteGuids);
      const idx = list.findIndex((x) => identityOf(type, x, noteGuids) === key);
      if (idx >= 0) list[idx] = item;
      else list.push(item);
    }
  };

  // 1. o que foi deletado some
  for (const t of delta.tombstones) {
    switch (t.type) {
      case 'deck':
        remove(collection.decks, 'deck', t);
        break;
      case 'notetype':
        remove(collection.noteTypes, 'notetype', t);
        break;
      case 'note': {
        remove(collection.notes, 'note', t);
        // os cards da nota deletada vão junto
        for (const card of [...collection.cards]) {
          const guid = noteGuids[card.noteId];
          const mesmaNota =
            card.noteId === t.id || (t.guid && guid && guid === t.guid);
          if (mesmaNota) {
            const idx = collection.cards.findIndex((c) => c.id === card.id);
            if (idx >= 0) collection.cards.splice(idx, 1);
          }
        }
        break;
      }
      case 'card':
        remove(collection.cards, 'card', t);
        break;
      case 'preset':
        remove(collection.presets, 'preset', t);
        break;
      case 'revlog':
        break;
    }
  }

  // 2. o que mudou entra
  upsert(collection.decks, delta.decks, 'deck');
  upsert(collection.noteTypes, delta.noteTypes, 'notetype');
  upsert(collection.notes, delta.notes, 'note');
  upsert(collection.cards, delta.cards, 'card');
  upsert(collection.presets, delta.presets, 'preset');
  upsert(collection.revlog, delta.revlog, 'revlog');
}

/**
 * Verifica se um delta é válido e compatível.
 */
export function isValidDelta(delta: unknown): delta is SyncDelta {  if (!delta || typeof delta !== 'object') return false;
  const d = delta as Record<string, unknown>;
  return (
    d.version === DELTA_FORMAT_VERSION &&
    typeof d.baseUsn === 'number' &&
    typeof d.currentUsn === 'number' &&
    typeof d.generatedAt === 'number' &&
    typeof d.deviceId === 'string' &&
    Array.isArray(d.decks) &&
    Array.isArray(d.noteTypes) &&
    Array.isArray(d.notes) &&
    Array.isArray(d.cards) &&
    Array.isArray(d.revlog) &&
    Array.isArray(d.presets) &&
    Array.isArray(d.tombstones) &&
    typeof d.mediaManifest === 'object'
  );
}

/**
 * Aplica um delta localmente (merge das entidades + tombstones).
 * Retorna o novo USN head.
 */
export function applyDelta(delta: SyncDelta, applyEntity: (entity: unknown, type: string) => void, applyTombstone: (t: Tombstone) => void): number {
  // 1. Aplica tombstones primeiro (deletados)
  for (const t of delta.tombstones) {
    applyTombstone(t);
  }
  // 2. Aplica entidades (cria/atualiza)
  for (const d of delta.decks) applyEntity(d, 'deck');
  for (const nt of delta.noteTypes) applyEntity(nt, 'notetype');
  for (const n of delta.notes) applyEntity(n, 'note');
  for (const c of delta.cards) applyEntity(c, 'card');
  for (const r of delta.revlog) applyEntity(r, 'revlog');
  for (const p of delta.presets) applyEntity(p, 'preset');
  return delta.currentUsn;
}