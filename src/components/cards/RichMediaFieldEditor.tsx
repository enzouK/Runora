import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  Trash2,
  Maximize2,
  X,
  Code,
  Eye,
  Mic,
  Upload,
  Scissors,
  ExternalLink,
  Music,
  Image as ImageIcon,
  ChevronDown,
  Check,
} from 'lucide-react';
import { AudioService } from '../../services/audioService';
import { MediaStore } from '../../services/mediaStore';

export interface FieldSegment {
  id: string;
  type: 'text' | 'audio' | 'image';
  content?: string;
  url?: string;
  rawTag?: string;
}

interface RichMediaFieldEditorProps {
  fieldName: string;
  value: string;
  onChange: (newValue: string) => void;
  placeholder?: string;
  isHintField?: boolean;
  isClozeNoteType?: boolean;
  onInsertCloze?: (fieldName: string) => void;
  description?: string;
}

// Regex helpers to identify media
const AUDIO_EXT_REGEX = /\.(mp3|wav|ogg|m4a|aac|opus)(\?[^\s<>"']*)?$/i;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif|svg|avif|bmp)(\?[^\s<>"']*)?$/i;

export const isAudioUrl = (url: string): boolean => {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:audio/')) return true;
  if (trimmed.startsWith('blob:') && !trimmed.includes('image')) return true;
  if (trimmed.includes('ttsmaker-file.com') || trimmed.includes('ttsmaker.com')) return true;
  if (AUDIO_EXT_REGEX.test(trimmed)) return true;
  return false;
};

export const isImageUrl = (url: string): boolean => {// ...existing code...
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) return true;
  if (IMAGE_EXT_REGEX.test(trimmed)) return true;
  return false;
};

/**
 * Resolve a possibly bare filename (e.g., "vcm_123.webm" from an imported package)
 * to a playable Blob URL from MediaStore (IndexedDB). If it's already a proper URL
 * (data:, blob:, http), return it untouched.
 */
function useResolvedMediaUrl(url: string | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(url ?? null);
  useEffect(() => {
    if (!url) {
      setResolved(null);
      return;
    }
    if (MediaStore.isMediaReference(url)) {
      MediaStore.getUrl(url).then((u) => setResolved(u ?? url));
    } else {
      setResolved(url);
    }
  }, [url]);
  return resolved;
}

/**
 * Parses raw field string into visual segments: text, audio, and image blocks
 */
export const parseFieldSegments = (raw: string): FieldSegment[] => {
  if (!raw) {
    // IMPORTANT: this id must match the first parsed segment id ('seg-text-0')
    // so the textarea node is not remounted on the first typed character
    return [{ id: 'seg-text-0', type: 'text', content: '' }];
  }

  const segments: FieldSegment[] = [];

  // Match:
  // 1. [sound:URL]
  // 2. <audio ...src="URL"...>...</audio> or <audio ...src="URL".../>
  // 3. <img ...src="URL".../> or <img ...src="URL"...>
  // 4. Standalone URLs: https://...mp3, https://...ttsmaker..., https://...png/jpg, data:audio/..., data:image/...
  const mediaRegex =
    /(?:\[sound:([^\]]+)\])|(?:<audio[^>]*src=["']([^"']+)["'][^>]*>(?:<\/audio>)?)|(?:<img[^>]*src=["']([^"']+)["'][^>]*\/?>)|((?:https?:\/\/|data:audio\/|data:image\/)[^\s<>"']+)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let counter = 0;

  while ((match = mediaRegex.exec(raw)) !== null) {
    const matchStart = match.index;
    const matchEnd = mediaRegex.lastIndex;

    // Preceding text
    if (matchStart > lastIndex) {
      const textChunk = raw.substring(lastIndex, matchStart);
      if (textChunk) {
        segments.push({
          id: `seg-text-${counter++}`,
          type: 'text',
          // <br> tags become real newlines so the textarea shows line breaks
          content: textChunk.replace(/<br\s*\/?>/gi, '\n'),
        });
      }
    }

    const fullMatch = match[0];
    const soundMatch = match[1];
    const audioTagMatch = match[2];
    const imgTagMatch = match[3];
    const bareUrlMatch = match[4];

    if (soundMatch) {
      segments.push({
        id: `seg-audio-${counter++}`,
        type: 'audio',
        url: soundMatch.trim(),
        rawTag: fullMatch,
      });
    } else if (audioTagMatch) {
      segments.push({
        id: `seg-audio-${counter++}`,
        type: 'audio',
        url: audioTagMatch.trim(),
        rawTag: fullMatch,
      });
    } else if (imgTagMatch) {
      segments.push({
        id: `seg-image-${counter++}`,
        type: 'image',
        url: imgTagMatch.trim(),
        rawTag: fullMatch,
      });
    } else if (bareUrlMatch) {
      const url = bareUrlMatch.trim();
      if (isAudioUrl(url)) {
        segments.push({
          id: `seg-audio-${counter++}`,
          type: 'audio',
          url,
          rawTag: fullMatch,
        });
      } else if (isImageUrl(url)) {
        segments.push({
          id: `seg-image-${counter++}`,
          type: 'image',
          url,
          rawTag: fullMatch,
        });
      } else {
        // Regular non-media URL, treat as text
        segments.push({
          id: `seg-text-${counter++}`,
          type: 'text',
          content: fullMatch,
        });
      }
    }

    lastIndex = matchEnd;
  }

  // Trailing text
  if (lastIndex < raw.length) {
    const trailing = raw.substring(lastIndex);
    if (trailing) {
      segments.push({
        id: `seg-text-${counter++}`,
        type: 'text',
        // <br> tags become real newlines so the textarea shows line breaks
        content: trailing.replace(/<br\s*\/?>/gi, '\n'),
      });
    }
  }

  // Ensure there's always at least one segment (stable id, same reasoning as above)
  if (segments.length === 0) {
    segments.push({ id: 'seg-text-0', type: 'text', content: '' });
  }

  return segments;
};

/**
 * Re-serializes segments back into the standard field string
 */
export const serializeSegments = (segments: FieldSegment[]): string => {
  return segments
    .map((seg) => {
      if (seg.type === 'text') {
        // Newlines typed in the textarea are stored as <br> (HTML-compatible)
        return (seg.content || '').replace(/\n/g, '<br>');
      } else if (seg.type === 'audio') {
        // Standard [sound:...] tag format
        return `[sound:${seg.url}]`;
      } else if (seg.type === 'image') {
        return `<img src="${seg.url}" class="rounded-xl max-h-60 my-2 shadow-sm" alt="Image" />`;
      }
      return '';
    })
    .join('');
};

/**
 * Interactive Audio MiniPlayer inside field
 */
const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const FieldAudioMiniPlayer: React.FC<{
  url: string;
  onRemove: () => void;
}> = ({ url, onRemove }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);

  // Bare filenames from imported .apkg media resolve to blob: URLs here
  const resolvedUrl = useResolvedMediaUrl(url);
  const playerSrc = resolvedUrl || url;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setIsSpeedMenuOpen(false);
      }
    };
    if (isSpeedMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSpeedMenuOpen]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.playbackRate = playbackRate;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      audio.playbackRate = playbackRate;
    };

    const handleTimeUpdate = () => {
      if (audio.duration) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [url, playbackRate]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((e) => console.error('Playback error:', e));
    }
  };

  const restart = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.playbackRate = playbackRate;
    audioRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch((e) => console.error('Playback error:', e));
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    audioRef.current.currentTime = ratio * duration;
    setProgress(ratio * 100);
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleSpeedSelect = (speed: number) => {
    setPlaybackRate(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
    setIsSpeedMenuOpen(false);
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const isTTS = url.includes('ttsmaker');

  return (
    <div className="my-2 p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800/90 border border-blue-500/30 dark:border-blue-500/30 shadow-sm flex items-center gap-3 transition-all relative select-none">
      <audio ref={audioRef} src={playerSrc} preload="metadata" />

      {/* Play/Pause Button */}
      <button
        type="button"
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 flex-shrink-0 ${
          isPlaying
            ? 'bg-blue-600 text-white animate-pulse'
            : 'bg-blue-500 hover:bg-blue-600 text-white'
        }`}
        title={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 ml-0.5 fill-current" />
        )}
      </button>

      {/* Info & Progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
            <Volume2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            <span className="truncate">
              {isTTS ? 'Pronúncia TTSMaker' : 'Áudio Incorporado'}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
              {isTTS ? 'TTS' : 'MP3'}
            </span>
          </div>

          <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex-shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Interactive progress bar */}
        <div
          onClick={handleSeek}
          className="w-full bg-zinc-200 dark:bg-zinc-700 h-2 rounded-full cursor-pointer relative overflow-hidden group"
          title="Clique para avançar/retroceder"
        >
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Replay Button */}
      <button
        type="button"
        onClick={restart}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors flex-shrink-0"
        title="Reiniciar áudio"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>

      {/* Speed Dropdown Menu Container */}
      <div className="relative flex-shrink-0" ref={speedMenuRef}>
        <button
          type="button"
          onClick={() => setIsSpeedMenuOpen((prev) => !prev)}
          className={`flex items-center gap-1 px-2 py-1 text-xs font-mono font-medium rounded-lg border transition-all ${
            playbackRate !== 1.0
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 font-semibold'
              : 'bg-zinc-200/70 dark:bg-zinc-700/70 border-transparent hover:bg-zinc-300/80 dark:hover:bg-zinc-600/80 text-zinc-700 dark:text-zinc-300'
          }`}
          title="Alterar velocidade de reprodução"
          aria-haspopup="true"
          aria-expanded={isSpeedMenuOpen}
        >
          <span>{playbackRate}x</span>
          <ChevronDown
            className={`w-3 h-3 transition-transform duration-150 ${
              isSpeedMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown Popover */}
        {isSpeedMenuOpen && (
          <div className="absolute right-0 bottom-full mb-1.5 w-32 py-1 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-700/50 mb-0.5">
              Velocidade
            </div>
            {SPEED_OPTIONS.map((speed) => {
              const isSelected = playbackRate === speed;
              return (
                <button
                  key={speed}
                  type="button"
                  onClick={() => handleSpeedSelect(speed)}
                  className={`w-full px-2.5 py-1.5 text-xs text-left flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/60'
                  }`}
                >
                  <span className="font-mono">{speed.toFixed(speed % 1 === 0 ? 1 : 2)}x</span>
                  {speed === 1.0 && !isSelected && (
                    <span className="text-[10px] text-zinc-400 font-normal">Padrão</span>
                  )}
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Remove Button */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
        title="Remover este áudio do campo"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * Interactive Image Preview inside field
 */
const FieldImagePreview: React.FC<{
  url: string;
  onRemove: () => void;
}> = ({ url, onRemove }) => {
  const [showModal, setShowModal] = useState(false);
  // Bare filenames from imported .apkg media resolve to blob: URLs here
  const resolvedUrl = useResolvedMediaUrl(url);
  const imgSrc = resolvedUrl || url;

  return (
    <>
      <div className="my-2 p-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/90 border border-emerald-500/30 dark:border-emerald-500/30 shadow-sm flex items-center justify-between gap-3 group">
        <div className="flex items-center gap-3 min-w-0">
          <div
            onClick={() => setShowModal(true)}
            className="cursor-pointer relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 w-16 h-16 flex-shrink-0 bg-black/5 flex items-center justify-center hover:opacity-90 transition-opacity"
            title="Clique para ampliar imagem"
          >
            <img src={imgSrc} alt="Pasted" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
              <Maximize2 className="w-4 h-4" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              <ImageIcon className="w-3.5 h-3.5 text-emerald-500" />
              <span>Imagem Anexada</span>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              Clique na miniatura para inspecionar
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title="Ampliar"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Remover imagem do campo"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lightbox Modal */}
      {showModal && (
        <div
          // mousedown (not click): a text-selection drag released over the backdrop must not close
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl max-h-[90vh] bg-zinc-900 rounded-2xl p-2 overflow-hidden shadow-2xl flex flex-col items-center"
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={imgSrc}
              alt="Ampliada"
              className="max-h-[82vh] w-auto object-contain rounded-xl"
            />
          </div>
        </div>
      )}
    </>
  );
};

export const RichMediaFieldEditor: React.FC<RichMediaFieldEditorProps> = ({
  fieldName,
  value,
  onChange,
  placeholder,
  isHintField = false,
  isClozeNoteType = false,
  onInsertCloze,
  description,
}) => {
  const [isRawMode, setIsRawMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Parse raw value into segments
  const segments = useMemo(() => parseFieldSegments(value), [value]);

  // Keep track of active textarea element
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSegmentIdRef = useRef<string | null>(null);

  /**
   * Universal paste interceptor:
   * Detects audio links (like TTSMaker, MP3), image links, and clipboard files
   */
  const handleUniversalPaste = async (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    targetSegmentId?: string
  ) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Check for file items (images / audio)
    const items = clipboardData.items;
    let handledFile = false;

    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          handledFile = true;
          const file = item.getAsFile();
          if (file) {
            const dataUrl = await AudioService.fileToDataUrl(file);
            insertMediaIntoSegments('image', dataUrl, targetSegmentId);
            return;
          }
        } else if (item.type.indexOf('audio') !== -1) {
          e.preventDefault();
          handledFile = true;
          const file = item.getAsFile();
          if (file) {
            const dataUrl = await AudioService.fileToDataUrl(file);
            insertMediaIntoSegments('audio', dataUrl, targetSegmentId);
            return;
          }
        }
      }
    }

    if (handledFile) return;

    // 2. Check for pasted text containing audio or image URLs
    const pastedText = clipboardData.getData('text/plain')?.trim();
    if (pastedText) {
      if (isAudioUrl(pastedText)) {
        e.preventDefault();
        insertMediaIntoSegments('audio', pastedText, targetSegmentId);
        return;
      } else if (isImageUrl(pastedText)) {
        e.preventDefault();
        insertMediaIntoSegments('image', pastedText, targetSegmentId);
        return;
      }
    }
  };

  /**
   * Inserts media directly into current segments structure at cursor position
   */
  const insertMediaIntoSegments = (
    mediaType: 'audio' | 'image',
    mediaUrl: string,
    targetSegmentId?: string
  ) => {
    const textarea = activeTextareaRef.current;
    const currentSegments = parseFieldSegments(value);

    // If no target segment provided, append or insert at active segment
    const segId = targetSegmentId || activeSegmentIdRef.current;
    const segIndex = currentSegments.findIndex((s) => s.id === segId);

    const newMediaSegment: FieldSegment = {
      id: `seg-${mediaType}-${Date.now()}`,
      type: mediaType,
      url: mediaUrl,
    };

    if (segIndex !== -1 && currentSegments[segIndex].type === 'text') {
      const textSeg = currentSegments[segIndex];
      const textContent = textSeg.content || '';

      const selStart = textarea?.selectionStart ?? textContent.length;
      const beforeText = textContent.substring(0, selStart);
      const afterText = textContent.substring(selStart);

      const updatedSegments: FieldSegment[] = [];
      for (let i = 0; i < currentSegments.length; i++) {
        if (i === segIndex) {
          if (beforeText || (!beforeText && !afterText)) {
            updatedSegments.push({
              id: `seg-text-${Date.now()}-a`,
              type: 'text',
              content: beforeText,
            });
          }
          updatedSegments.push(newMediaSegment);
          updatedSegments.push({
            id: `seg-text-${Date.now()}-b`,
            type: 'text',
            content: afterText,
          });
        } else {
          updatedSegments.push(currentSegments[i]);
        }
      }

      onChange(serializeSegments(updatedSegments));
    } else {
      // Append to the end
      const updatedSegments = [
        ...currentSegments,
        newMediaSegment,
        { id: `seg-text-end-${Date.now()}`, type: 'text', content: '' } as FieldSegment,
      ];
      onChange(serializeSegments(updatedSegments));
    }
  };

  /**
   * Updates text inside a specific text segment
   */
  const handleTextSegmentChange = (segId: string, newText: string) => {
    const updated = segments.map((s) => {
      if (s.id === segId) {
        return { ...s, content: newText };
      }
      return s;
    });
    onChange(serializeSegments(updated));
  };

  /**
   * Removes a media block from the field
   */
  const handleRemoveSegment = (segId: string) => {
    const updated = segments.filter((s) => s.id !== segId);
    if (updated.length === 0) {
      onChange('');
    } else {
      onChange(serializeSegments(updated));
    }
  };

  /**
   * Record microphone directly into this field
   */
  const handleRecordToggle = async () => {
    if (isRecording) {
      setIsRecording(false);
      const blobUrl = await AudioService.stopRecording();
      if (blobUrl) {
        insertMediaIntoSegments('audio', blobUrl);
      }
    } else {
      setIsRecording(true);
      await AudioService.startRecording();
    }
  };

  /**
   * Attach file from file picker
   */
  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const dataUrl = await AudioService.fileToDataUrl(file);
    if (file.type.startsWith('image/')) {
      insertMediaIntoSegments('image', dataUrl);
    } else if (file.type.startsWith('audio/')) {
      insertMediaIntoSegments('audio', dataUrl);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Insert Cloze syntax into active textarea
   */
  const handleClozeClick = () => {
    const textarea = activeTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;
    const selectedText = currentVal.substring(start, end) || 'palavra';

    // Calculate cloze index based on whole field value
    const matches = value.match(/\{\{c(\d+)::/g) || [];
    const nextIndex = matches.length + 1;

    const replacement = `{{c${nextIndex}::${selectedText}}}`;
    const newVal = currentVal.substring(0, start) + replacement + currentVal.substring(end);

    const segId = activeSegmentIdRef.current;
    if (segId) {
      handleTextSegmentChange(segId, newVal);
    } else {
      onChange(newVal);
    }
  };

  // Check if current value contains any media
  const hasMediaInField = segments.some((s) => s.type === 'audio' || s.type === 'image');

  return (
    <div className="space-y-1.5">
      {/* Field Header with Label and Quick Actions */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          {isHintField && <span>💡</span>}
          <span>{fieldName}</span>
          {description && (
            <span className="text-[11px] font-normal text-zinc-400">({description})</span>
          )}
        </label>

        {/* Toolbar */}
        <div className="flex items-center gap-1.5">
          {/* Mode Switcher */}
          <button
            type="button"
            onClick={() => setIsRawMode(!isRawMode)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              isRawMode
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200'
            }`}
            title={
              isRawMode
                ? 'Alternar para Modo Visual (Preview)'
                : 'Alternar para Modo RAW (Código / Tags)'
            }
          >
            {isRawMode ? <Eye className="w-3 h-3" /> : <Code className="w-3 h-3" />}
            <span>{isRawMode ? 'Visual' : 'RAW'}</span>
          </button>

          {/* Cloze quick button */}
          {isClozeNoteType && (
            <button
              type="button"
              onClick={handleClozeClick}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-mono font-medium transition-colors"
              title="Inserir Cloze [{{c1::...}}]"
            >
              <Scissors className="w-3 h-3" />
              <span>[c1]</span>
            </button>
          )}

          {/* Record button */}
          <button
            type="button"
            onClick={handleRecordToggle}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              isRecording
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200'
            }`}
            title="Gravar áudio direto para este campo"
          >
            <Mic className="w-3 h-3" />
            <span>{isRecording ? 'Parar' : 'Gravar'}</span>
          </button>

          {/* Attach media button */}
          <label
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-600 dark:text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            title="Carregar imagem ou arquivo de áudio"
          >
            <Upload className="w-3 h-3" />
            <span>Arquivo</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,audio/*"
              className="hidden"
              onChange={handleFilePicked}
            />
          </label>
        </div>
      </div>

      {/* Field Input Container */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-2.5 transition-all focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500">
        {isRawMode ? (
          /* RAW MODE: full textarea displaying raw HTML / tags */
          <div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1 px-1">
              <span className="font-mono">Modo RAW (Edição direta de tags e URLs)</span>
              <span className="text-[10px]">Pressione Visual para ver o preview</span>
            </div>
            <textarea
              rows={4}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onPaste={(e) => handleUniversalPaste(e)}
              placeholder={placeholder || `Conteúdo de ${fieldName}...`}
              className="w-full px-3 py-2 rounded-xl bg-zinc-100/80 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none transition-all resize-y"
            />
          </div>
        ) : (
          /* VISUAL MODE: Interactive embedded blocks + editable text segments */
          <div className="space-y-1.5">
            {segments.map((seg, idx) => {
              if (seg.type === 'audio') {
                return (
                  <FieldAudioMiniPlayer
                    key={seg.id}
                    url={seg.url || ''}
                    onRemove={() => handleRemoveSegment(seg.id)}
                  />
                );
              } else if (seg.type === 'image') {
                return (
                  <FieldImagePreview
                    key={seg.id}
                    url={seg.url || ''}
                    onRemove={() => handleRemoveSegment(seg.id)}
                  />
                );
              } else {
                // Text Segment
                const isOnlySegment = segments.length === 1;
                return (
                  <div key={seg.id} className="relative">
                    <textarea
                      rows={isOnlySegment ? 3 : Math.max(1, (seg.content || '').split('\n').length)}
                      value={seg.content || ''}
                      onChange={(e) => handleTextSegmentChange(seg.id, e.target.value)}
                      onPaste={(e) => handleUniversalPaste(e, seg.id)}
                      onFocus={(e) => {
                        activeTextareaRef.current = e.target;
                        activeSegmentIdRef.current = seg.id;
                      }}
                      placeholder={
                        isOnlySegment
                          ? isHintField
                            ? 'Insira a dica opcional deste card (exibida apenas ao clicar em Show Hint)...'
                            : `Digite o conteúdo de ${fieldName} ou cole links de áudio/imagem com Ctrl+V...`
                          : idx === segments.length - 1
                          ? 'Adicione texto complementar após a mídia...'
                          : 'Texto complementar...'
                      }
                      className="w-full px-3 py-2 rounded-xl bg-transparent text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:bg-white dark:focus:bg-zinc-800/80 transition-all font-sans resize-y placeholder:text-zinc-400"
                    />
                  </div>
                );
              }
            })}

            {/* If the last segment is media, render a subtle prompt to add trailing text */}
            {segments[segments.length - 1]?.type !== 'text' && (
              <div className="pt-1">
                <textarea
                  rows={1}
                  value=""
                  onChange={(e) => {
                    const newSegments = [
                      ...segments,
                      { id: `seg-text-add-${Date.now()}`, type: 'text', content: e.target.value } as FieldSegment,
                    ];
                    onChange(serializeSegments(newSegments));
                  }}
                  onPaste={(e) => handleUniversalPaste(e)}
                  placeholder="Clique para digitar texto adicional abaixo da mídia..."
                  className="w-full px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 bg-transparent rounded-lg focus:outline-none focus:bg-white dark:focus:bg-zinc-800 transition-all placeholder:text-zinc-400/80"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Helpful Hint on media paste */}
      {!hasMediaInField && (
        <div className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-400">
          <Music className="w-3 h-3 opacity-60" />
          <span>Cole links de áudio (ex.: TTSMaker) ou imagens com Ctrl+V para exibir a prévia no campo</span>
        </div>
      )}
    </div>
  );
};
