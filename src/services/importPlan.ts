/**
 * importPlan — plano de importação (fusão inteligente, estilo Anki).
 *
 * Toda importação (.apkg, .colpkg, .json) passa por duas etapas:
 *
 *   1. analyzeImport  → compara o conteúdo do pacote com a coleção local
 *      e monta um PLANO: "Vou criar X decks novos, Y notas novas e me
 *      deparar com Z notas que já existem". Nada é gravado ainda.
 *
 *   2. applyImportPlan → aplica o plano no modo escolhido pelo usuário:
 *      - 'overwrite' (Sobrescrever os antigos): o conteúdo chegado vence
 *        nos itens em comum; os itens que só existem aqui continuam.
 *        Quando as duas versões de um card têm progresso FSRS, fica a
 *        MAIS RECENTE (a que foi estudada por último).
 *      - 'keep' (Manter os que já estão): o que já existe aqui não é
 *        tocado; só os itens novos entram.
 *
 * Reconhecimento de "a mesma nota" (ver noteIdentity): primeiro pelo
 * GUID (herdado do Anki ou gerado no Runora), e, quando o outro lado
 * ainda não tem GUID, pela assinatura por conteúdo (tipo de nota + deck
 * + valores dos campos normalizados).
 *
 * Decks e tipos de nota são casados PELO NOME — os ids não sobrevivem
 * entre dispositivos (cada um gera os seus), mas os nomes sim.
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
import {
  computeNoteSignature,
  ensureNoteGuids,
  normalizeFieldValue,
} from './noteIdentity';

/** Dados já extraídos do pacote, prontos para análise/aplicação. */
export interface ImportableCollection {
  kind: 'runora' | 'anki';
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  presets?: Preset[];
  revlog?: RevlogEntry[];
  /** Parâmetros FSRS globais embutidos no pacote (só backups do Runora). */
  fsrsParameters?: FSRSParameters;
  /** Configurações globais do dispositivo que gerou o pacote. */
  settings?: {
    prefs?: unknown;
    theme?: string;
    colorTheme?: string;
  };
  /** Número de arquivos de mídia que o pacote carrega (informativo). */
  mediaCount?: number;
  /**
   * Zip de origem (quando há) — só quem leu o pacote o usa, para importar
   * a mídia na aplicação do plano. Tipado como unknown para o plano não
   * depender do jszip.
   */
  zip?: unknown;
}

export type ImportConflictMode = 'overwrite' | 'keep';

/**
 * Progresso da aplicação do plano, em partes: notas → cards → mídia.
 * Emitido em pedaços pequenos (lotear de poucos em poucos + soltar o
 * processador entre lotes) para a UI pintar o contador ao vivo e a tela
 * nunca parecer congelada.
 */
export interface ImportApplyProgress {
  part: 'notes' | 'cards' | 'media';
  done: number;
  total: number;
}

export interface ImportPlanSummary {
  /** Nomes dos decks que ainda não existem aqui. */
  newDeckNames: string[];
  existingDecksCount: number;
  /** Nomes dos tipos de nota que ainda não existem aqui. */
  newNoteTypeNames: string[];
  newNotesCount: number;
  existingNotesCount: number;
  /** Notas existentes cujo CONTEÚDO diverge do pacote (disputa de conteúdo). */
  conflictingNotesCount: number;
  newCardsCount: number;
  existingCardsCount: number;
  /**
   * Cards que já existem aqui mas cujo AGENDAMENTO (datas/estado FSRS) é
   * diferente no arquivo — é o que acontece quando o deck foi estudado em
   * outro dispositivo (ou ficou parado) e o arquivo traz as datas novas.
   */
  changedCardsCount: number;
  /**
   * Decks que já existem aqui mas cujas OPÇÕES (parâmetros FSRS do deck,
   * limites, preset) são diferentes no arquivo.
   */
  changedDecksCount: number;
  /**
   * Os parâmetros FSRS globais do arquivo são diferentes dos daqui.
   * T10: o global é configuração fixa do app → sempre `false` (a importação
   * nunca mexe no global; presets e decks do pacote continuam valendo).
   */
  globalFsrsChanged: boolean;
  /** Novas entradas de histórico de revisão (backups do Runora). */
  newRevlogCount: number;
  mediaCount?: number;
}

