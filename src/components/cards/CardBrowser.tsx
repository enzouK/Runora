import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Trash2,
  Edit3,
  SlidersHorizontal,
  Star,
  Check,
  Headphones,
} from 'lucide-react';
import { Card, Note, NoteType } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { FSRS } from '../../fsrs/algorithm';
import { MediaStore } from '../../services/mediaStore';
import { stripHtml, extractFirstImage, extractFirstAudio } from '../../services/cardPreview';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { IOSSelect } from '../common/IOSSelect';

interface CardBrowserProps {
  onEditNote: (noteId: string) => void;
  onRefresh: () => void;
}

/** Resolves a media reference (bare filename → blob URL; absolute/data → as-is). */
async function resolveMedia(ref: string): Promise<string | null> {
  if (!ref) return null;
  if (MediaStore.isMediaReference(ref)) {
    try {
      return await MediaStore.getUrl(ref);
    } catch {
      return null;
    }
  }
  return ref;
}

/** Image thumbnail: keeps the original aspect ratio, sits left of the text. */
const RowImage: React.FC<{ imageRef: string | null; fallbackImage?: string }> = ({
  imageRef,
  fallbackImage,
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    (async () => {
      const u = imageRef ? await resolveMedia(imageRef) : null;
      if (cancelled) return;
      setUrl(u ?? (imageRef ? null : fallbackImage ?? null));
    })();
    return () => {
      cancelled = true;
    };
  }, [imageRef, fallbackImage]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      className="max-h-28 max-w-44 w-auto h-auto object-contain rounded-xl border border-black/[0.06] dark:border-white/[0.1] shrink-0"
    />
  );
};

