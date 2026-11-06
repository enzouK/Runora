import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Headphones,
  Play,
  Pause,
  Maximize2,
  Check,
  Star,
} from 'lucide-react';
import { Note, NoteType, Card } from '../../types/runora';
import { MediaStore } from '../../services/mediaStore';
import { ClozeService } from '../../services/clozeService';
import { CardContentRenderer } from '../study/CardContentRenderer';
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
} from '../../services/cardPreview';
import { FSRS } from '../../fsrs/algorithm';
import { formatDifficultyPercent, hasDifficulty } from '../../fsrs/difficulty';
import { formatTimespanDays } from '../../fsrs/timespan';
import { getCardMaturity } from '../../fsrs/maturity';
import { useBodyScrollLock } from '../common/useBodyScrollLock';

interface CardListItemProps {
  note: Note;
  noteType: NoteType;
  card?: Card | null;
  onSelect: (note: Note) => void;
  selected?: boolean;
  showStats?: boolean;
  chosenFields?: string[]; // optional override for display fields
  className?: string;
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

/** Layout driven by the PRIMARY (starred) field. */
type RowLayout = 'text' | 'image' | 'audio';

/** Image box with lightbox. */
const RowImage: React.FC<{
  imageRef: string | null;
  fallbackImage?: string;
  featured?: boolean;
}> = ({ imageRef, fallbackImage, featured = false }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [showLightbox, setShowLightbox] = useState(false);
  useBodyScrollLock(showLightbox);

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

  if (!imageRef && !fallbackImage) return null;

  return (
    <>
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (url) setShowLightbox(true);
        }}
        className={`group/img relative rounded-xl border border-black/[0.06] dark:border-white/[0.1] bg-black/[0.03] dark:bg-white/[0.05] flex items-center justify-center overflow-hidden shrink-0 cursor-pointer ${
          featured ? 'w-[280px] h-56' : 'w-44 h-28'
        }`}
        title="Clique para ampliar imagem"
      >
        {url && (
          <img src={url} alt="" className="max-w-full max-h-full w-auto h-auto object-contain" />
        )}
        {url && (
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white pointer-events-none">
            <Maximize2 className="w-5 h-5" />
          </div>
        )}
      </div>

