/**
 * syncApply — aplica no dispositivo local os itens que vieram do Drive.
 *
 * Só os itens ESCOLHIDOS são tocados (os que mudaram só no Drive, ou os
 * que o usuário deixou vencerem o Drive na disputa). Tudo o mais fica
 * como está.
 *
 * O casamento entre os dois lados é pelo que sobrevive entre dispositivos:
 * nome do deck/tipo, GUID da nota e (GUID da nota + ordem do template)
 * para o card.
 */
import type {
  Card,
  Deck,
  FSRSParameters,
  Note,
  NoteType,
  Preset,
  RevlogEntry,
} from '../types/runora';
import { StorageService } from './storage';
import { refreshThemeInDom } from './syncExtras';
import {
  cardKey,
  deckKey,
  noteKey,
  noteTypeKey,
  presetKey,
  SETTINGS_KEYS,
  type SyncItemInfo,
} from './syncItems';

/** Conteúdo que veio do Drive (o pacote .colpkg já lido). */
export interface RemoteSyncData {
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  presets?: Preset[];
  revlog?: RevlogEntry[];
  /** Parâmetros FSRS globais do pacote (backups do Runora) — formato intocado,
   *  mas T10: o app não aplica mais esses valores (o global é config fixa). */
  fsrsParameters?: FSRSParameters;
  settings?: {
    prefs?: unknown;
    theme?: string;
    colorTheme?: string;
  };
}

export interface ApplyRemoteResult {
  notes: number;
  cards: number;
  decks: number;
  noteTypes: number;
  presets: number;
  settings: number;
  deleted: number;
}

/**
 * USN do item mesclado: o mais novo entre o local e o que veio do Drive.
 *
 * O USN é a "versão" do item e é COMPARTILHADO entre os aparelhos. Ao
 * aplicar o que veio do Drive, o item tem que ficar com o USN de lá (ou o
 * mais novo dos dois) — se ele ganhasse um USN novo aqui, o contador local
 * advanced a cada mesclagem e os outros aparelhos perdiam a base do delta,
 * sendo obrigados a baixar a coleção inteira de novo.
 */
function mergedUsn(local: number | undefined, remote: number | undefined): number | undefined {
  const maior = Math.max(local ?? 0, remote ?? 0);
  return maior > 0 ? maior : undefined;
}

/**
 * Aplica os itens remotos indicados.
 * `keys` = chaves a aplicar (inclui as disputas resolvidas a favor do Drive).
 */
