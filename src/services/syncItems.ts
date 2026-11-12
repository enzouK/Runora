/**
 * syncItems — sync item a item (estilo Anki).
 *
 * Para saber quem mudou o quê, cada item da coleção (deck, tipo de nota,
 * nota, card, preset e as configurações do usuário) ganha uma IDENTIDADE
 * portátil e um HASH do seu conteúdo:
 *
 *   deck:<nome>            notetype:<nome>     note:<guid>
 *   card:<guid>:<ord>      preset:<nome>       settings:prefs|theme
 *
 * A identidade usa o que sobrevive entre dispositivos (nome do deck/tipo,
 * GUID da nota, nome+ordem do card) — os ids internos não são usados.
 *
 * O COMPARADOR usa a "base" (o estado comum do último sync) para decidir,
 * item a item:
 *   - mudou só aqui      → fica a versão daqui (sobe ao Drive)
 *   - mudou só no Drive  → aplica a versão do Drive aqui
 *   - mudou nos dois     → DISPUTA: o usuário escolhe (uma única pergunta)
 *   - sumiu de um lado    → o item foi deletado nesse lado
 */
import type {
  Card,
  Deck,
  Note,
  NoteType,
  Preset,
} from '../types/runora';
import { StorageService } from './storage';

export type SyncItemKind = 'deck' | 'noteType' | 'note' | 'card' | 'preset' | 'settings';

export interface SyncItemState {
  hash: string;
  ts: number;
  /** Nome curto do item (para mostrar na lista de disputa). */
  label: string;
}

export interface SyncSnapshot {
  deviceId: string;
  deviceName: string;
  updatedAt: number;
  items: Record<string, SyncItemState>;
}

export interface SyncItemInfo {
  key: string;
  kind: SyncItemKind;
  /** Texto curto para mostrar na lista de disputa. */
  label: string;
}

export interface SyncDiff {
  /** Mudou só no Drive → aplicar aqui. */
  remoteOnly: SyncItemInfo[];
  /** Mudou só aqui → manter e subir ao Drive. */
  localOnly: SyncItemInfo[];
  /** Mudou nos dois lados → o usuário decide. */
  conflicts: SyncItemInfo[];
  /** Existia na base e sumiu do Drive → apagar aqui. */
  remoteDeleted: SyncItemInfo[];
  /** Existia na base e sumiu daqui → apagar no Drive. */
  localDeleted: SyncItemInfo[];
}

/** Conteúdo (de um lado) que entra no cálculo do snapshot. */
export interface SyncContent {
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  presets: Preset[];
  /** cardId → GUID da nota dona do card (os ids de card não são portáveis). */
  cardNoteGuid: Record<string, string>;
  settings: {
    prefs?: unknown;
    theme?: string;
    colorTheme?: string;
  };
}

/* ── hashing ─────────────────────────────────────────────────────────────── */