export interface ImportPlan {
  data: ImportableCollection;
  summary: ImportPlanSummary;
  /** Incoming deck id → id do deck local casado pelo nome (null = novo). */
  deckLinks: Map<string, string | null>;
  /** Incoming note-type id → id do tipo casado pelo nome (null = novo). */
  noteTypeLinks: Map<string, string | null>;
  /** Incoming note id → id da nota local reconhecida (apenas casadas). */
  noteLinks: Map<string, string>;
  /** Incoming `${noteId}::${templateOrd}` → id do card local correspondente. */
  cardLinks: Map<string, string>;
  /** Incoming preset id → id do preset local casado pelo nome. */
  presetLinks: Map<string, string>;
}

export interface ApplyImportResult {
  mode: ImportConflictMode;
  addedDecks: number;
  addedNoteTypes: number;
  addedNotes: number;
  updatedNotes: number;
  /** Notas já existentes que ficaram como estavam (modo 'keep'). */
  keptDuplicates: number;
  addedCards: number;
  updatedCards: number;
  addedRevlog: number;
  /** FSRS global foi substituído (só quando a coleção local estava vazia). */
  appliedGlobalFsrs: boolean;
  message: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Análise
// ────────────────────────────────────────────────────────────────────────────

/**
 * Monta o plano de importação comparando o pacote com a coleção local.
 * Não grava nada — é seguro chamar e descartar.
 */
export function analyzeImport(data: ImportableCollection): ImportPlan {
  // Backfill: notas do pacote sem GUID ganham um já aqui — a análise e a
  // aplicação trabalham sobre o mesmo objeto, então o GUID gerado na análise
  // é exatamente o que entra na coleção.
  data.notes = ensureNoteGuids(data.notes);

  const localDecks = StorageService.getDecks();
  const localNoteTypes = StorageService.getNoteTypes();
  const localNotes = StorageService.getNotes();
  const localCards = StorageService.getCards();
  const localRevlog = StorageService.getRevlog();

  // ── Decks casados por nome ──
  const deckIdByLocalName = new Map(localDecks.map((d) => [d.name.trim(), d.id]));
  const deckLinks = new Map<string, string | null>();
  const newDeckNames: string[] = [];
  let existingDecksCount = 0;
  const localDeckById = new Map(localDecks.map((d) => [d.id, d]));
  for (const deck of data.decks) {
    const matched = deckIdByLocalName.get(deck.name.trim()) ?? null;
    deckLinks.set(deck.id, matched);
    if (matched) existingDecksCount++;
    else newDeckNames.push(deck.name);
  }

  // ── Presets casados pelo nome (o id interno muda entre dispositivos) ──
  const localPresets = StorageService.getPresets();
  const localPresetByName = new Map(localPresets.map((p) => [p.name.trim(), p]));
  const presetLinks = new Map<string, string>();
  for (const preset of data.presets ?? []) {
    const matched = localPresetByName.get(preset.name.trim());
    presetLinks.set(preset.id, matched?.id ?? preset.id);
  }

  // ── Opções dos decks: mudam junto com o deck (inclusive os parâmetros FSRS
  //    do próprio deck) — isso precisa aparecer no plano, senão a importação
  //    pareceria "nada a fazer" quando o deck é o mesmo mas as opções não. ──
  const localPresetName = new Map(localPresets.map((p) => [p.id, p.name.trim()]));
  const incomingPresetName = new Map(
    (data.presets ?? []).map((p) => [p.id, p.name.trim()])
  );
  let changedDecksCount = 0;
  for (const deck of data.decks) {
    const localDeck = localDeckById.get(deckLinks.get(deck.id) ?? '');
    if (!localDeck) continue;
    if (deckOptionsDiffer(localDeck, deck, localPresetName, incomingPresetName)) changedDecksCount++;
  }

  // ── Parâmetros FSRS globais ──
  // T10: o global virou configuração fixa do app → a importação NUNCA o
  // altera. Os presets e decks do pacote continuam sendo aplicados normalmente.
  const globalFsrsChanged = false;

  // ── Tipos de nota casados por nome (+ cloze) ──
  const typeIdByLocalName = new Map(
    localNoteTypes.map((nt) => [noteTypeKey(nt.name.trim(), nt.isCloze), nt.id])
  );
  const noteTypeLinks = new Map<string, string | null>();
  const newNoteTypeNames: string[] = [];
  for (const nt of data.noteTypes) {
    const matched = typeIdByLocalName.get(noteTypeKey(nt.name.trim(), nt.isCloze)) ?? null;
    noteTypeLinks.set(nt.id, matched);
    if (!matched) newNoteTypeNames.push(nt.name);
  }

  // Assinatura de uma nota local depende do NOME do tipo de nota e do deck
  // — os nomes sobrevivem entre coleções, os ids não.
  const typeNameById = new Map(localNoteTypes.map((nt) => [nt.id, nt.name]));
  const deckNameById = new Map(localDecks.map((d) => [d.id, d.name]));

  // ── Notas casadas por GUID, depois por assinatura de conteúdo ──
  const localNoteIdByGuid = new Map<string, string>();
  const localNoteIdBySignature = new Map<string, string>();
  const localNotesById = new Map(localNotes.map((n) => [n.id, n]));
  for (const n of localNotes) {
    if (n.guid && n.guid.trim()) localNoteIdByGuid.set(n.guid.trim(), n.id);
    const sig = computeNoteSignature(n, typeNameById.get(n.noteTypeId) ?? '', deckNameById.get(n.deckId) ?? '');
    if (!localNoteIdBySignature.has(sig)) localNoteIdBySignature.set(sig, n.id);
  }

  const incomingTypeNameById = new Map(data.noteTypes.map((nt) => [nt.id, nt.name]));
  const incomingDeckNameById = new Map(data.decks.map((d) => [d.id, d.name]));

  const noteLinks = new Map<string, string>();
  let newNotesCount = 0;
  let existingNotesCount = 0;
  let conflictingNotesCount = 0;
  for (const note of data.notes) {
    const guid = note.guid?.trim();
    let matched: string | undefined;
    if (guid && localNoteIdByGuid.has(guid)) {
      matched = localNoteIdByGuid.get(guid);
    } else {
      matched = localNoteIdBySignature.get(
        computeNoteSignature(
          note,
          incomingTypeNameById.get(note.noteTypeId) ?? '',
          incomingDeckNameById.get(note.deckId) ?? ''
        )
      );
    }
    if (matched) {
      noteLinks.set(note.id, matched);
      existingNotesCount++;
      // Mesma nota (mesma identidade), outro conteúdo em um dos lados?
      // Aí há uma DISPUTA de conteúdo — as versões divergem.
      if (notesContentDiffer(localNotesById.get(matched)!, note)) {
        conflictingNotesCount++;
      }
    } else {
      newNotesCount++;
    }
  }

  // ── Cards: um card é novo se não tem par local (nota, template) ──
  const localCardKey = new Map<string, string>();
  for (const c of localCards) {
    const key = `${c.noteId}::${c.templateOrd}`;
    if (!localCardKey.has(key)) localCardKey.set(key, c.id);
  }
  const cardLinks = new Map<string, string>();
  let newCardsCount = 0;
  let existingCardsCount = 0;
  let changedCardsCount = 0;
  const localCardById = new Map(localCards.map((c) => [c.id, c]));
  for (const card of data.cards) {
    const matchedNote = noteLinks.get(card.noteId);
    if (!matchedNote) {
      newCardsCount++;
      continue;
    }
    const matchedCard = localCardKey.get(`${matchedNote}::${card.templateOrd}`);
    if (matchedCard) {
      cardLinks.set(`${card.noteId}::${card.templateOrd}`, matchedCard);
      existingCardsCount++;
      // O card já existe: o conteúdo é o mesmo, mas o AGENDAMENTO (datas,
      // estado FSRS) pode ser outro — é o caso de um deck estudado em outro
      // dispositivo. Isso precisa aparecer no plano, senão a importação
      // pareceria "nada a fazer".
      const local = localCardById.get(matchedCard);
      if (local && cardScheduleDiffers(local, card)) changedCardsCount++;
    } else {
      newCardsCount++;
    }
  }

  // ── Histórico de revisão: união sem duplicar ──
  const seenRevlog = new Set(localRevlog.map(revlogKey));
  let newRevlogCount = 0;
  for (const e of data.revlog ?? []) {
    if (!seenRevlog.has(revlogKey(e))) newRevlogCount++;
  }

  const summary: ImportPlanSummary = {
    newDeckNames,
    existingDecksCount,
    newNoteTypeNames,
    newNotesCount,
    existingNotesCount,
    conflictingNotesCount,
    newCardsCount,
    existingCardsCount,
    changedCardsCount,
    changedDecksCount,
    globalFsrsChanged,
    newRevlogCount,
    mediaCount: data.mediaCount,
  };

  return { data, summary, deckLinks, noteTypeLinks, noteLinks, cardLinks, presetLinks };
}

// ────────────────────────────────────────────────────────────────────────────
// Aplicação
// ────────────────────────────────────────────────────────────────────────────

/**
 * Aplica o plano na coleção local, no modo escolhido.
 * 'overwrite': o conteúdo do pacote vence nos itens em comum e o card FSRS
 * fica com a versão mais recente; 'keep': os itens locais vencem.
 *
 * GRAVA EM LOTES PEQUENOS: entre cada lote solta o processador (yield) e
 * emite o progresso — a UI acompanha ao vivo e a tela não congela.
 */
export async function applyImportPlan(
  plan: ImportPlan,
  mode: ImportConflictMode,
  onProgress?: (p: ImportApplyProgress) => void
): Promise<ApplyImportResult> {
  const { data, deckLinks, noteTypeLinks, noteLinks, cardLinks, presetLinks } = plan;
  const now = Date.now();

  // ── Decks ──
  const localDecks = StorageService.getDecks();
  const deckIdsTaken = new Set(localDecks.map((d) => d.id));
  /** incoming deck id → id final (local do casado, novo para os demais) */
  const finalDeckId = new Map<string, string>();
  const decksChanged = new Map<string, Deck>(localDecks.map((d) => [d.id, d]));
  let decksDirty = false;
  const addedDecks: Deck[] = [];
  for (const incoming of data.decks) {
    const matched = deckLinks.get(incoming.id) ?? null;
    if (matched) {
      finalDeckId.set(incoming.id, matched);
      if (mode === 'overwrite') {
        const local = decksChanged.get(matched)!;
        const candidate: Deck = {
          ...local,
          // o preset é o de casa casado pelo nome (o id do arquivo pode não existir aqui)
          presetId: incoming.presetId
            ? (presetLinks.get(incoming.presetId) ?? local.presetId)
            : local.presetId,
          dailyLimitsOverride: incoming.dailyLimitsOverride ?? local.dailyLimitsOverride,
          fsrsOverride: incoming.fsrsOverride ?? local.fsrsOverride,
          fsrsParams: incoming.fsrsParams ?? local.fsrsParams,
        };
        if (JSON.stringify(candidate) !== JSON.stringify(local)) {
          decksChanged.set(matched, { ...candidate, updatedAt: now });
          decksDirty = true;
        }
      }
    } else {
      const id = freshId(incoming.id, deckIdsTaken);
      finalDeckId.set(incoming.id, id);
      addedDecks.push({
        ...incoming,
        id,
        createdAt: incoming.createdAt || now,
        updatedAt: now,
      });
      decksDirty = true;
    }
  }
  if (decksDirty) {
    StorageService.saveDecks([...decksChanged.values(), ...addedDecks]);
  }

  // ── Presets (casados pelo NOME — o id interno muda entre dispositivos;
  //    em 'overwrite' o do pacote atualiza o de casa) ──
  if (data.presets?.length) {
    const localPresets = StorageService.getPresets();
    const localPresetByName = new Map(localPresets.map((p) => [p.name.trim(), p]));
    const mergedLocal =
      mode === 'keep'
        ? localPresets
        : localPresets.map((p) => {
            const incoming = data.presets!.find((ip) => ip.name.trim() === p.name.trim());
            // O preset "Padrão" de fábrica nunca é substituído.
            if (!incoming || p.id === StorageService.DEFAULT_PRESET_ID) return p;
            if (JSON.stringify(incoming) === JSON.stringify(p)) return p;
            return { ...incoming, id: p.id, createdAt: p.createdAt, updatedAt: now };
          });
    const incomingNew = data.presets.filter((ip) => !localPresetByName.has(ip.name.trim()));
    if (mergedLocal.some((p, i) => p !== localPresets[i]) || incomingNew.length > 0) {
      StorageService.savePresets([...mergedLocal, ...incomingNew]);
    }
  }

  // ── Tipos de nota ──
  const localNoteTypes = StorageService.getNoteTypes();
  const noteTypeIdsTaken = new Set(localNoteTypes.map((nt) => nt.id));
  const finalNoteTypeId = new Map<string, string>();
  const noteTypesChanged = new Map<string, NoteType>(localNoteTypes.map((nt) => [nt.id, nt]));
  let noteTypesDirty = false;
  const addedNoteTypes: NoteType[] = [];
  for (const incoming of data.noteTypes) {
    const matched = noteTypeLinks.get(incoming.id) ?? null;
    if (matched) {
      finalNoteTypeId.set(incoming.id, matched);
      if (mode === 'overwrite') {
        const local = noteTypesChanged.get(matched)!;
        const candidate = { ...incoming, id: matched };
        if (JSON.stringify(candidate) !== JSON.stringify(local)) {
          noteTypesChanged.set(matched, { ...candidate, createdAt: local.createdAt, updatedAt: now });
          noteTypesDirty = true;
        }
      }
    } else {
      const id = freshId(incoming.id, noteTypeIdsTaken);
      finalNoteTypeId.set(incoming.id, id);
      addedNoteTypes.push({
        ...incoming,
        id,
        createdAt: incoming.createdAt || now,
        updatedAt: now,
      });
      noteTypesDirty = true;
    }
  }
  if (noteTypesDirty) {
    StorageService.saveNoteTypes([...noteTypesChanged.values(), ...addedNoteTypes]);
  }

  // ── Notas ──
  const localNotes = StorageService.getNotes();
  const noteIdsTaken = new Set(localNotes.map((n) => n.id));
  const finalNoteId = new Map<string, string>();
  const addedNotes: Note[] = [];
  const updatedNoteIds = new Set<string>();
  const updatedNotesById = new Map<string, Note>();
  let keptDuplicates = 0;
  for (const incoming of data.notes) {
    const matched = noteLinks.get(incoming.id);
    if (!matched) {
      const id = freshId(incoming.id, noteIdsTaken);
      finalNoteId.set(incoming.id, id);
      addedNotes.push({
        ...incoming,
        id,
        deckId: finalDeckId.get(incoming.deckId) ?? incoming.deckId,
        noteTypeId: finalNoteTypeId.get(incoming.noteTypeId) ?? incoming.noteTypeId,
        createdAt: incoming.createdAt || now,
        updatedAt: incoming.updatedAt || now,
      });
      continue;
    }
    finalNoteId.set(incoming.id, matched);
    if (mode === 'keep') {
      keptDuplicates++;
      continue;
    }
    const local = localNotes.find((n) => n.id === matched)!;
    updatedNoteIds.add(matched);
    updatedNotesById.set(matched, {
      ...local,
      deckId: finalDeckId.get(incoming.deckId) ?? local.deckId,
      noteTypeId: finalNoteTypeId.get(incoming.noteTypeId) ?? local.noteTypeId,
      // Sobrescrita: o CONTEÚDO do pacote vence, campo a campo.
      fields: { ...incoming.fields },
      media: incoming.media?.length ? incoming.media : local.media,
      tags: incoming.tags,
      createdAt: Math.min(local.createdAt || now, incoming.createdAt || now),
      updatedAt: Math.max(local.updatedAt || 0, incoming.updatedAt || 0),
    });
  }
  if (addedNotes.length > 0 || updatedNoteIds.size > 0) {
    const remaining = localNotes.filter((n) => !updatedNoteIds.has(n.id));
    // Ordem de entrada: atualizadas primeiro, depois as novas.
    const toWrite: Note[] = [...updatedNotesById.values(), ...addedNotes];
    await saveInChunks(
      toWrite,
      (prefix) => StorageService.saveNotes([...remaining, ...prefix]),
      (done, total) => onProgress?.({ part: 'notes', done, total })
    );
  }

  // ── Cards ──
  const localCards = StorageService.getCards();
  const cardIdsTaken = new Set(localCards.map((c) => c.id));
  const addedCards: Card[] = [];
  const updatedCards: Card[] = [];
  const updatedCardIds = new Set<string>();
  for (const incoming of data.cards) {
    const matchedCard = cardLinks.get(`${incoming.noteId}::${incoming.templateOrd}`);
    const resolvedNoteId = finalNoteId.get(incoming.noteId) ?? incoming.noteId;
    if (!matchedCard) {
      const id = freshId(incoming.id, cardIdsTaken);
      addedCards.push({
        ...incoming,
        id,
        noteId: resolvedNoteId,
        deckId: finalDeckId.get(incoming.deckId) ?? incoming.deckId,
        createdAt: incoming.createdAt || now,
        updatedAt: incoming.updatedAt || now,
      });
      continue;
    }
    if (mode === 'keep') continue;
    const local = localCards.find((c) => c.id === matchedCard)!;
    // FSRS: fica a versão mais recente — a que foi estudada por último.
    // Empate (mesma última revisão): o arquivo vence, já que o usuário
    // pediu para sobrescrever.
    const localWins = isFsrsNewer(local, incoming);
    const winner = localWins ? local : incoming;
    const merged: Card = {
      id: local.id,
      noteId: resolvedNoteId,
      deckId: finalDeckId.get(incoming.deckId) ?? local.deckId,
      templateOrd: incoming.templateOrd,
      due: winner.due,
      fsrs: winner.fsrs,
      position: winner.position ?? local.position,
      learningStep: winner.learningStep ?? local.learningStep,
      suspended: winner.suspended ?? local.suspended,
      createdAt: Math.min(local.createdAt || now, incoming.createdAt || now),
      updatedAt: Math.max(local.updatedAt || 0, incoming.updatedAt || 0),
    };
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      updatedCardIds.add(merged.id);
      updatedCards.push(merged);
    }
  }
  if (addedCards.length > 0 || updatedCardIds.size > 0) {
    const remaining = localCards.filter((c) => !updatedCardIds.has(c.id));
    const toWrite: Card[] = [...updatedCards, ...addedCards];
    await saveInChunks(
      toWrite,
      (prefix) => StorageService.saveCards([...remaining, ...prefix]),
      (done, total) => onProgress?.({ part: 'cards', done, total })
    );
  }

