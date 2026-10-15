import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';
import { AudioService } from '../../services/audioService';
import { AudioPlayer } from './AudioPlayer';

interface VoiceRecorderProps {
  onRecordingComplete: (blobUrl: string | null) => void;
  recordedAudioUrl: string | null;
  disabled?: boolean;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  recordedAudioUrl,
  disabled = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRecording) {
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const handleStart = async () => {
    setErrorMsg(null);
    const success = await AudioService.startRecording();
    if (success) {
      setIsRecording(true);
    } else {
      setErrorMsg('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const handleStop = async () => {
    setIsRecording(false);
    const blobUrl = await AudioService.stopRecording();
    onRecordingComplete(blobUrl);
  };

  const handleClear = () => {
    AudioService.cleanupCurrentRecording();
    onRecordingComplete(null);
  };

  return (
    <div className="w-full my-3 p-3.5 rounded-2xl bg-zinc-50/90 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            Treino de Fala / Pronúncia (Gravação Temporária)
          </span>
        </div>
        {isRecording && (
          <span className="text-xs font-mono font-bold text-red-500">
            00:{seconds < 10 ? `0${seconds}` : seconds}
          </span>
        )}
      </div>

      {errorMsg && (
        <p className="text-xs text-red-500 mb-2">{errorMsg}</p>
      )}

      {!isRecording && !recordedAudioUrl && (
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/15 text-red-600 dark:text-red-400 font-medium text-sm transition-all border border-red-500/20 active:scale-[0.99]"
        >
          <Mic className="w-4 h-4" />
          <span>Gravar Minha Voz (Record Voice)</span>
        </button>
      )}

      {isRecording && (
        <div className="flex items-center justify-between gap-3 p-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
          <div className="flex items-center gap-2">
            <div className="flex items-end gap-0.5 h-5 px-1">
              <span className="w-1 h-3 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-5 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-2 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="w-1 h-4 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
            </div>
            <span className="text-xs font-medium text-red-600 dark:text-red-400">Gravando áudio...</span>
          </div>

          <button
            type="button"
            onClick={handleStop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Parar Gravação</span>
          </button>
        </div>
      )}

      {recordedAudioUrl && !isRecording && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <AudioPlayer src={recordedAudioUrl} label="Sua Gravação (Frente)" accentColor="indigo" />
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="p-2 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              title="Apagar e regravar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 italic">
            ✓ Áudio em memória. Ao virar o card, compare com o áudio nativo.
          </p>
        </div>
      )}
    </div>
  );
};
