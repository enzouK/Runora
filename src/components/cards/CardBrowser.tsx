import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  X,
  Trash2,
  Edit3,
  SlidersHorizontal,
  Star,
  Check,
  Headphones,
  Play,
  Pause,
  ListChecks,
  Tags,
} from 'lucide-react';
import { Card, Note, NoteType } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { FSRS } from '../../fsrs/algorithm';
import { MediaStore } from '../../services/mediaStore';
import { ClozeService } from '../../services/clozeService';
import {
  stripHtml,
  extractFirstImage,
  extractFirstAudio,
  detectFieldModes,
  resolveDisplayFields,
  promoteFieldToPrimary,
  sortCardsByMode,
  collectTags,
  furiganaPreviewHtml,
  kanjiPreviewText,
  kanaPreviewText,
  FieldRenderMode,
  CardSortMode,
} from '../../services/cardPreview';
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

/**
 * Row layout driven by the PRIMARY (starred) field:
 * - text  → image box left, primary text highlighted (current behavior)
 * - image → featured image centered above the (all-secondary) text fields
 * - audio → image box left (if any) + full review-style player above the texts
 */
type RowLayout = 'text' | 'image' | 'audio';

/** Image box: fixed size keeps text alignment stable; featured variant is larger. */
const RowImage: React.FC<{
  imageRef: string | null;
  fallbackImage?: string;
  featured?: boolean;
}> = ({ imageRef, fallbackImage, featured = false }) => {
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

  // No media source at all → no box (text-only rows keep full width)
  if (!imageRef && !fallbackImage) return null;

  return (
    <div
      className={`rounded-xl border border-black/[0.06] dark:border-white/[0.1] bg-black/[0.03] dark:bg-white/[0.05] flex items-center justify-center overflow-hidden shrink-0 ${
        featured ? 'w-[280px] h-56' : 'w-44 h-28'
      }`}
    >
      {url && (
        <img
          src={url}
          alt=""
          className="max-w-full max-h-full w-auto h-auto object-contain"
        />
      )}
    </div>
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
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full align-[-4px] mr-1.5 transition-all active:scale-90 shrink-0 ${
        isPlaying
          ? 'bg-ios-blue text-white shadow-[0_1px_6px_rgba(0,122,255,0.45)]'
          : 'bg-ios-blue/10 text-ios-blue hover:bg-ios-blue/20'
      }`}
    >
      <Headphones className={`w-3.5 h-3.5 ${isPlaying ? 'animate-pulse' : ''}`} />
    </button>
  );
};

function formatPlayerTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Review-style audio mini player (play/pause + seekable progress + time). */
const RowAudioPlayer: React.FC<{ audioRef: string | null; fallbackAudio?: string }> = ({
  audioRef,
  fallbackAudio,
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

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
      audioElRef.current?.pause();
    };
  }, [audioRef, fallbackAudio]);

  if (!url) return null;

  const togglePlay = () => {
    const a = audioElRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
    } else {
      a.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioElRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    setCurrentTime(a.currentTime);
    setProgress(ratio * 100);
  };

  return (
    <div className="p-2.5 rounded-2xl bg-ios-blue/[0.06] dark:bg-ios-blue/[0.12] border border-ios-blue/20 flex items-center gap-2.5 w-full max-w-[320px]">
      <audio
        ref={audioElRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setCurrentTime(a.currentTime);
          if (a.duration) setProgress((a.currentTime / a.duration) * 100);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
          setCurrentTime(0);
        }}
      />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        title={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${
          isPlaying
            ? 'bg-ios-blue text-white shadow-[0_1px_6px_rgba(0,122,255,0.45)]'
            : 'bg-ios-blue/15 text-ios-blue hover:bg-ios-blue/25'
        }`}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 ml-0.5 fill-current" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div
          onClick={(e) => {
            e.stopPropagation();
            handleSeek(e);
          }}
          title="Clique para avançar/retroceder"
          className="w-full h-1.5 rounded-full bg-black/[0.08] dark:bg-white/[0.12] cursor-pointer relative overflow-hidden"
        >
          <div className="h-full bg-ios-blue rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500">
          <span>{formatPlayerTime(currentTime)}</span>
          <span>{formatPlayerTime(duration)}</span>
        </div>
      </div>
    </div>
  );
};

