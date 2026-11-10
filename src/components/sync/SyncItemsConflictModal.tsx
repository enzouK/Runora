import React from 'react';
import { createPortal } from 'react-dom';
import { Cloud, Smartphone, X } from 'lucide-react';
import { SyncItemsChoice, SyncItemsConflict } from '../../services/gdriveSync';
import { useBodyScrollLock } from '../common/useBodyScrollLock';

interface Props {
  conflict: SyncItemsConflict | null;
  onResolve: (choice: SyncItemsChoice) => void;
}

const MAX_SHOWN = 6;

/**
 * Disputa item a item: os mesmos itens mudaram aqui e no Drive.
 * Uma única pergunta — manter a versão deste dispositivo ou a do Drive.
 */
export const SyncItemsConflictModal: React.FC<Props> = ({ conflict, onResolve }) => {
  useBodyScrollLock(!!conflict);
  if (!conflict) return null;

  const items = conflict.items;
  const shown = items.slice(0, MAX_SHOWN);
  const rest = items.length - shown.length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-items-title"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve('abort');
      }}
    >
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => onResolve('abort')}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <h3 id="sync-items-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100 pr-8">
          {items.length === 1 ? '1 item mudou nos dois lados' : `${items.length} itens mudaram nos dois lados`}
        </h3>

        <ul className="mt-3 space-y-1 max-h-40 overflow-y-auto">
          {shown.map((item) => (
            <li
              key={item.key}
              className="text-[13px] text-zinc-700 dark:text-zinc-300 truncate px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/70"
            >
              {item.label}
            </li>
          ))}
          {rest > 0 && (
            <li className="text-[12px] text-zinc-500 dark:text-zinc-400 px-3 pt-1">
              e mais {rest} {rest === 1 ? 'item' : 'itens'}
            </li>
          )}
        </ul>

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => onResolve('local')}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-[13px] font-semibold transition-all active:scale-[0.98]"
          >
            <Smartphone className="w-4 h-4 shrink-0" />
            Deste dispositivo
          </button>
          <button
            type="button"
            onClick={() => onResolve('remote')}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold shadow-sm transition-all active:scale-[0.98]"
          >
            <Cloud className="w-4 h-4 shrink-0" />
            Do Drive
          </button>
          <button
            type="button"
            onClick={() => onResolve('abort')}
            className="w-full px-4 py-2.5 rounded-2xl text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all active:scale-[0.98]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