  // ── Histórico de revisão (união, sem duplicar) ──
  let addedRevlog = 0;
  if (data.revlog?.length) {
    const localRevlog = StorageService.getRevlog();
    const seen = new Set(localRevlog.map(revlogKey));
    const fresh = data.revlog.filter((e) => !seen.has(revlogKey(e)));
    if (fresh.length > 0) {
      StorageService.saveRevlogAll([...localRevlog, ...fresh]);
      addedRevlog = fresh.length;
    }
  }

  // ── FSRS global ──
  // T10: o global é configuração fixa do app → a importação NÃO o altera
  // (o campo continua no .colpkg por compatibilidade de formato, mas o app
  // usa sempre o seu valor oficial). Presets/decks do pacote seguem valendo.
  const appliedGlobalFsrs = false;

  const message = buildApplyMessage({
    addedDecks: addedDecks.length,
    addedNotes: addedNotes.length,
    updatedNotes: updatedNoteIds.size,
    keptDuplicates,
    addedCards: addedCards.length,
    updatedCards: updatedCards.length,
  });

  return {
    mode,
    addedDecks: addedDecks.length,
    addedNoteTypes: addedNoteTypes.length,
    addedNotes: addedNotes.length,
    updatedNotes: updatedNoteIds.size,
    keptDuplicates,
    addedCards: addedCards.length,
    updatedCards: updatedCards.length,
    addedRevlog,
    appliedGlobalFsrs,
    message,
  };
}