      {showLightbox &&
        createPortal(
          <div
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowLightbox(false);
            }}
            className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-4xl max-h-[90vh] bg-zinc-900 rounded-2xl p-2 overflow-hidden shadow-2xl flex flex-col items-center"
            >
              <button
                type="button"
                onClick={() => setShowLightbox(false)}
                className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors z-10 cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
              <img src={url ?? ''} alt="Ampliada" className="max-h-[82vh] w-auto object-contain rounded-xl" />
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

/** Headphone button for text-primary layout. */
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
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full align-[-4px] mr-1.5 transition-all active:scale-90 shrink-0 cursor-pointer ${
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

/** Review-style audio mini player. */
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
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 cursor-pointer ${
          isPlaying
            ? 'bg-ios-blue text-white shadow-[0_1px_6px_rgba(0,122,255,0.45)]'
            : 'bg-ios-blue/15 text-ios-blue hover:bg-ios-blue/25'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 ml-0.5 fill-current" />}
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

const STATE_BADGE_STYLES: Record<number, { label: string; cls: string }> = {
  0: { label: 'Novo', cls: 'bg-ios-blue/15 text-ios-blue' },
  1: { label: 'Aprendizagem', cls: 'bg-ios-orange/15 text-ios-orange' },
  2: { label: 'Revisão', cls: 'bg-ios-green/15 text-ios-green' },
  3: { label: 'Reaprendizagem', cls: 'bg-ios-red/15 text-ios-red' },
};

const CardStatusBadges: React.FC<{ state: number; maturity?: string }> = ({
  state,
  maturity,
}) => {
  const st = STATE_BADGE_STYLES[state];
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {st && (
        <span
          className={`text-[10px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap ${st.cls}`}
          title="Estado de agendamento FSRS"
        >
          {st.label}
        </span>
      )}
      {maturity === 'young' && (
        <span className="text-[10px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">
          Jovem
        </span>
      )}
      {maturity === 'mature' && (
        <span className="text-[10px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">
          Maduro
        </span>
      )}
    </div>
  );
};

export const CardListItem: React.FC<CardListItemProps> = ({
  note,
  noteType,
  card,
  onSelect,
  selected,
  showStats = false,
  chosenFields,
  className = '',
}) => {
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

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

  // Chosen display fields (names); the first one is the PRIMARY field
  const sortedFields = [...noteType.fields].sort((a, b) => a.ord - b.ord);
  const allFieldNames = sortedFields.map((f) => f.name);
  const chosenNames = chosenFields?.length
    ? chosenFields.filter((n) => allFieldNames.includes(n))
    : resolveDisplayFields(allFieldNames, undefined);

  // Render mode per field, as requested by the note type's TEMPLATE
  const modes = detectFieldModes(noteType.templates, noteType.fields.map((f) => f.name));

  const allBlocks = chosenNames.map((name) => {
    const raw = note.fields[name] ?? '';
    const mode: FieldRenderMode = modes[name] ?? 'plain';
    if (mode === 'furigana') {
      const html = furiganaPreviewHtml(raw);
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
    : 'text';

  // Text blocks (media-only/empty fields are represented by previews instead)
  const textBlocks = allBlocks.filter((b) => b.text.length > 0);
  const primaryTextBlock = layout === 'text' ? textBlocks[0] : undefined;

  // Media refs scanned across the chosen RAW field contents, in display order
  const joined = allBlocks.map((b) => b.raw).join(' ');
  const imageRef = layout === 'image' ? null : extractFirstImage(joined);
  const audioRef = layout === 'audio' ? null : extractFirstAudio(joined);
  const mediaImage = note.media?.find((m) => m.type === 'image')?.dataUrl;
  const mediaAudio = note.media?.find((m) => m.type === 'audio')?.dataUrl;

  // Primary text shows at least the first 2 <br>-separated lines
  const primaryLines = primaryTextBlock ? primaryTextBlock.text.split('\n') : [];
  const primaryShown = primaryLines.slice(0, 2).join('\n');

  const hasAnyVisual = !!imageRef || !!mediaImage || !!audioRef || !!mediaAudio || !!pImage || !!pAudio;

  const maturity = card ? getCardMaturity(card) : null;
  const r = card && hasDifficulty(card.fsrs.difficulty) ? 'OK' : 'N/D'; // simplified

  return (
    <div
      onClick={() => onSelect(note)}
      className={`group flex flex-col sm:flex-row sm:items-end justify-between gap-3 px-4 py-4 transition-colors cursor-pointer select-none ${
        selected
          ? 'bg-ios-blue/[0.07] dark:bg-ios-blue/[0.1]'
          : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
      } ${className}`}
    >
      {/* Left: media + field contents (layout driven by primary field) */}
      <div className="flex-1 min-w-0">
        {/* IMAGE-PRIMARY: featured centered image above the texts */}
        {layout === 'image' && primaryEntry && (
          <div className="mb-3">
            <div className="flex items-center gap-1 mb-1.5">
              <Star className="w-2.5 h-2.5 text-ios-orange fill-current" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                {primaryEntry.name}
              </span>
            </div>
            <div className="flex justify-center">
              <RowImage featured imageRef={pImage} fallbackImage={mediaImage} />
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
                <div className="whitespace-pre-line font-semibold text-[15px] leading-relaxed text-zinc-900 dark:text-white line-clamp-6 cursor-text">
                  <RowAudioButton
                    audioRef={audioRef}
                    fallbackAudio={mediaAudio}
                    playingUrl={playingUrl}
                    onToggle={toggleAudio}
                  />
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
                  <div className="whitespace-pre-line text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500 line-clamp-2 cursor-text">
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

      {/* Right: status badge + stats + select indicator */}
      <div className="flex items-center gap-3 shrink-0">
        <CardStatusBadges state={card?.fsrs.state ?? 0} maturity={maturity ?? undefined} />
        {showStats && card && hasDifficulty(card.fsrs.difficulty) && (
          <div className="flex items-center gap-2.5 text-[12px] font-semibold tabular-nums pr-1 hidden md:flex">
            <span className="text-zinc-400 dark:text-zinc-500" title="Estabilidade (dias de memória)">
              <span className="font-medium">S</span>{' '}
              <span className="text-ios-blue">{formatTimespanDays(card.fsrs.stability)}</span>
            </span>
            <span className="text-zinc-400 dark:text-zinc-500" title="Dificuldade (0% a 100% — quanto maior, mais difícil)">
              <span className="font-medium">D</span>{' '}
              <span className="text-ios-orange">{formatDifficultyPercent(card.fsrs.difficulty)}</span>
            </span>
            <span className="text-zinc-400 dark:text-zinc-500" title="Probabilidade de lembrança">
              <span className="font-medium">R</span>{' '}
              <span className="text-ios-green">{(card.fsrs.stability > 0 ? 100 : 0) + '%'}</span>
            </span>
          </div>
        )}
        {selected && (
          <div className="w-5 h-5 rounded-[6px] border-2 bg-ios-blue border-ios-blue text-white flex items-center justify-center shrink-0">
            <Check className="w-3 h-3" strokeWidth={3.5} />
          </div>
        )}
      </div>
    </div>
  );
};