export function applyRemoteItems(
  remote: RemoteSyncData,
  keys: Set<string>
): ApplyRemoteResult {
  const result: ApplyRemoteResult = {
    notes: 0,
    cards: 0,
    decks: 0,
    noteTypes: 0,
    presets: 0,
    settings: 0,
    deleted: 0,
  };

  // ── índices do lado remoto ──
  const remoteNoteByGuid = new Map<string, Note>();
  const remoteGuidByNoteId = new Map<string, string>();
  for (const n of remote.notes) {
    const guid = n.guid?.trim();
    if (!guid) continue;
    remoteNoteByGuid.set(guid, n);
    remoteGuidByNoteId.set(n.id, guid);
  }
  const remoteCardByKey = new Map<string, Card>();
  for (const c of remote.cards) {
    const guid = remoteGuidByNoteId.get(c.noteId);
    if (!guid) continue;
    remoteCardByKey.set(cardKey(guid, c.templateOrd), c);
  }
  const remoteDeckByName = new Map(remote.decks.map((d) => [d.name.trim(), d]));
  const remoteTypeByName = new Map(remote.noteTypes.map((t) => [t.name.trim(), t]));
  const remotePresetByName = new Map((remote.presets ?? []).map((p) => [p.name.trim(), p]));

  // ── índices do lado local ──
  const localNotes = StorageService.getNotes();
  const localCards = StorageService.getCards();
  const localDecks = StorageService.getDecks();
  const localTypes = StorageService.getNoteTypes();
  const localPresets = StorageService.getPresets();

  const localNoteByGuid = new Map<string, Note>();
  const localGuidByNoteId = new Map<string, string>();
  for (const n of localNotes) {
    const guid = n.guid?.trim();
    if (!guid) continue;
    localNoteByGuid.set(guid, n);
    localGuidByNoteId.set(n.id, guid);
  }
  const localCardByKey = new Map<string, Card>();
  for (const c of localCards) {
    const guid = localGuidByNoteId.get(c.noteId);
    if (!guid) continue;
    localCardByKey.set(cardKey(guid, c.templateOrd), c);
  }
  const localDeckByName = new Map(localDecks.map((d) => [d.name.trim(), d]));
  const localTypeByName = new Map(localTypes.map((t) => [t.name.trim(), t]));
  const localPresetByName = new Map(localPresets.map((p) => [p.name.trim(), p]));

  const now = Date.now();
  const notesToSave: Note[] = [];
  const cardsToSave: Card[] = [];
  const decksToSave: Deck[] = [];
  const typesToSave: NoteType[] = [];
  const presetsToSave: Preset[] = [];

  const putDeck = (remoteDeck: Deck): Deck => {
    const existing = localDeckByName.get(remoteDeck.name.trim());
    if (existing) {
      // preset do outro lado: casamos pelo NOME do preset
      const presetName = remoteDeck.presetId
        ? (remote.presets ?? []).find((p) => p.id === remoteDeck.presetId)?.name
        : undefined;
      const localPreset = presetName ? localPresetByName.get(presetName.trim()) : undefined;
      const merged: Deck = {
        ...existing,
        description: remoteDeck.description ?? existing.description,
        presetId: localPreset?.id ?? existing.presetId,
        dailyLimitsOverride: remoteDeck.dailyLimitsOverride ?? existing.dailyLimitsOverride,
        fsrsOverride: remoteDeck.fsrsOverride ?? existing.fsrsOverride,
        fsrsParams: remoteDeck.fsrsParams ?? existing.fsrsParams,
        usn: mergedUsn(existing.usn, remoteDeck.usn),
        updatedAt: now,
      };
      const idx = decksToSave.findIndex((d) => d.id === merged.id);
      if (idx >= 0) decksToSave[idx] = merged;
      else decksToSave.push(merged);
      localDeckByName.set(merged.name.trim(), merged);
      return merged;
    }
    // deck novo: entra com o id remoto (se estiver livre) ou um id novo
    const id = StorageService.getDecks().some((d) => d.id === remoteDeck.id)
      ? `deck-sync-${remoteDeck.id}-${now.toString(36)}`
      : remoteDeck.id;
    const created: Deck = { ...remoteDeck, id, createdAt: remoteDeck.createdAt || now, updatedAt: now };
    decksToSave.push(created);
    localDeckByName.set(created.name.trim(), created);
    return created;
  };

  const putType = (remoteType: NoteType): NoteType => {
    const existing = localTypeByName.get(remoteType.name.trim());
    if (existing) {
      const merged: NoteType = {
        ...existing,
        isCloze: remoteType.isCloze,
        css: remoteType.css,
        fields: remoteType.fields,
        templates: remoteType.templates,
        usn: mergedUsn(existing.usn, remoteType.usn),
        updatedAt: now,
      };
      const idx = typesToSave.findIndex((t) => t.id === merged.id);
      if (idx >= 0) typesToSave[idx] = merged;
      else typesToSave.push(merged);
      localTypeByName.set(merged.name.trim(), merged);
      return merged;
    }
    const id = StorageService.getNoteTypes().some((t) => t.id === remoteType.id)
      ? `nt-sync-${remoteType.id}-${now.toString(36)}`
      : remoteType.id;
    const created: NoteType = {
      ...remoteType,
      id,
      createdAt: remoteType.createdAt || now,
      updatedAt: now,
    };
    typesToSave.push(created);
    localTypeByName.set(created.name.trim(), created);
    return created;
  };

  const putPreset = (remotePreset: Preset): void => {
    const existing = localPresetByName.get(remotePreset.name.trim());
    if (existing) {
      const merged: Preset = {
        ...existing,
        dailyLimits: remotePreset.dailyLimits,
        schedulerConfig: remotePreset.schedulerConfig,
        displayOrder: remotePreset.displayOrder,
        audioConfig: remotePreset.audioConfig,
        fsrsParams: remotePreset.fsrsParams,
        usn: mergedUsn(existing.usn, remotePreset.usn),
        updatedAt: now,
      };
      const idx = presetsToSave.findIndex((p) => p.id === merged.id);
      if (idx >= 0) presetsToSave[idx] = merged;
      else presetsToSave.push(merged);
      localPresetByName.set(merged.name.trim(), merged);
      return;
    }
    const id = StorageService.getPresets().some((p) => p.id === remotePreset.id)
      ? `preset-sync-${remotePreset.id}-${now.toString(36)}`
      : remotePreset.id;
    const created: Preset = {
      ...remotePreset,
      id,
      createdAt: remotePreset.createdAt || now,
      updatedAt: now,
    };
    presetsToSave.push(created);
    localPresetByName.set(created.name.trim(), created);
  };

  /** Deck e tipo de uma nota remota, garantidos localmente. */
  const resolveNoteRefs = (remoteNote: Note): { deckId: string; noteTypeId: string } => {
    const remoteDeck = remote.decks.find((d) => d.id === remoteNote.deckId);
    const deck = remoteDeck ? putDeck(remoteDeck) : null;
    const remoteType = remote.noteTypes.find((t) => t.id === remoteNote.noteTypeId);
    const type = remoteType ? putType(remoteType) : null;
    const localDeck = deck ?? localDecks.find((d) => d.id === remoteNote.deckId);
    const localType = type ?? localTypes.find((t) => t.id === remoteNote.noteTypeId);
    return {
      deckId: localDeck?.id ?? remoteNote.deckId,
      noteTypeId: localType?.id ?? remoteNote.noteTypeId,
    };
  };

  // ── Notas ──
  for (const key of keys) {
    if (!key.startsWith('note:')) continue;
    const guid = key.slice('note:'.length);
    const remoteNote = remoteNoteByGuid.get(guid);
    const localNote = localNoteByGuid.get(guid);
    if (!remoteNote) {
      // deletada no Drive → apaga aqui
      if (localNote) {
        StorageService.deleteNote(localNote.id);
        localNoteByGuid.delete(guid);
        result.deleted++;
      }
      continue;
    }
    const refs = resolveNoteRefs(remoteNote);
    if (localNote) {
      const merged: Note = {
        ...localNote,
        deckId: refs.deckId,
        noteTypeId: refs.noteTypeId,
        fields: { ...remoteNote.fields },
        media: remoteNote.media?.length ? remoteNote.media : localNote.media,
        tags: remoteNote.tags,
        usn: mergedUsn(localNote.usn, remoteNote.usn),
        updatedAt: now,
      };
      const idx = notesToSave.findIndex((n) => n.id === merged.id);
      if (idx >= 0) notesToSave[idx] = merged;
      else notesToSave.push(merged);
      result.notes++;
    } else {
      // nota nova do outro lado
      const taken = new Set(StorageService.getNotes().map((n) => n.id));
      const id = taken.has(remoteNote.id)
        ? `note-sync-${guid.slice(0, 12)}-${now.toString(36)}`
        : remoteNote.id;
      const created: Note = {
        ...remoteNote,
        id,
        deckId: refs.deckId,
        noteTypeId: refs.noteTypeId,
        createdAt: remoteNote.createdAt || now,
        updatedAt: now,
      };
      notesToSave.push(created);
      localNoteByGuid.set(guid, created);
      result.notes++;
    }
  }

  // ── Cards (FSRS / agendamento) ──
  for (const key of keys) {
    if (!key.startsWith('card:')) continue;
    const remoteCard = remoteCardByKey.get(key);
    if (!remoteCard) continue; // card deletado junto com a nota — nada a fazer
    // o GUID pode conter ':' — a ordem do card é o ÚLTIMO trecho da chave
    const raw = key.slice('card:'.length);
    const sep = raw.lastIndexOf(':');
    const guid = sep >= 0 ? raw.slice(0, sep) : raw;
    const localNote = localNoteByGuid.get(guid);
    if (!localNote) continue; // nota ainda não existe aqui (vem depois)
    const localCard = localCardByKey.get(key);
    if (localCard) {
      const merged: Card = {
        ...localCard,
        due: remoteCard.due,
        fsrs: remoteCard.fsrs,
        suspended: remoteCard.suspended,
        position: remoteCard.position,
        learningStep: remoteCard.learningStep,
        usn: mergedUsn(localCard.usn, remoteCard.usn),
        updatedAt: now,
      };
      const idx = cardsToSave.findIndex((c) => c.id === merged.id);
      if (idx >= 0) cardsToSave[idx] = merged;
      else cardsToSave.push(merged);
      result.cards++;
    } else {
      const taken = new Set(StorageService.getCards().map((c) => c.id));
      const id = taken.has(remoteCard.id)
        ? `card-sync-${guid.slice(0, 12)}-${remoteCard.templateOrd}-${now.toString(36)}`
        : remoteCard.id;
      const created: Card = {
        ...remoteCard,
        id,
        noteId: localNote.id,
        deckId: localNote.deckId,
        createdAt: remoteCard.createdAt || now,
        updatedAt: now,
      };
      cardsToSave.push(created);
      result.cards++;
    }
  }

  // ── Decks, tipos, presets ──
  const decksToDelete: string[] = [];
  const typesToDelete: string[] = [];
  const presetsToDelete: string[] = [];
  for (const key of keys) {
    if (key.startsWith('deck:')) {
      const name = key.slice('deck:'.length);
      const remoteDeck = remoteDeckByName.get(name);
      if (remoteDeck) {
        putDeck(remoteDeck);
        result.decks++;
      } else {
        // deletado no Drive: some com o deck aqui (só se não sobrar nota)
        const localDeck = localDeckByName.get(name);
        if (localDeck) decksToDelete.push(localDeck.id);
      }
    } else if (key.startsWith('notetype:')) {
      const name = key.slice('notetype:'.length);
      const remoteType = remoteTypeByName.get(name);
      if (remoteType) {
        putType(remoteType);
        result.noteTypes++;
      } else {
        const localType = localTypeByName.get(name);
        if (localType) typesToDelete.push(localType.id);
      }
    } else if (key.startsWith('preset:')) {
      const name = key.slice('preset:'.length);
      const remotePreset = remotePresetByName.get(name);
      if (remotePreset) {
        putPreset(remotePreset);
        result.presets++;
      } else {
        const localPreset = localPresetByName.get(name);
        if (localPreset) presetsToDelete.push(localPreset.id);
      }
    }
  }

  // ── Grava ──
  // Tudo aqui veio do Drive: o USN é o DE LÁ. Renumerar aqui faria o
  // contador local subir a cada mesclagem (e os outros aparelhos perderiam
  // a base do delta) — por isso o `withoutUsnBump`.
  StorageService.withoutUsnBump(() => {
    if (decksToSave.length > 0) {
      const current = StorageService.getDecks();
      const byId = new Map(current.map((d) => [d.id, d]));
      for (const d of decksToSave) byId.set(d.id, d);
      StorageService.saveDecks([...byId.values()]);
    }
    if (typesToSave.length > 0) {
      const current = StorageService.getNoteTypes();
      const byId = new Map(current.map((t) => [t.id, t]));
      for (const t of typesToSave) byId.set(t.id, t);
      StorageService.saveNoteTypes([...byId.values()]);
    }
    if (presetsToSave.length > 0) {
      const current = StorageService.getPresets();
      const byName = new Map(current.map((p) => [p.name.trim(), p]));
      for (const p of presetsToSave) byName.set(p.name.trim(), p);
      StorageService.savePresets([...byName.values()]);
    }
    if (notesToSave.length > 0) {
      const current = StorageService.getNotes();
      const byId = new Map(current.map((n) => [n.id, n]));
      for (const n of notesToSave) byId.set(n.id, n);
      StorageService.saveNotes([...byId.values()]);
    }
    if (cardsToSave.length > 0) {
      const current = StorageService.getCards();
      const byId = new Map(current.map((c) => [c.id, c]));
      for (const c of cardsToSave) byId.set(c.id, c);
      StorageService.saveCards([...byId.values()]);
    }
  });

  // ── Exclusões (o item sumiu do Drive) ──
  if (decksToDelete.length > 0) {
    const notes = StorageService.getNotes();
    const cards = StorageService.getCards();
    // deck só sai se não sobrou nota dentro dele
    const safe = decksToDelete.filter((id) => !notes.some((n) => n.deckId === id));
    for (const id of safe) {
      StorageService.deleteDeck(id);
      result.deleted++;
    }
    // cards órfãos de deck que ficou (nota removida, deck mantido)
    const aliveDecks = new Set(StorageService.getDecks().map((d) => d.id));
    const orphanCards = cards.filter((c) => !aliveDecks.has(c.deckId));
    if (orphanCards.length > 0) {
      const orphanIds = new Set(orphanCards.map((c) => c.id));
      StorageService.saveCards(cards.filter((c) => !orphanIds.has(c.id)));
      result.deleted += orphanCards.length;
    }
  }
  if (typesToDelete.length > 0) {
    const current = StorageService.getNoteTypes();
    const keep = current.filter((t) => !typesToDelete.includes(t.id));
    if (keep.length !== current.length) {
      StorageService.saveNoteTypes(keep);
      result.deleted += current.length - keep.length;
    }
  }
  if (presetsToDelete.length > 0) {
    const current = StorageService.getPresets();
    const keep = current.filter((p) => !presetsToDelete.includes(p.id));
    if (keep.length !== current.length) {
      StorageService.savePresets(keep);
      result.deleted += current.length - keep.length;
    }
  }

  // ── Configurações globais ──
  // T10: o FSRS global NÃO é mais configuração do usuário — o app usa sempre
  // o valor fixo dele (saveFSRSSettings é inerte).
  const s = remote.settings;
  if (s?.prefs !== undefined && keys.has(SETTINGS_KEYS.prefs)) {
    const prefs = s.prefs as { rolloverHour?: number };
    if (typeof prefs.rolloverHour === 'number') StorageService.setRolloverHour(prefs.rolloverHour);
    result.settings++;
  }
  if (keys.has(SETTINGS_KEYS.theme)) {
    if (s?.theme) StorageService.setTheme(s.theme as 'light' | 'dark' | 'system');
    if (s?.colorTheme) StorageService.setColorTheme(s.colorTheme);
    refreshThemeInDom(); // o tema muda a tela na hora
    result.settings++;
  }

  return result;
}