/** true quando a versão `a` do card tem progresso FSRS mais recente que `b`. */
function isFsrsNewer(a: Card, b: Card): boolean {
  const ar = a.fsrs?.lastReview ?? 0;
  const br = b.fsrs?.lastReview ?? 0;
  if (ar !== br) return ar > br;
  // Empate em "última revisão" (ou nenhum dos dois estudados): o que tiver
  // mais repetições levou mais vida; ainda empatado, fica o local.
  return (a.fsrs?.reps ?? 0) > (b.fsrs?.reps ?? 0);
}

/**
 * O AGENDAMENTO do card é diferente entre as duas versões? (datas, estado
 * FSRS, suspensão e posição na fila) — o conteúdo da nota é outra história.
 */
function cardScheduleDiffers(local: Card, incoming: Card): boolean {
  const num = (v: number | undefined | null) => v ?? null;
  if (num(local.due) !== num(incoming.due)) return true;
  if (num(local.position) !== num(incoming.position)) return true;
  if (num(local.learningStep) !== num(incoming.learningStep)) return true;
  if (!!local.suspended !== !!incoming.suspended) return true;
  const a = local.fsrs;
  const b = incoming.fsrs;
  if (!a || !b) return !!a !== !!b;
  return (
    num(a.stability) !== num(b.stability) ||
    num(a.difficulty) !== num(b.difficulty) ||
    num(a.elapsedDays) !== num(b.elapsedDays) ||
    num(a.scheduledDays) !== num(b.scheduledDays) ||
    num(a.reps) !== num(b.reps) ||
    num(a.lapses) !== num(b.lapses) ||
    num(a.state) !== num(b.state) ||
    num(a.lastReview) !== num(b.lastReview)
  );
}