/** JSON canônico (chaves ordenadas) — o hash não depende da ordem. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** FNV-1a 32-bit — hash pequeno e estável. */
export function hashValue(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/* ── chaves ──────────────────────────────────────────────────────────────── */

export const deckKey = (name: string) => `deck:${name.trim()}`;
export const noteTypeKey = (name: string) => `notetype:${name.trim()}`;
export const noteKey = (guid: string) => `note:${guid}`;
export const cardKey = (guid: string, ord: number) => `card:${guid}:${ord}`;
export const presetKey = (name: string) => `preset:${name.trim()}`;
export const SETTINGS_KEYS = {
  prefs: 'settings:prefs',
  theme: 'settings:theme',
} as const;

/* ── snapshot ────────────────────────────────────────────────────────────── */

/**
 * Calcula o snapshot (hash de cada item) de um conteúdo — o mesmo cálculo
 * roda nos dois lados, então os hashes são comparáveis.
 */
export function computeSnapshot(
  content: SyncContent,
  deviceId: string,
  deviceName: string
): SyncSnapshot {
  const items: Record<string, SyncItemState> = {};
  const now = Date.now();

  const put = (key: string, kind: SyncItemKind, label: string, payload: unknown) => {
    items[key] = { hash: hashValue(payload), ts: now, label };
  };

  const deckNameById = new Map(content.decks.map((d) => [d.id, d.name]));
  const typeNameById = new Map(content.noteTypes.map((t) => [t.id, t.name]));
  // o preset é ligado pelo NOME (o id interno muda de dispositivo para dispositivo)
  const presetNameById = new Map(content.presets.map((p) => [p.id, p.name]));

  for (const deck of content.decks) {
    put(deckKey(deck.name), 'deck', deck.name, {
      name: deck.name,
      description: deck.description,
      preset: deck.presetId ? (presetNameById.get(deck.presetId) ?? '') : '',
      dailyLimits: deck.dailyLimits,
      dailyLimitsOverride: deck.dailyLimitsOverride,
      fsrsParams: deck.fsrsParams,
      fsrsOverride: deck.fsrsOverride,
      schedulerConfig: deck.schedulerConfig,
      displayOrder: deck.displayOrder,
      audioConfig: deck.audioConfig,
    });
  }

  for (const nt of content.noteTypes) {
    put(noteTypeKey(nt.name), 'noteType', nt.name, {
      name: nt.name,
      isCloze: nt.isCloze,
      css: nt.css,
      fields: nt.fields.map((f) => ({ name: f.name, ord: f.ord })),
      templates: nt.templates.map((t) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt })),
    });
  }

  const noteLabelByGuid = new Map<string, string>();
  for (const note of content.notes) {
    const guid = note.guid?.trim();
    if (!guid) continue;
    noteLabelByGuid.set(guid, noteLabel(note));
  }

  for (const note of content.notes) {
    const guid = note.guid?.trim();
    if (!guid) continue; // nota sem GUID não é sincronizável por identidade
    put(noteKey(guid), 'note', noteLabelByGuid.get(guid) ?? 'Nota', {
      fields: note.fields,
      tags: [...(note.tags || [])].sort(),
      deck: deckNameById.get(note.deckId) ?? '',
      type: typeNameById.get(note.noteTypeId) ?? '',
      // só o nome do arquivo (o conteúdo da mídia vai no pacote)
      media: (note.media ?? []).map((m) => m.name).sort(),
    });
  }

  for (const card of content.cards) {
    const guid = content.cardNoteGuid[card.id];
    if (!guid) continue;
    const owner = noteLabelByGuid.get(guid) ?? 'Nota';
    put(cardKey(guid, card.templateOrd), 'card', `Card ${card.templateOrd + 1} — ${owner}`, {
      fsrs: card.fsrs,
      due: card.due,
      suspended: card.suspended,
      position: card.position,
      learningStep: card.learningStep,
    });
  }

  for (const preset of content.presets) {
    put(presetKey(preset.name), 'preset', preset.name, {
      name: preset.name,
      dailyLimits: preset.dailyLimits,
      schedulerConfig: preset.schedulerConfig,
      displayOrder: preset.displayOrder,
      audioConfig: preset.audioConfig,
      fsrsParams: preset.fsrsParams,
    });
  }

  if (content.settings.prefs !== undefined) {
    put(SETTINGS_KEYS.prefs, 'settings', 'Preferências', content.settings.prefs);
  }
  if (content.settings.theme !== undefined || content.settings.colorTheme !== undefined) {
    put(SETTINGS_KEYS.theme, 'settings', 'Tema', {
      theme: content.settings.theme,
      colorTheme: content.settings.colorTheme,
    });
  }

  return { deviceId, deviceName, updatedAt: now, items };
}