/** AnkiDroid-style headphone button: plays the card audio inline with the text. */
const RowAudioButton: React.FC<{
  audioRef: string | null;
  fallbackAudio?: string;
  playingUrl: string | null;
  onToggle: (url: string) => void;
}> = ({ audioRef, fallbackAudio, playingUrl, onToggle }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    (async () => {
      const u = audioRef ? await resolveMedia(audioRef) : null;
      if (cancelled) return;
      setUrl(u ?? (audioRef ? null : fallbackAudio ?? null));
    })();
    return () => {
      cancelled = true;
    };
  }, [audioRef, fallbackAudio]);

  if (!url) return null;
  const isPlaying = playingUrl === url;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(url);
      }}
      title={isPlaying ? 'Pausar áudio' : 'Tocar áudio'}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full align-[-4px] mr-1.5 transition-all active:scale-90 ${
        isPlaying
          ? 'bg-ios-blue text-white shadow-[0_1px_6px_rgba(0,122,255,0.45)]'
          : 'bg-ios-blue/10 text-ios-blue hover:bg-ios-blue/20'
      }`}
    >
      <Headphones className={`w-3.5 h-3.5 ${isPlaying ? 'animate-pulse' : ''}`} />
    </button>
  );
};

export const CardBrowser: React.FC<CardBrowserProps> = ({ onEditNote, onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeckFilter, setSelectedDeckFilter] = useState('all');
  const [selectedStateFilter, setSelectedStateFilter] = useState('all');
  const [cardToDelete, setCardToDelete] = useState<{
    card: Card;
    preview: string;
    deckName: string;
  } | null>(null);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [fieldPrefs, setFieldPrefs] = useState<Record<string, string[]>>(
    () => StorageService.getBrowserFieldPrefs()
  );

  // Single shared audio element so only one preview plays at a time
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      audioElRef.current?.pause();
    };
  }, []);

  const toggleAudio = (url: string) => {
    if (playingUrl === url) {
      audioElRef.current?.pause();
      setPlayingUrl(null);
      return;
    }
    audioElRef.current?.pause();
    const el = new Audio(url);
    el.onended = () => setPlayingUrl(null);
    el.play().catch(() => setPlayingUrl(null));
    audioElRef.current = el;
    setPlayingUrl(url);
  };

  const decks = useMemo(() => StorageService.getDecks(), []);
  const noteTypes = useMemo(() => StorageService.getNoteTypes(), []);
  const notes = useMemo(() => StorageService.getNotes(), [onRefresh]);
  const cards = useMemo(() => StorageService.getCards(), [onRefresh]);

  const noteMap = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const deckMap = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);
  const noteTypeMap = useMemo(() => new Map(noteTypes.map((nt) => [nt.id, nt])), [noteTypes]);

  const fsrsEngine = useMemo(() => new FSRS(StorageService.getFSRSSettings()), []);

  /** Sorted field definitions of a note type. */
  const sortedFields = (nt: NoteType) => [...nt.fields].sort((a, b) => a.ord - b.ord);

  /**
   * Effective display field NAMES for a note type. The FIRST one is the
   * primary field. Falls back to first two fields by ord when no preference.
   */
  const effectiveFields = (nt: NoteType): string[] => {
    const defs = sortedFields(nt);
    const names = defs.map((f) => f.name);
    const pref = fieldPrefs[nt.id];
    if (pref && pref.length > 0) {
      const chosen = names.filter((n) => pref.includes(n));
      if (chosen.length > 0) return chosen;
    }
    return names.slice(0, 2);
  };

  const toggleFieldPref = (noteTypeId: string, fieldName: string) => {
    const nt = noteTypes.find((n) => n.id === noteTypeId);
    if (!nt) return;
    const current = fieldPrefs[noteTypeId] ?? sortedFields(nt).slice(0, 2).map((f) => f.name);
    const next = current.includes(fieldName)
      ? current.filter((n) => n !== fieldName)
      : [...current, fieldName];
    setFieldPrefs((prev) => ({ ...prev, [noteTypeId]: next }));
    StorageService.setBrowserFieldPref(noteTypeId, next);
  };

  /** Promotes a field to primary: moves it to the front of the selection. */
  const setPrimaryFieldPref = (noteTypeId: string, fieldName: string) => {
    const current = fieldPrefs[noteTypeId];
    if (!current || current.length === 0 || current[0] === fieldName) return;
    const next = [fieldName, ...current.filter((n) => n !== fieldName)];
    setFieldPrefs((prev) => ({ ...prev, [noteTypeId]: next }));
    StorageService.setBrowserFieldPref(noteTypeId, next);
  };

  // Filtered card items
  const filteredCards = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return cards.filter((card) => {
      const note = noteMap.get(card.noteId);
      if (!note) return false;

      // Deck filter
      if (selectedDeckFilter !== 'all' && card.deckId !== selectedDeckFilter) {
        return false;
      }

      // State filter
      if (selectedStateFilter !== 'all') {
        const stateNum = parseInt(selectedStateFilter, 10);
        if (card.fsrs.state !== stateNum) return false;
      }

      // Search text in fields or tags
      if (q) {
        const fieldsText = Object.values(note.fields).join(' ').toLowerCase();
        const tagsText = note.tags.join(' ').toLowerCase();
        if (!fieldsText.includes(q) && !tagsText.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [cards, noteMap, searchQuery, selectedDeckFilter, selectedStateFilter]);

  const handleDeleteCardClick = (
    card: Card,
    preview: string,
    deckName: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setCardToDelete({ card, preview, deckName });
  };

  const handleConfirmDelete = () => {
    if (cardToDelete) {
      StorageService.deleteNote(cardToDelete.card.noteId);
      setCardToDelete(null);
      onRefresh();
    }
  };

  return (
    <div className="space-y-4 ios-fade-in">
      {/* Search and Filters Card */}
      <div className="p-4 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] space-y-3">
        {/* iOS Search Field */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] focus-within:ring-2 focus-within:ring-ios-blue/40 transition-shadow">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar em perguntas, respostas, tags..."
            className="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 text-[14px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="w-5 h-5 rounded-full bg-black/[0.12] dark:bg-white/[0.2] flex items-center justify-center text-white hover:bg-black/[0.2] dark:hover:bg-white/[0.3] transition-colors shrink-0"
              title="Limpar busca"
            >
              <X className="w-3 h-3" strokeWidth={3} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Deck:</span>
            <IOSSelect
              value={selectedDeckFilter}
              onChange={setSelectedDeckFilter}
              options={[
                { value: 'all', label: `Todos os Decks (${cards.length})` },
                ...decks.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </div>

          <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Status:</span>
            <IOSSelect
              value={selectedStateFilter}
              onChange={setSelectedStateFilter}
              options={[
                { value: 'all', label: 'Todos os Estados' },
                { value: '0', label: 'Novo (New)' },
                { value: '1', label: 'Aprendizado (Learning)' },
                { value: '2', label: 'Revisão (Review)' },
                { value: '3', label: 'Reaprendizado (Relearning)' },
              ]}
            />
          </div>

          {/* Field display preferences */}
          <button
            type="button"
            onClick={() => setShowFieldPicker((v) => !v)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all active:scale-95 ${
              showFieldPicker
                ? 'bg-ios-blue text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)]'
                : 'bg-black/[0.06] dark:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.1] dark:hover:bg-white/[0.15]'
            }`}
            title="Escolher campos exibidos por Note Type"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Campos</span>
          </button>

          <div className="ml-auto text-[12px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
            {filteredCards.length} cards
          </div>
        </div>
      </div>

      {/* Field Display Preferences Panel (multi-select chips + primary star) */}
      {showFieldPicker && (
        <div className="p-4 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] ios-fade-in">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
                Campos exibidos
              </h3>
              <p className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                Toque para incluir ou remover campos. A estrela{' '}
                <Star className="w-3 h-3 inline text-ios-orange fill-current -mt-0.5" /> define o
                campo principal — ele aparece primeiro e com o texto destacado.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFieldPicker(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="divide-y divide-black/[0.05] dark:divide-white/[0.07] mt-2">
            {noteTypes.map((nt) => {
              const selected = effectiveFields(nt);
              return (
                <div key={nt.id} className="py-3">
                  <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 mb-2">
                    {nt.name}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sortedFields(nt).map((f) => {
                      const isOn = selected.includes(f.name);
                      const isPrimary = isOn && selected[0] === f.name;
                      return (
                        <span
                          key={f.id}
                          className={`flex items-center rounded-full border transition-all ${
                            isOn
                              ? 'bg-ios-blue/10 border-ios-blue/30'
                              : 'bg-black/[0.04] dark:bg-white/[0.07] border-transparent'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleFieldPref(nt.id, f.name)}
                            className={`flex items-center gap-1 pl-3 pr-2 py-1.5 text-[12px] font-semibold rounded-l-full transition-colors active:scale-95 ${
                              isOn
                                ? 'text-ios-blue'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                            }`}
                          >
                            {isOn && <Check className="w-3 h-3" strokeWidth={3} />}
                            <span>{f.name}</span>
                          </button>

                          {isOn && (
                            <button
                              type="button"
                              onClick={() => setPrimaryFieldPref(nt.id, f.name)}
                              title="Definir como campo principal"
                              className={`pr-2.5 pl-0.5 py-1.5 rounded-r-full transition-colors ${
                                isPrimary
                                  ? 'text-ios-orange'
                                  : 'text-ios-blue/40 hover:text-ios-orange'
                              }`}
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${isPrimary ? 'fill-current' : ''}`}
                              />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cards Grouped List (iOS inset grouped) */}
      <div className="rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
        {filteredCards.length === 0 ? (
          <div className="text-center py-14 px-4">
            <Search className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">
              Nenhum card encontrado
            </p>
            <p className="text-[13px] text-zinc-400 dark:text-zinc-500 mt-1">
              Ajuste a busca ou os filtros para ver seus cards.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.05] dark:divide-white/[0.07]">
            {filteredCards.map((card) => {
              const note = noteMap.get(card.noteId);
              const deck = deckMap.get(card.deckId);
              const noteType = note ? noteTypeMap.get(note.noteTypeId) : null;
              if (!note) return null;

              // Chosen display fields (names); the first one is the primary field
              const chosenNames = noteType
                ? effectiveFields(noteType)
                : Object.keys(note.fields).slice(0, 2);

              const allBlocks = chosenNames.map((name) => {
                const html = note.fields[name] ?? '';
                return { name, html, text: stripHtml(html) };
              });

              // Fields that are pure media (or empty) are represented by the
              // image preview / headphone button — never as raw text blocks.
              const blocks = allBlocks.filter((b) => b.text.length > 0);

              // Media refs scanned across the chosen fields, in display order
              const joined = allBlocks.map((b) => b.html).join(' ');
              const imageRef = extractFirstImage(joined);
              const audioRef = extractFirstAudio(joined);
              const mediaImage = note.media?.find((m) => m.type === 'image')?.dataUrl;
              const mediaAudio = note.media?.find((m) => m.type === 'audio')?.dataUrl;

              const r =
                card.fsrs.stability > 0
                  ? (fsrsEngine.retrievability(card.fsrs.elapsedDays, card.fsrs.stability) * 100).toFixed(0) + '%'
                  : '100%';

              // Primary text shows at least the first 2 <br>-separated lines
              const primaryBlock = blocks[0];
              const primaryLines = primaryBlock ? primaryBlock.text.split('\n') : [];
              const primaryShown = primaryLines.slice(0, 2).join('\n');

              return (
                <div
                  key={card.id}
                  onClick={() => onEditNote(note.id)}
                  className="group flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-4 py-4 cursor-pointer select-none transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                >
                  {/* Left: image + field texts (headphone button inline) */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-3.5">
                      <RowImage imageRef={imageRef} fallbackImage={mediaImage} />

                      <div className="flex-1 min-w-0 space-y-2">
                        {primaryBlock && (
                          <div>
                            <div className="flex items-center gap-1 mb-0.5">
                              <Star className="w-2.5 h-2.5 text-ios-orange fill-current" />
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                                {primaryBlock.name}
                              </span>
                            </div>
                            <div className="whitespace-pre-line font-semibold text-[15px] leading-relaxed text-zinc-900 dark:text-white line-clamp-6">
                              <RowAudioButton
                                audioRef={audioRef}
                                fallbackAudio={mediaAudio}
                                playingUrl={playingUrl}
                                onToggle={toggleAudio}
                              />
                              {primaryShown || '—'}
                            </div>
                          </div>
                        )}

                        {blocks.slice(1).map((b) => (
                          <div key={b.name}>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-0.5">
                              {b.name}
                            </div>
                            <div className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500 line-clamp-2">
                              {b.text}
                            </div>
                          </div>
                        ))}

                        {blocks.length === 0 && !imageRef && !audioRef && (
                          <div className="text-[13px] text-zinc-400 py-1">Card sem conteúdo</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: stats + actions */}
                  <div className="flex items-center gap-3 shrink-0 sm:pt-0.5">
                    <div className="flex items-center gap-2.5 text-[12px] font-semibold tabular-nums pr-1">
                      <span
                        className="text-zinc-400 dark:text-zinc-500"
                        title="Estabilidade (dias de memória)"
                      >
                        <span className="font-medium">S</span>{' '}
                        <span className="text-ios-blue">{card.fsrs.stability.toFixed(1)}d</span>
                      </span>
                      <span
                        className="text-zinc-400 dark:text-zinc-500"
                        title="Dificuldade (1 a 10)"
                      >
                        <span className="font-medium">D</span>{' '}
                        <span className="text-ios-orange">{card.fsrs.difficulty.toFixed(1)}</span>
                      </span>
                      <span
                        className="text-zinc-400 dark:text-zinc-500 hidden md:inline"
                        title="Probabilidade de lembrança"
                      >
                        <span className="font-medium">R</span>{' '}
                        <span className="text-ios-green">{r}</span>
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditNote(note.id);
                        }}
                        className="p-1.5 rounded-full text-zinc-400 hover:text-ios-blue hover:bg-ios-blue/10 transition-colors"
                        title="Editar"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) =>
                          handleDeleteCardClick(
                            card,
                            primaryBlock?.text || 'Card sem título',
                            deck?.name || 'Deck',
                            e
                          )
                        }
                        className="p-1.5 rounded-full text-zinc-400 hover:text-ios-red hover:bg-ios-red/10 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={!!cardToDelete}
        onClose={() => setCardToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Excluir Flashcard?"
        description="Esta ação excluirá este cartão e a respectiva nota original do seu banco de dados."
        highlightItem={
          cardToDelete
            ? `[${cardToDelete.deckName}] ${cardToDelete.preview}`
            : undefined
        }
        confirmText="Excluir Card"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};
