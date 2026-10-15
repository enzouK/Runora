import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, ChevronDown, Check } from 'lucide-react';

export interface AudioPlayerProps {
  src: string;
  label?: string;
  autoPlay?: boolean;
  accentColor?: 'blue' | 'indigo' | 'emerald';
  cardId?: string;
  onEnded?: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  label,
  autoPlay = false,
  accentColor = 'blue',
  cardId,
  onEnded,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);

  const isTTS = /ttsmaker/i.test(src);

  // Reset state and playback rate to 1.0 when cardId or src changes
  useEffect(() => {
    setPlaybackRate(1.0);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setIsSpeedMenuOpen(false);

    if (audioRef.current) {
      audioRef.current.playbackRate = 1.0;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [cardId, src]);

  // Handle outside click to close the speed dropdown menu
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

  // Audio element listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.playbackRate = playbackRate;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      audio.playbackRate = playbackRate;
      if (autoPlay) {
        audio.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };

    // If metadata already loaded before listeners attached (cached / data: URIs),
    // run immediately — otherwise autoplay silently never fires.
    if (audio.readyState >= 1) {
      handleLoadedMetadata();
    }

    const handleTimeUpdate = () => {
      if (audio.duration) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handleAudioEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
      if (onEnded) onEnded();
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleAudioEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleAudioEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
    };
  }, [src, autoPlay, playbackRate, onEnded]);

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
        .catch((e) => {
          console.error('Audio playback error:', e);
        });
    }
  };

  const restart = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.playbackRate = playbackRate;
    audioRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch((e) => console.error('Audio restart error:', e));
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newProgress = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = newProgress * audio.duration;
    setProgress(newProgress * 100);
    setCurrentTime(audio.currentTime);
  };

  const handleSpeedSelect = (speed: number) => {
    setPlaybackRate(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
    setIsSpeedMenuOpen(false);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || !isFinite(seconds) || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Accent styling mappings
  const colorThemes = {
    blue: {
      button: isPlaying
        ? 'bg-blue-600 text-white shadow-blue-500/25 animate-pulse'
        : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/20',
      progressFill: 'bg-blue-500',
      badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      border: 'border-blue-500/30 dark:border-blue-500/30',
      iconColor: 'text-blue-500',
    },
    indigo: {
      button: isPlaying
        ? 'bg-indigo-600 text-white shadow-indigo-500/25 animate-pulse'
        : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-indigo-500/20',
      progressFill: 'bg-indigo-500',
      badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-500/30 dark:border-indigo-500/30',
      iconColor: 'text-indigo-500',
    },
    emerald: {
      button: isPlaying
        ? 'bg-emerald-600 text-white shadow-emerald-500/25 animate-pulse'
        : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20',
      progressFill: 'bg-emerald-500',
      badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-500/30 dark:border-emerald-500/30',
      iconColor: 'text-emerald-500',
    },
  }[accentColor];

  const resolvedLabel = label || (isTTS ? 'Pronúncia TTSMaker' : 'Áudio do Card');
  const badgeLabel = isTTS ? 'TTS' : accentColor === 'indigo' ? 'Voz' : 'MP3';

  return (
    <div
      className={`my-2.5 p-3 rounded-2xl bg-zinc-100/95 dark:bg-zinc-800/90 border ${colorThemes.border} shadow-sm flex items-center gap-3 transition-all backdrop-blur-md relative select-none`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause Button */}
      <button
        type="button"
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 flex-shrink-0 ${colorThemes.button}`}
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
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
            <Volume2 className={`w-3.5 h-3.5 ${colorThemes.iconColor} flex-shrink-0`} />
            <span className="truncate">{resolvedLabel}</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${colorThemes.badge} flex-shrink-0`}>
              {badgeLabel}
            </span>
          </div>

          <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex-shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Interactive Progress Bar */}
        <div
          onClick={handleSeek}
          className="w-full bg-zinc-200 dark:bg-zinc-700/80 h-2 rounded-full cursor-pointer relative overflow-hidden group"
          title="Clique para avançar/retroceder"
        >
          <div
            className={`h-full ${colorThemes.progressFill} rounded-full transition-all`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Replay Button */}
      <button
        type="button"
        onClick={restart}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors flex-shrink-0"
        title="Reiniciar do começo"
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
    </div>
  );
};