/** Texto curto de uma nota (primeiro campo preenchido). */
export function noteLabel(note: Note): string {
  const first = Object.values(note.fields || {}).find(
    (v) => v && v.trim().length > 0
  );
  const text = (first ?? 'Nota sem título').replace(/<[^>]*>/g, '').trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** Conteúdo local (este dispositivo) pronto para o snapshot. */
export function localSyncContent(): SyncContent {
  const notes = StorageService.getNotes();
  const cardNoteGuid: Record<string, string> = {};
  for (const note of notes) {
    const guid = note.guid?.trim();
    if (!guid) continue;
    for (const card of StorageService.getCards()) {
      if (card.noteId === note.id) cardNoteGuid[card.id] = guid;
    }
  }
  return {
    decks: StorageService.getDecks(),
    noteTypes: StorageService.getNoteTypes(),
    notes,
    cards: StorageService.getCards(),
    presets: StorageService.getPresets(),
    cardNoteGuid,
    settings: {
      prefs: { rolloverHour: StorageService.getRolloverHour() },
      theme: StorageService.getTheme(),
      colorTheme: StorageService.getColorTheme(),
    },
  };
}

/**
 * Conteúdo de um PACOTE (o que veio do Drive) — mesmo formato do local,
 * para o hash de cada item ser comparável entre os dois lados.
 */
export function collectionSyncContent(data: {
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  presets?: Preset[];
  settings?: { prefs?: unknown; theme?: string; colorTheme?: string };
}): SyncContent {
  const cardNoteGuid: Record<string, string> = {};
  for (const note of data.notes) {
    const guid = note.guid?.trim();
    if (!guid) continue;
    for (const card of data.cards) {
      if (card.noteId === note.id) cardNoteGuid[card.id] = guid;
    }
  }
  return {
    decks: data.decks,
    noteTypes: data.noteTypes,
    notes: data.notes,
    cards: data.cards,
    presets: data.presets ?? [],
    cardNoteGuid,
    settings: {
      prefs: data.settings?.prefs,
      theme: data.settings?.theme,
      colorTheme: data.settings?.colorTheme,
    },
  };
}

/* ── comparação ─────────────────────────────────────────────────────────── */
/**
 * Compara base (último sync), local e remoto item a item.
 * É aqui que nasce a disputa: o mesmo item alterado nos dois lados.
 */
export function diffSnapshots(
  base: SyncSnapshot | null,
  local: SyncSnapshot,
  remote: SyncSnapshot
): SyncDiff {
  const diff: SyncDiff = {
    remoteOnly: [],
    localOnly: [],
    conflicts: [],
    remoteDeleted: [],
    localDeleted: [],
  };
  const baseItems = base?.items ?? {};
  const keys = new Set([
    ...Object.keys(baseItems),
    ...Object.keys(local.items),
    ...Object.keys(remote.items),
  ]);

  for (const key of keys) {
    const b = baseItems[key]?.hash;
    const l = local.items[key]?.hash;
    const r = remote.items[key]?.hash;
    if (l === r) continue; // iguais (ou os dois apagaram)

    const localChanged = l !== b;
    const remoteChanged = r !== b;
    const info = describeItem(key, local, remote);

    if (localChanged && remoteChanged) {
      diff.conflicts.push(info);
    } else if (remoteChanged) {
      if (r === undefined) diff.remoteDeleted.push(info);
      else diff.remoteOnly.push(info);
    } else if (localChanged) {
      if (l === undefined) diff.localDeleted.push(info);
      else diff.localOnly.push(info);
    }
  }
  return diff;
}

/** Nome curto do item em disputa (usa o lado local, ou o remoto). */
function describeItem(key: string, local: SyncSnapshot, remote: SyncSnapshot): SyncItemInfo {
  const kind = key.startsWith('deck:')
    ? 'deck'
    : key.startsWith('notetype:')
      ? 'noteType'
      : key.startsWith('note:')
        ? 'note'
        : key.startsWith('card:')
          ? 'card'
          : key.startsWith('preset:')
            ? 'preset'
            : 'settings';
  const raw = key.slice(key.indexOf(':') + 1);
  // o rótulo vem do snapshot (nome do deck/tipo, texto da nota, etc.)
  const name =
    local.items[key]?.label ?? remote.items[key]?.label ?? (kind === 'settings' ? raw : 'Item');
  const prefix =
    kind === 'note'
      ? 'Nota'
      : kind === 'card'
        ? 'Card'
        : kind === 'deck'
          ? 'Deck'
          : kind === 'noteType'
            ? 'Tipo de nota'
            : kind === 'preset'
              ? 'Preset'
              : '';
  const label = prefix ? `${prefix}: ${name}` : name;
  return { key, kind, label };
}

/** Base local (estado comum do último sync) — guardada no dispositivo. */
const LS_BASE = 'runora_sync_base';

/**
 * Chaves que existiam em versões antigas do protocolo e não existem mais.
 * A base salva no aparelho pode ter elas → precisam sair, senão o app
 * acharia que "faltou" o item e reenviaria a coleção a cada sync.
 */
const LEGACY_SETTING_KEYS = ['settings:fsrs'];

export function getSyncBase(): SyncSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_BASE);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as SyncSnapshot;
    if (!snapshot?.items) return snapshot;
    // limpa as chaves obsoletas (T10: o FSRS global saiu do protocolo)
    let changed = false;
    const items = { ...snapshot.items };
    for (const key of LEGACY_SETTING_KEYS) {
      if (key in items) {
        delete items[key];
        changed = true;
      }
    }
    if (!changed) return snapshot;
    const cleaned = { ...snapshot, items };
    localStorage.setItem(LS_BASE, JSON.stringify(cleaned));
    return cleaned;
  } catch {
    return null;
  }
}

export function setSyncBase(snapshot: SyncSnapshot): void {
  localStorage.setItem(LS_BASE, JSON.stringify(snapshot));
}