/**
 * As OPÇÕES do deck são diferentes? (parâmetros FSRS do deck, limites e o
 * preset usado). Só o que o arquivo TRAZ é comparado — o que não vem mantém
 * o valor de cá (é a mesma regra da aplicação).
 *
 * O preset é comparado pelo NOME: o id interno muda de dispositivo para
 * dispositivo, o nome não.
 */
function deckOptionsDiffer(
  local: Deck,
  incoming: Deck,
  localPresetName: Map<string, string>,
  incomingPresetName: Map<string, string>
): boolean {
  if (incoming.presetId) {
    const localPreset = local.presetId ? (localPresetName.get(local.presetId) ?? '') : '';
    const incomingPreset = incomingPresetName.get(incoming.presetId) ?? '';
    if (localPreset !== incomingPreset) return true;
  }
  if (
    incoming.fsrsParams !== undefined &&
    JSON.stringify(local.fsrsParams ?? null) !== JSON.stringify(incoming.fsrsParams ?? null)
  ) {
    return true;
  }
  if (
    incoming.fsrsOverride !== undefined &&
    JSON.stringify(local.fsrsOverride ?? null) !== JSON.stringify(incoming.fsrsOverride ?? null)
  ) {
    return true;
  }
  if (
    incoming.dailyLimitsOverride !== undefined &&
    JSON.stringify(local.dailyLimitsOverride ?? null) !==
      JSON.stringify(incoming.dailyLimitsOverride ?? null)
  ) {
    return true;
  }
  return false;
}