/** Resumo curto para o usuário: quantos itens de cada tipo entraram. */
export function summarizeApply(r: ApplyRemoteResult): string {  const parts: string[] = [];
  if (r.notes > 0) parts.push(`${r.notes} ${r.notes === 1 ? 'nota' : 'notas'}`);
  if (r.cards > 0) parts.push(`${r.cards} cards`);
  if (r.decks > 0) parts.push(`${r.decks} ${r.decks === 1 ? 'deck' : 'decks'}`);
  if (r.noteTypes > 0) parts.push(`${r.noteTypes} ${r.noteTypes === 1 ? 'tipo de nota' : 'tipos de nota'}`);
  if (r.presets > 0) parts.push(`${r.presets} ${r.presets === 1 ? 'preset' : 'presets'}`);
  if (r.settings > 0) parts.push(`${r.settings} ${r.settings === 1 ? 'configuração' : 'configurações'}`);
  if (r.deleted > 0) parts.push(`${r.deleted} ${r.deleted === 1 ? 'removido' : 'removidos'}`);
  return parts.length > 0 ? parts.join(', ') : 'nada a atualizar';
}

/* ── aplicação progressiva (contador ao vivo, estilo import) ─────────────── */

export interface SyncApplyProgress {
  part: 'notes' | 'cards' | 'decks' | 'deletes' | 'settings';
  done: number;
  total: number;
}

