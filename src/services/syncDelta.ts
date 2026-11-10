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
  };
}

/**
 * Verifica se um delta é válido e compatível.
 */
export function isValidDelta(delta: unknown): delta is SyncDelta {
  if (!delta || typeof delta !== 'object') return false;
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