function buildApplyMessage(c: {
  addedDecks: number;
  addedNotes: number;
  updatedNotes: number;
  keptDuplicates: number;
  addedCards: number;
  updatedCards: number;
}): string {
  const parts: string[] = [];
  if (c.addedDecks > 0) {
    parts.push(`${c.addedDecks} deck${c.addedDecks > 1 ? 's' : ''} novo${c.addedDecks > 1 ? 's' : ''}`);
  }
  if (c.addedNotes > 0) {
    parts.push(`${c.addedNotes} nota${c.addedNotes > 1 ? 's' : ''} nova${c.addedNotes > 1 ? 's' : ''}`);
  }
  if (c.addedCards > 0) {
    parts.push(`${c.addedCards} card${c.addedCards > 1 ? 's' : ''}`);
  }
  const head =
    parts.length > 0 ? `Adicionado: ${parts.join(', ')}.` : 'Nada novo a adicionar.';
  const tailParts: string[] = [];
  if (c.updatedNotes > 0) {
    tailParts.push(
      `${c.updatedNotes} nota${c.updatedNotes > 1 ? 's' : ''} atualizada${c.updatedNotes > 1 ? 's' : ''}`
    );
  }
  if (c.updatedCards > 0) {
    tailParts.push(
      `${c.updatedCards} card${c.updatedCards > 1 ? 's' : ''} atualizado${c.updatedCards > 1 ? 's' : ''}`
    );
  }
  const tail = tailParts.length > 0 ? ` Atualizado: ${tailParts.join(', ')}.` : '';
  return `${head}${tail}`;
}