/**
 * Aplica os itens remotos indicados em LOTES pequenos, com Yield ao
 * processador entre eles e o contador andando ao vivo (mesma mecânica da
 * importação, fase 3). Internamente reaproveita o applyRemoteItems —
 * chamado várias vezes com subconjuntos de chaves.
 */
export async function applyRemoteItemsProgressive(
  remote: RemoteSyncData,
  keys: Set<string>,
  onProgress?: (p: SyncApplyProgress) => void
): Promise<ApplyRemoteResult> {
  const result: ApplyRemoteResult = {
    notes: 0,
    cards: 0,
    decks: 0,
    noteTypes: 0,
    presets: 0,
    settings: 0,
    deleted: 0,
  };
  const add = (r: ApplyRemoteResult) => {
    result.notes += r.notes;
    result.cards += r.cards;
    result.decks += r.decks;
    result.noteTypes += r.noteTypes;
    result.presets += r.presets;
    result.settings += r.settings;
    result.deleted += r.deleted;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // 1) Decks, tipos, presets e configurações (poucos itens, uma passada)
  const otherKeys = [...keys].filter(
    (k) => !k.startsWith('note:') && !k.startsWith('card:')
  );
  if (otherKeys.length > 0) {
    onProgress?.({ part: 'decks', done: 0, total: 1 });
    add(applyRemoteItems(remote, new Set(otherKeys)));
    onProgress?.({ part: 'decks', done: 1, total: 1 });
    await tick();
  }

  // 2) Notas — em lotes (deletadas no Drive são contadas em 'deletes')
  const noteKeys = [...keys].filter((k) => k.startsWith('note:'));
  const CH = 15;
  for (let i = 0; i < noteKeys.length; i += CH) {
    onProgress?.({ part: 'notes', done: i, total: noteKeys.length });
    add(applyRemoteItems(remote, new Set(noteKeys.slice(i, i + CH))));
    onProgress?.({ part: 'notes', done: Math.min(i + CH, noteKeys.length), total: noteKeys.length });
    await tick();
  }

  // 3) Cards (agendamento/estado FSRS)
  const cardKeys = [...keys].filter((k) => k.startsWith('card:'));
  for (let i = 0; i < cardKeys.length; i += CH) {
    onProgress?.({ part: 'cards', done: i, total: cardKeys.length });
    add(applyRemoteItems(remote, new Set(cardKeys.slice(i, i + CH))));
    onProgress?.({ part: 'cards', done: Math.min(i + CH, cardKeys.length), total: cardKeys.length });
    await tick();
  }

  return result;
}

/**
 * Há revisão aqui que NÃO existe no Drive?
 *
 * A comparação é por IDENTIDADE (nota + ordem do template + horário), não
 * pelo `id`: o id do revlog é LOCAL de cada aparelho (a mesma revisão vira
 * `rev-sync-<cardId>-<horário>` em cada um) — comparar os ids dava sempre
 * "sim" e fazia o app reenviar a base inteira (72,9 MB) à toa, num
 * ida-e-volta infinito entre os aparelhos.
 */
export function hasRevlogOnlyLocal(
  localRevlog: RevlogEntry[],
  remoteRevlog: RevlogEntry[],
  localNotes: Note[],
  localCards: Card[],
  remoteNotes: Note[],
  remoteCards: Card[]
): boolean {
  const identityByCard = (
    notes: Note[],
    cards: Card[]
  ): Map<string, string> => {
    const guidByNoteId = new Map(notes.map((n) => [n.id, n.guid?.trim() ?? '']));
    const map = new Map<string, string>();
    for (const c of cards) {
      const guid = guidByNoteId.get(c.noteId) ?? '';
      map.set(c.id, `${guid}:${c.templateOrd}`);
    }
    return map;
  };

  const localIdentity = identityByCard(localNotes, localCards);
  const remoteIdentity = identityByCard(remoteNotes, remoteCards);

  const remoteByIdentity = new Set<string>();
  const remoteByTime = new Set<number>();
  for (const e of remoteRevlog) {
    remoteByTime.add(e.reviewTime);
    const ident = remoteIdentity.get(e.cardId);
    if (ident) remoteByIdentity.add(`${e.reviewTime}:${ident}`);
  }

  for (const e of localRevlog) {
    const ident = localIdentity.get(e.cardId);
    if (ident) {
      if (!remoteByIdentity.has(`${e.reviewTime}:${ident}`)) return true;
    } else if (!remoteByTime.has(e.reviewTime)) {
      // sem card local para comparar → compara só pelo horário
      return true;
    }
  }
  return false;
}

/**
 * Histórico de revisões que veio do Drive: as entradas são reescritas com
 * os ids LOCAIS do card (o id do card do outro dispositivo não vale aqui)
 * e as repetidas são ignoradas.
 */
export function mergeRemoteRevlog(
  remoteRevlog: RevlogEntry[],
  remote: RemoteSyncData
): number {
  if (remoteRevlog.length === 0) return 0;

  // cardId do outro lado → (guid da nota, ordem do template)
  const remoteIdentityByCardId = new Map<string, { guid: string; ord: number }>();
  for (const n of remote.notes) {
    const guid = n.guid?.trim();
    if (!guid) continue;
    for (const c of remote.cards) {
      if (c.noteId === n.id) remoteIdentityByCardId.set(c.id, { guid, ord: c.templateOrd });
    }
  }

  // (guid, ordem) → card local
  const localCardByIdentity = new Map<string, { id: string; noteId: string }>();
  const localNotes = StorageService.getNotes();
  const localGuidByNoteId = new Map<string, string>();
  for (const n of localNotes) {
    const guid = n.guid?.trim();
    if (guid) localGuidByNoteId.set(n.id, guid);
  }
  for (const c of StorageService.getCards()) {
    const guid = localGuidByNoteId.get(c.noteId);
    if (!guid) continue;
    localCardByIdentity.set(`${guid}:${c.templateOrd}`, { id: c.id, noteId: c.noteId });
  }

  const localRevlog = StorageService.getRevlog();
  const seen = new Set(localRevlog.map((e) => `${e.reviewTime}:${e.cardId}`));
  const fresh: RevlogEntry[] = [];
  for (const entry of remoteRevlog) {
    const ident = remoteIdentityByCardId.get(entry.cardId);
    if (!ident) continue; // revisão de um card que não existe aqui
    const localCard = localCardByIdentity.get(`${ident.guid}:${ident.ord}`);
    if (!localCard) continue;
    const mapped: RevlogEntry = {
      ...entry,
      id: `rev-sync-${localCard.id}-${entry.reviewTime}`,
      cardId: localCard.id,
      noteId: localCard.noteId,
    };
    const key = `${mapped.reviewTime}:${mapped.cardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(mapped);
  }
  if (fresh.length > 0) StorageService.saveRevlogAll([...localRevlog, ...fresh]);
  return fresh.length;
}