export const CardBrowser: React.FC<CardBrowserProps> = ({ onEditNote, onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deckFilterSelection, setDeckFilterSelection] = useState<string[]>(() =>
    StorageService.getBrowserDeckFilter()
  );
  const [statusFilterSelection, setStatusFilterSelection] = useState<string[]>(() =>
    StorageService.getBrowserStatusFilter()
  );
  const [tagFilterSelection, setTagFilterSelection] = useState<string[]>(() =>
    StorageService.getBrowserTagFilter()
  );
  const [cardToDelete, setCardToDelete] = useState<{
    card: Card;
    preview: string;
    deckName: string;
  } | null>(null);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [fieldPrefs, setFieldPrefs] = useState<Record<string, string[]>>(
    () => StorageService.getBrowserFieldPrefs()
  );
  const [sortMode, setSortMode] = useState<CardSortMode>(
    () => StorageService.getBrowserSortPref() as CardSortMode
  );

  // ---- Bulk selection (checkbox mode) ----
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTagModal, setShowTagModal] = useState(false);
  const [bulkTagSelection, setBulkTagSelection] = useState<string[]>([]);
  const [newBulkTag, setNewBulkTag] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const handleSortChange = (value: string) => {
    setSortMode(value as CardSortMode);
    StorageService.setBrowserSortPref(value);
  };

  // Single shared audio element so only one headphone-button preview plays at a time
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

  // All distinct tags across notes (for the tag filter dropdown)
  const availableTags = useMemo(() => collectTags(notes), [notes]);
  const deckMap = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);
  const noteTypeMap = useMemo(() => new Map(noteTypes.map((nt) => [nt.id, nt])), [noteTypes]);

  const fsrsEngine = useMemo(() => new FSRS(StorageService.getFSRSSettings()), []);

  // Per-note-type render modes detected from the TEMPLATES ({{furigana:}}, {{kanji:}}, {{kana:}})
  const fieldModesCache = useMemo(() => {
    const map: Record<string, Record<string, FieldRenderMode>> = {};
    for (const nt of noteTypes) {
      map[nt.id] = detectFieldModes(nt.templates, nt.fields.map((f) => f.name));
    }
    return map;
  }, [noteTypes]);

  /** Sorted field definitions of a note type. */
  const sortedFields = (nt: NoteType) => [...nt.fields].sort((a, b) => a.ord - b.ord);

  /**
   * Effective display field NAMES for a note type. The FIRST one is the
   * primary field. Falls back to first two fields by ord when no preference.
   */
  const effectiveFields = (nt: NoteType): string[] =>
    resolveDisplayFields(
      sortedFields(nt).map((f) => f.name),
      fieldPrefs[nt.id]
    );

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

  /** Promotes a field to primary: moves it to the front of the selection.
   *  Works even when no preference exists yet (falls back to first two by ord). */
  const setPrimaryFieldPref = (noteTypeId: string, fieldName: string) => {
    const nt = noteTypes.find((n) => n.id === noteTypeId);
    if (!nt) return;
    const next = promoteFieldToPrimary(
      fieldPrefs[noteTypeId],
      sortedFields(nt).map((f) => f.name),
      fieldName
    );
    if (!next) return; // already primary (or nothing to change)
    setFieldPrefs((prev) => ({ ...prev, [noteTypeId]: next }));
    StorageService.setBrowserFieldPref(noteTypeId, next);
  };

  // Active multi-select filters (saved deck ids that no longer exist are ignored)
  const activeDeckFilter = useMemo(
    () => deckFilterSelection.filter((id) => deckMap.has(id)),
    [deckFilterSelection, deckMap]
  );
  const activeStatusFilter = useMemo(
    () => statusFilterSelection.filter((v) => ['0', '1', '2', '3'].includes(v)),
    [statusFilterSelection]
  );
  // Saved tags that no note uses anymore are ignored
  const activeTagFilter = useMemo(
    () => tagFilterSelection.filter((t) => availableTags.includes(t)),
    [tagFilterSelection, availableTags]
  );

  // Filtered card items
  const filteredCards = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return cards.filter((card) => {
      const note = noteMap.get(card.noteId);
      if (!note) return false;

      // Deck filter (multi-select OR; empty = all; saved ids that no longer
      // exist are ignored so a stale filter can never hide everything)
      if (activeDeckFilter.length > 0 && !activeDeckFilter.includes(card.deckId)) {
        return false;
      }

      // State filter (multi-select OR; empty = all)
      if (activeStatusFilter.length > 0 && !activeStatusFilter.includes(String(card.fsrs.state))) {
        return false;
      }

      // Tag filter (multi-select OR; empty = all; matches ANY selected tag)
      if (activeTagFilter.length > 0 && !note.tags.some((t) => activeTagFilter.includes(t))) {
        return false;
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
  }, [cards, noteMap, searchQuery, activeDeckFilter, activeStatusFilter, activeTagFilter]);

  // List ordering (user preference, persisted between sessions)
  const sortedCards = useMemo(
    () => sortCardsByMode(filteredCards, sortMode),
    [filteredCards, sortMode]
  );

  // ---- Bulk selection logic ----
  const cardToNoteId = useMemo(
    () => new Map(cards.map((c) => [c.id, c.noteId])),
    [cards]
  );
  const selectedCount = selectedIds.size;
  const selectedNoteIds = useMemo(() => {
    const set = new Set<string>();
    for (const cardId of selectedIds) {
      const noteId = cardToNoteId.get(cardId);
      if (noteId) set.add(noteId);
    }
    return set;
  }, [selectedIds, cardToNoteId]);

  const allFilteredSelected =
    sortedCards.length > 0 && sortedCards.every((c) => selectedIds.has(c.id));

  // Selection resets when the visible set changes (filters/search) — sorting keeps it
  useEffect(() => {
    setSelectedIds(new Set());
  }, [searchQuery, activeDeckFilter, activeStatusFilter, activeTagFilter]);

  const toggleSelectionMode = () => {
    setSelectionMode((v) => {
      if (v) setSelectedIds(new Set()); // leaving selection mode clears it
      return !v;
    });
  };

  const toggleCardSelection = (cardId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedCards.map((c) => c.id)));
  };

  const applyBulkTags = (mode: 'add' | 'remove') => {
    if (bulkTagSelection.length === 0 || selectedNoteIds.size === 0) return;
    if (mode === 'add') StorageService.addTagsToCards([...selectedIds], bulkTagSelection);
    else StorageService.removeTagsFromCards([...selectedIds], bulkTagSelection);
    setShowTagModal(false);
    setBulkTagSelection([]);
    setNewBulkTag('');
    onRefresh();
  };

  const handleConfirmBulkDelete = () => {
    for (const noteId of selectedNoteIds) {
      StorageService.deleteNote(noteId);
    }
    setConfirmBulkDelete(false);
    setSelectedIds(new Set());
    onRefresh();
  };

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
    <div className="space-y-4">
      {/* Search Card */}
      <div className="p-4 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
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
              className="w-5 h-5 rounded-full bg-[rgba(0,0,0,0.12)] dark:bg-[rgba(255,255,255,0.2)] flex items-center justify-center text-white hover:bg-[rgba(0,0,0,0.2)] dark:hover:bg-[rgba(255,255,255,0.3)] transition-colors shrink-0"
              title="Limpar busca"
            >
              <X className="w-3 h-3" strokeWidth={3} />
            </button>
          )}
        </div>
      </div>

      {/* Filters Box: WHICH cards appear */}
      <div className="px-4 py-3.5 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex flex-wrap items-center gap-2.5">
        <IOSSelect
          multiple
          active={activeDeckFilter.length > 0}
          values={deckFilterSelection}
          onValuesChange={(v) => {
            setDeckFilterSelection(v);
            StorageService.setBrowserDeckFilter(v);
          }}
          options={[
            { value: 'all', label: 'Todos os Decks' },
            ...decks.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />

        <IOSSelect
          multiple
          active={activeStatusFilter.length > 0}
          values={statusFilterSelection}
          onValuesChange={(v) => {
            setStatusFilterSelection(v);
            StorageService.setBrowserStatusFilter(v);
          }}
          options={[
            { value: 'all', label: 'Todos os Estados' },
            { value: '0', label: 'Novo (New)' },
            { value: '1', label: 'Aprendizado (Learning)' },
            { value: '2', label: 'Revisão (Review)' },
            { value: '3', label: 'Reaprendizado (Relearning)' },
          ]}
        />

        <IOSSelect
          multiple
          active={activeTagFilter.length > 0}
          values={tagFilterSelection}
          onValuesChange={(v) => {
            setTagFilterSelection(v);
            StorageService.setBrowserTagFilter(v);
          }}
          options={[
            { value: 'all', label: 'Todas as tags' },
            ...availableTags.map((t) => ({ value: t, label: `#${t}` })),
          ]}
        />

        <span className="ml-auto text-[12px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
          {filteredCards.length} cards
        </span>
      </div>

      {/* Order + Tools row */}
      <div className="grid sm:grid-cols-2 gap-3">
        {/* Order Box: in WHICH order they appear */}
        <div className="px-4 py-3.5 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
            Ordenar:
          </span>
          <IOSSelect
            value={sortMode}
            onChange={handleSortChange}
            className="flex-1"
            options={[
              { value: 'newest', label: 'Mais recentes primeiro' },
              { value: 'oldest', label: 'Mais antigos primeiro' },
              { value: 'hardest', label: 'Mais difíceis primeiro' },
              { value: 'easiest', label: 'Mais fáceis primeiro' },
            ]}
          />
        </div>

        {/* Tools Box: what you are doing right now */}
        <div className="px-4 py-3.5 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleSelectionMode}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all active:scale-95 ${
              selectionMode
                ? 'bg-ios-blue text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)]'
                : 'bg-black/[0.06] dark:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.1] dark:hover:bg-white/[0.15]'
            }`}
            title="Selecionar vários cards para ações em massa"
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>Selecionar</span>
          </button>

          <div className="w-px h-5 bg-black/[0.08] dark:bg-white/[0.1]" />

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
                campo principal — texto ganha destaque; imagem vira destaque centralizado; áudio
                vira player completo.
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
            {sortedCards.map((card) => {
              const note = noteMap.get(card.noteId);
              const deck = deckMap.get(card.deckId);
              const noteType = note ? noteTypeMap.get(note.noteTypeId) : null;
              if (!note) return null;

              // Chosen display fields (names); the first one is the PRIMARY field
              const chosenNames = noteType
                ? effectiveFields(noteType)
                : Object.keys(note.fields).slice(0, 2);

              // Render mode per field, as requested by the note type's TEMPLATE
              const modes = noteType ? fieldModesCache[noteType.id] : undefined;

              const allBlocks = chosenNames.map((name) => {
                const raw = note.fields[name] ?? '';
                const mode: FieldRenderMode = modes?.[name] ?? 'plain';
                if (mode === 'furigana') {
                  const html = furiganaPreviewHtml(raw);
                  // Readable fallback text: reading shown in parentheses
                  const text = stripHtml(html.replace(/<rt[^>]*>([\s\S]*?)<\/rt>/gi, '($1)'));
                  return { name, raw, html, text };
                }
                if (mode === 'kanji') {
                  return { name, raw, html: undefined, text: kanjiPreviewText(raw) };
                }
                if (mode === 'kana') {
                  return { name, raw, html: undefined, text: kanaPreviewText(raw) };
                }
                return { name, raw, html: undefined, text: stripHtml(raw) };
              });

              // ---- Layout driven by the PRIMARY (starred) field ----
              const primaryEntry = allBlocks[0];
              const pHasText = primaryEntry ? primaryEntry.text.length > 0 : false;
              const pImage = primaryEntry ? extractFirstImage(primaryEntry.raw) : null;
              const pAudio = primaryEntry ? extractFirstAudio(primaryEntry.raw) : null;
              const layout: RowLayout = pHasText
                ? 'text'
                : pImage
                ? 'image'
                : pAudio
                ? 'audio'
                : 'text'; // starred an empty field → fall back to text layout

              // Text blocks (media-only/empty fields are represented by previews instead)
              const textBlocks = allBlocks.filter((b) => b.text.length > 0);
              const primaryTextBlock =
                layout === 'text' ? textBlocks[0] : undefined;

              // Media refs scanned across the chosen RAW field contents, in display order
              const joined = allBlocks.map((b) => b.raw).join(' ');
              const imageRef = layout === 'image' ? null : extractFirstImage(joined);
              const audioRef = layout === 'audio' ? null : extractFirstAudio(joined);
              const mediaImage = note.media?.find((m) => m.type === 'image')?.dataUrl;
              const mediaAudio = note.media?.find((m) => m.type === 'audio')?.dataUrl;

              const r =
                card.fsrs.stability > 0
                  ? (fsrsEngine.retrievability(card.fsrs.elapsedDays, card.fsrs.stability) * 100).toFixed(0) + '%'
                  : '100%';

              // Primary text shows at least the first 2 <br>-separated lines
              const primaryLines = primaryTextBlock ? primaryTextBlock.text.split('\n') : [];
              const primaryShown = primaryLines.slice(0, 2).join('\n');

              const hasAnyVisual =
                !!imageRef || !!mediaImage || !!audioRef || !!mediaAudio || !!pImage || !!pAudio;

              const isCardSelected = selectionMode && selectedIds.has(card.id);

              return (
                <div
                  key={card.id}
                  onClick={() => (selectionMode ? toggleCardSelection(card.id) : onEditNote(note.id))}
                  className={`group flex flex-col sm:flex-row sm:items-end justify-between gap-3 px-4 py-4 cursor-pointer select-none transition-colors ${
                    isCardSelected
                      ? 'bg-ios-blue/[0.07] dark:bg-ios-blue/[0.1]'
                      : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  {/* Selection checkbox (selection mode only) */}
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCardSelection(card.id);
                      }}
                      className={`w-5 h-5 rounded-[6px] border-2 flex items-center justify-center shrink-0 transition-colors self-center ${
                        isCardSelected
                          ? 'bg-ios-blue border-ios-blue text-white'
                          : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 hover:border-ios-blue'
                      }`}
                      title={isCardSelected ? 'Desmarcar card' : 'Selecionar card'}
                    >
                      {isCardSelected && <Check className="w-3 h-3" strokeWidth={3.5} />}
                    </button>
                  )}

                  {/* Left: media + field contents (layout driven by primary field) */}
                  <div className="flex-1 min-w-0">
                    {/* IMAGE-PRIMARY: featured centered image above the texts */}
                    {layout === 'image' && primaryEntry && (
                      <div className="mb-3">
                        <div className="flex items-center justify-center gap-1 mb-1.5">
                          <Star className="w-2.5 h-2.5 text-ios-orange fill-current" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                            {primaryEntry.name}
                          </span>
                        </div>
                        <div className="flex justify-center">
                          <RowImage
                            featured
                            imageRef={pImage}
                            fallbackImage={mediaImage}
                          />
                        </div>
                      </div>
                    )}

                    <div className={layout === 'image' ? '' : 'flex items-center gap-3.5'}>
                      {/* Normal left box (text and audio-primary layouts) */}
                      {layout !== 'image' && (
                        <RowImage imageRef={imageRef} fallbackImage={mediaImage} />
                      )}

                      <div className="flex-1 min-w-0 space-y-2">
                        {/* AUDIO-PRIMARY: review-style player instead of headphone icon */}
                        {layout === 'audio' && primaryEntry && pAudio && (
                          <div>
                            <div className="flex items-center gap-1 mb-1.5">
                              <Star className="w-2.5 h-2.5 text-ios-orange fill-current" />
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                                {primaryEntry.name}
                              </span>
                            </div>
                            <RowAudioPlayer audioRef={pAudio} fallbackAudio={mediaAudio} />
                          </div>
                        )}
                        {/* IMAGE-PRIMARY with audio in the same field */}
                        {layout === 'image' && pAudio && (
                          <div className="flex justify-center">
                            <RowAudioPlayer audioRef={pAudio} fallbackAudio={mediaAudio} />
                          </div>
                        )}

                        {/* TEXT-PRIMARY: highlighted first text block (with inline headphone) */}
                        {layout === 'text' && primaryTextBlock && (
                          <div>
                            <div className="flex items-center gap-1 mb-0.5">
                              <Star className="w-2.5 h-2.5 text-ios-orange fill-current" />
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                                {primaryTextBlock.name}
                              </span>
                            </div>
                            <div className="whitespace-pre-line font-semibold text-[15px] leading-relaxed text-zinc-900 dark:text-white line-clamp-6">
                              <RowAudioButton
                                audioRef={audioRef}
                                fallbackAudio={mediaAudio}
                                playingUrl={playingUrl}
                                onToggle={toggleAudio}
                              />
                              {/* Furigana fields render real <ruby> markup (same as secondary blocks) */}
                              {primaryTextBlock.html !== undefined ? (
                                <span dangerouslySetInnerHTML={{ __html: primaryTextBlock.html }} />
                              ) : (
                                primaryShown || '—'
                              )}
                            </div>
                          </div>
                        )}

                        {/* Secondary text fields (all of them when primary is media) */}
                        {textBlocks
                          .filter((b) => b !== primaryTextBlock)
                          .map((b) => (
                            <div key={b.name}>
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-0.5">
                                {b.name}
                              </div>
                              <div className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500 line-clamp-2">
                                {b.html !== undefined ? (
                                  <span dangerouslySetInnerHTML={{ __html: b.html }} />
                                ) : (
                                  b.text
                                )}
                              </div>
                            </div>
                          ))}

                        {/* Truly empty card */}
                        {textBlocks.length === 0 && !hasAnyVisual && (
                          <div className="text-[13px] text-zinc-400 py-1">Card sem conteúdo</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: stats + actions */}
                  <div className="flex items-center gap-3 shrink-0">
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
                            textBlocks[0]?.text || 'Card sem título',
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

      {/* Bulk delete confirmation */}
      <ConfirmationModal
        isOpen={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={handleConfirmBulkDelete}
        title={`Excluir ${selectedNoteIds.size} ${selectedNoteIds.size === 1 ? 'card' : 'cards'}?`}
        description="Esta ação excluirá os cartões selecionados e suas notas originais — permanentemente."
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />

      {/* Floating bulk action bar (iOS Mail style) — appears as soon as selection mode is on */}
      {selectionMode &&
        createPortal(
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full bg-ios-card/95 dark:bg-[#2c2c2e]/95 backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.25)] ios-fade-in">
            <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 px-2 tabular-nums whitespace-nowrap">
              {selectedCount} selecionado{selectedCount > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="px-3 py-1.5 rounded-full text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors whitespace-nowrap"
              title="Selecionar/desmarcar todos os cards filtrados"
            >
              {allFilteredSelected ? 'Desmarcar todos' : `Selecionar todos (${sortedCards.length})`}
            </button>
            <div className="w-px h-5 bg-black/[0.1] dark:bg-white/[0.12]" />
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => {
                setBulkTagSelection([]);
                setNewBulkTag('');
                setShowTagModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold text-ios-blue hover:bg-ios-blue/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="Adicionar ou remover tags dos cards selecionados"
            >
              <Tags className="w-4 h-4" />
              <span>Tags</span>
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setConfirmBulkDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold text-ios-red hover:bg-ios-red/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="Excluir cards selecionados"
            >
              <Trash2 className="w-4 h-4" />
              <span>Excluir</span>
            </button>
            <div className="w-px h-5 bg-black/[0.1] dark:bg-white/[0.12]" />
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
              title="Desmarcar todos"
            >
              <X className="w-4 h-4" />
            </button>
          </div>,
          document.body
        )}

      {/* Bulk tag modal (add/remove tags on the notes behind selected cards) */}
      {showTagModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            // mousedown (not click): a text-selection drag released over the backdrop must not close
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowTagModal(false);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-2xl space-y-4 ios-fade-in"
            >
              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Tags em massa
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {selectedCount} card{selectedCount > 1 ? 's' : ''} selecionado
                  {selectedCount > 1 ? 's' : ''} ({selectedNoteIds.size}{' '}
                  {selectedNoteIds.size === 1 ? 'nota' : 'notas'}). Marque as tags e escolha
                  adicionar ou remover.
                </p>
              </div>

              {/* Existing tags as toggleable chips */}
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                {availableTags.length === 0 && (
                  <span className="text-[13px] text-zinc-400">Nenhuma tag existente ainda.</span>
                )}
                {availableTags.map((t) => {
                  const isOn = bulkTagSelection.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setBulkTagSelection((prev) =>
                          prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                        )
                      }
                      className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all active:scale-95 ${
                        isOn
                          ? 'bg-ios-blue/10 text-ios-blue border-ios-blue/30'
                          : 'bg-black/[0.04] dark:bg-white/[0.07] text-zinc-500 dark:text-zinc-400 border-transparent hover:bg-black/[0.08] dark:hover:bg-white/[0.12]'
                      }`}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>

              {/* New tag input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newBulkTag}
                  onChange={(e) => setNewBulkTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      const trimmed = newBulkTag.trim();
                      if (trimmed && !bulkTagSelection.includes(trimmed)) {
                        setBulkTagSelection((prev) => [...prev, trimmed]);
                        setNewBulkTag('');
                      }
                    }
                  }}
                  placeholder="Criar tag nova..."
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-[13px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={bulkTagSelection.length === 0}
                  onClick={() => applyBulkTags('remove')}
                  className="px-4 py-2.5 rounded-full text-[13px] font-semibold text-ios-red border border-ios-red/30 hover:bg-ios-red/10 transition-all active:scale-95 disabled:opacity-40"
                >
                  Remover das selecionadas
                </button>
                <button
                  type="button"
                  disabled={bulkTagSelection.length === 0}
                  onClick={() => applyBulkTags('add')}
                  className="px-4 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-[#0071eb] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-40"
                >
                  Adicionar às selecionadas
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