// ── helpers ──

/** Devolve `base` se ainda livre; senão gera uma variante única. */
function freshId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let id: string;
  do {
    id = `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

function noteTypeKey(name: string, isCloze: boolean): string {
  return `${isCloze ? 'cloze' : 'std'}::${name}`;
}

/**
 * Compara o CONTEÚDO de duas versões da mesma nota (mesma identidade):
 * campos (normalizados — HTML de enfeite não conta como diferença) e tags.
 * Usado para saber se há uma disputa real de conteúdo a perguntar.
 */
function notesContentDiffer(local: Note, incoming: Note): boolean {
  const localTags = JSON.stringify([...(local.tags || [])].sort());
  const incomingTags = JSON.stringify([...(incoming.tags || [])].sort());
  if (localTags !== incomingTags) return true;
  const keys = new Set([
    ...Object.keys(local.fields || {}),
    ...Object.keys(incoming.fields || {}),
  ]);
  for (const key of keys) {
    const a = normalizeFieldValue(local.fields?.[key] ?? '');
    const b = normalizeFieldValue(incoming.fields?.[key] ?? '');
    if (a !== b) return true;
  }
  return false;
}

/** Uma revisão é identificada pelo instante + card — único em cada lado. */
function revlogKey(e: RevlogEntry): string {
  return `${e.reviewTime}:${e.cardId}`;
}

/**
 * Gravação em LOTES PEQUENOS com progresso ao vivo.
 *
 * O tamanho do lote se adapta para gerar ~100 atualizações de tela em
 * qualquer coleção — com mínimo de 2 itens (para decks pequenos, tipo o
 * do usuário com ~200 cards, o contador corre praticamente de 2 em 2) e
 * sem enlouquecer coleções gigantes. Entre cada lote o processador é
 * SOLTADO (setTimeout 0) — é isso que deixa o navegador pintar a tela
 * e evita a impressão de app travado.
 */
async function saveInChunks<T>(
  items: T[],
  saveWithPrefix: (prefix: T[]) => void,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const total = items.length;
  if (total === 0) return;
  // ~100 atualizações, mínimo de 2: coleções pequenas correm no “de 2 em 2”,
  // grandes se dividem em ~100 lotes.
  const chunkSize = Math.max(2, Math.ceil(total / 100));
  let done = 0;
  for (let i = 0; i < total; i += chunkSize) {
    const prefix = items.slice(0, Math.min(i + chunkSize, total));
    saveWithPrefix(prefix);
    done = prefix.length;
    onProgress?.(done, total);
    // Soltar o processador: dá espaço para a UI pintar o contador.
    await new Promise((r) => setTimeout(r, 0));
  }
}
