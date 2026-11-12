import React from 'react';
import { createPortal } from 'react-dom';
import { FileUp, Layers, Database, AlertTriangle, Loader2, X } from 'lucide-react';
import {
  type ImportConflictMode,
  type ImportPlanSummary,
} from '../../services/importPlan';
import { useBodyScrollLock } from '../common/useBodyScrollLock';

interface Props {
  summary: ImportPlanSummary;
  fileName: string;
  /** Apply already running — buttons disabled. */
  applying: boolean;
  onApply: (mode: ImportConflictMode) => void;
  onCancel: () => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Import plan preview (Fase 2): BEFORE anything is written, shows what the
 * import is going to do — "X notas novas • Y já existentes" e os decks/mídia
 * incluídos — e, quando há notas repetidas, pergunta o que fazer com o
 * conteúdo: "Sobrescrever" ou "Manter" (+ Cancelar).
 *
 * Quando o arquivo é cem por cento igual ao que já existe aqui, nada é
 * aplicado: mostra "Nenhuma mudança feita" e o único botão é "Entendido".
 */
export const ImportPreviewModal: React.FC<Props> = ({
  summary,
  fileName,
  applying,
  onApply,
  onCancel,
}) => {
  useBodyScrollLock(!!summary);
  if (!summary) return null;
  const s = summary;
  // Disputa de conteúdo = mesma nota (mesma identidade) com CONTEÚDO diferente.
  const hasContentConflicts = s.conflictingNotesCount > 0;
  // Cards que já existem aqui mas com AGENDAMENTO (datas) diferente no arquivo.
  const hasScheduleChanges = s.changedCardsCount > 0;
  const hasConflicts = hasContentConflicts || hasScheduleChanges;
  const hasAnythingNew =
    s.newNotesCount > 0 ||
    s.newCardsCount > 0 ||
    s.newDeckNames.length > 0 ||
    s.newNoteTypeNames.length > 0 ||
    s.newRevlogCount > 0 ||
    s.changedDecksCount > 0 ||
    hasConflicts;
  const nothingNew = !hasAnythingNew;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-preview-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      // mousedown (not click): a drag ending over the backdrop must not close
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !applying) onCancel();
      }}
    >
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-5">
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-ios-blue/10 text-ios-blue border border-ios-blue/20">
            <FileUp className="w-6 h-6 stroke-[2]" />
          </div>
          <div className="min-w-0">
            <h2
              id="import-preview-title"
              className="text-[17px] font-bold text-zinc-900 dark:text-white leading-snug"
            >
              Importar coleção
            </h2>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 break-all">
              {fileName}
            </p>
          </div>
        </div>

        {/* Plan summary — nothing written yet, this is the "comparing" answer */}
        <div className="rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3.5 space-y-2 text-[13px]">
          <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
            <Database className="w-4 h-4 text-ios-blue shrink-0" />
            <span className="font-semibold">
              {plural(s.newNotesCount, 'nota nova', 'notas novas')}
              {s.existingNotesCount > 0 && (
                <span className="font-normal text-zinc-500 dark:text-zinc-400">
                  {' '}• {plural(s.existingNotesCount, 'já existente', 'já existentes')}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
            <Layers className="w-4 h-4 text-ios-blue shrink-0" />
            <span className="font-semibold">
              {plural(s.newCardsCount, 'card novo', 'cards novos')}
            </span>
          </div>

          {(s.newDeckNames.length > 0 ||
            s.existingDecksCount > 0 ||
            s.changedCardsCount > 0 ||
            s.changedDecksCount > 0 ||
            s.newRevlogCount > 0 ||
            typeof s.mediaCount === 'number') && (
            <div className="pt-1.5 border-t border-black/[0.05] dark:border-white/[0.06] text-[12px] text-zinc-500 dark:text-zinc-400 space-y-1">
              {s.newDeckNames.length > 0 && (
                <div>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    {plural(s.newDeckNames.length, 'deck novo', 'decks novos')}:
                  </span>{' '}
                  {s.newDeckNames.slice(0, 4).join(', ')}
                  {s.newDeckNames.length > 4 && ` +${s.newDeckNames.length - 4}`}
                </div>
              )}
              {s.existingDecksCount > 0 && (
                <div>{plural(s.existingDecksCount, 'deck já existente', 'decks já existentes')}.</div>
              )}
              {s.changedDecksCount > 0 && (
                <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                  {plural(s.changedDecksCount, 'deck com opções diferentes', 'decks com opções diferentes')}.
                </div>
              )}
              {s.changedCardsCount > 0 && (
                <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                  {plural(s.changedCardsCount, 'card com data diferente', 'cards com datas diferentes')}.
                </div>
              )}
              {s.newRevlogCount > 0 && (
                <div>{plural(s.newRevlogCount, 'revisão nova', 'revisões novas')}.</div>
              )}
              {typeof s.mediaCount === 'number' && s.mediaCount > 0 && (
                <div>{plural(s.mediaCount, 'arquivo de mídia', 'arquivos de mídia')} incluídos.</div>
              )}
            </div>
          )}

          {nothingNew && (
            <div className="pt-1.5 border-t border-black/[0.05] dark:border-white/[0.06] text-[12px] font-semibold text-zinc-600 dark:text-zinc-300">
              Nenhuma mudança a ser feita.
            </div>
          )}
        </div>

        {hasConflicts && !nothingNew && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-[13px]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {hasContentConflicts ? 'Notas repetidas no arquivo' : 'Cards com datas diferentes'}
            </div>
            <p className="text-[13px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed mt-1">
              {hasContentConflicts && (
                <>
                  {plural(s.conflictingNotesCount, 'nota já está na sua coleção', 'notas já estão na sua coleção')}.{' '}
                </>
              )}
              {hasScheduleChanges && (
                <>
                  {plural(s.changedCardsCount, 'card tem data diferente', 'cards têm datas diferentes')}.{' '}
                </>
              )}
              O que fazer?
            </p>
          </div>
        )}

        {/* Nothing new at all: just acknowledge (no apply, nothing changes) */}
        {nothingNew && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full flex items-center justify-center px-4 py-3 rounded-2xl bg-ios-blue text-white font-semibold text-[15px] hover:bg-ios-blue/90 active:scale-[0.98] transition-all"
          >
            Entendido
          </button>
        )}

        {/* Conflicts: the single question — Sobrescrever ou Manter */}
        {hasConflicts && hasAnythingNew && (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onApply('overwrite')}
              disabled={applying}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-ios-blue text-white font-semibold text-[15px] hover:bg-ios-blue/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-wait"
              title="O conteúdo do arquivo vence; o que só existe aqui continua. Nas datas dos cards, fica a versão estudada mais recentemente."
            >
              {applying && <Loader2 className="w-4 h-4 animate-spin" />}
              Sobrescrever
            </button>
            <button
              type="button"
              onClick={() => onApply('keep')}
              disabled={applying}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-black/[0.05] dark:bg-white/[0.08] text-zinc-800 dark:text-zinc-200 font-semibold text-[15px] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-wait"
              title="As notas e os cards que já existem aqui não são tocados; só os novos entram."
            >
              Manter
            </button>
          </div>
        )}

        {/* Only new items: straight to the point */}
        {!hasConflicts && hasAnythingNew && (
          <button
            type="button"
            onClick={() => onApply('overwrite')}
            disabled={applying}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-ios-blue text-white font-semibold text-[15px] hover:bg-ios-blue/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            {applying && <Loader2 className="w-4 h-4 animate-spin" />}
            Importar
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};
