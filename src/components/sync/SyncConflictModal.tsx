import React from 'react';
import { createPortal } from 'react-dom';
import { CloudDownload, CloudUpload, X } from 'lucide-react';
import { ConflictChoice } from '../../services/gdriveSync';
import { SyncConflictState } from './useDriveSync';

interface Props {
  conflict: SyncConflictState | null;
  onResolve: (choice: ConflictChoice) => void;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * AnkiWeb-style conflict dialog: a newer backup exists in Drive AND this
 * device has unsynced local changes. Exactly the question the user asked for:
 * "Baixar conteúdo do último backup ou manter deste dispositivo?"
 * - Baixar → replace local data with the Drive backup (local state is backed
 *   up first).
 * - Manter → upload this device's data, REPLACING the Drive backup.
 * - X / backdrop / Esc → abort, nothing changes.
 */
export const SyncConflictModal: React.FC<Props> = ({ conflict, onResolve }) => {
  if (!conflict) return null;
  const { meta } = conflict;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-conflict-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      // mousedown (not click): a text-selection drag released over the backdrop must not close
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve('abort');
      }}
    >
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-5">
        <button
          type="button"
          onClick={() => onResolve('abort')}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <CloudDownload className="w-6 h-6 stroke-[2]" />
          </div>
          <div className="space-y-1.5 pt-0.5 pr-6">
            <h3 id="sync-conflict-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
              Backup mais recente no Drive
            </h3>
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 leading-relaxed">
              Baixar conteúdo do último backup ou manter deste dispositivo?
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Backup de <span className="font-semibold">{meta.deviceName}</span> enviado em{' '}
              {fmt(meta.uploadedAt)} — {meta.counts.decks} decks, {meta.counts.notes} notas,{' '}
              {meta.counts.cards} cards, {meta.counts.media} arquivos de mídia. Este dispositivo
              também tem alterações não sincronizadas.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onResolve('download')}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold shadow-sm transition-all active:scale-[0.98]"
          >
            <CloudDownload className="w-4 h-4 shrink-0" />
            <span className="text-left">
              Baixar do Drive
              <span className="block text-[11px] font-normal text-blue-100/90">
                substitui os dados deste dispositivo (um backup local é guardado antes)
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onResolve('keep')}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-[13px] font-semibold transition-all active:scale-[0.98]"
          >
            <CloudUpload className="w-4 h-4 shrink-0" />
            <span className="text-left">
              Manter deste dispositivo
              <span className="block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                envia estes dados e substitui o último backup no Drive (estilo AnkiWeb)
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
