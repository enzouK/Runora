import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useBodyScrollLock } from '../common/useBodyScrollLock';

export type ImportProgressPhase = 'reading' | 'comparing' | 'applying';

export interface ImportProgressState {
  phase: ImportProgressPhase;
  /** Parte em andamento (contador detalhado): notas, cards ou mídia. */
  part?: 'notes' | 'cards' | 'media';
  done: number;
  total: number;
}

interface Props {
  progress: ImportProgressState | null;
}

const PHASE_TITLE: Record<ImportProgressPhase, string> = {
  reading: 'Lendo arquivo…',
  comparing: 'Comparando com sua coleção…',
  applying: 'Aplicando…',
};

const PART_LABEL: Record<'notes' | 'cards' | 'media', string> = {
  notes: 'notas',
  cards: 'cards',
  media: 'arquivos de mídia',
};

/**
 * Painel de progresso da importação (Fase 3).
 *
 * Mostra as três etapas (lendo → comparando → aplicando), o contador vivo
 * de itens e uma animação de cartas sendo distribuídas — para o usuário
 * saber que o app está trabalhando e não travado. A gravação acontece em
 * lotes pequenos, então o contador anda de poucos em poucos.
 */
export const ImportProgressOverlay: React.FC<Props> = ({ progress }) => {
  useBodyScrollLock(!!progress);
  if (!progress) return null;

  const { phase, part, done, total } = progress;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const itemLabel = part ? PART_LABEL[part] : '';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl text-center">
        {/* Cards being dealt — the "working" cue */}
        <div className="flex items-end justify-center gap-2 h-20 mb-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="runora-card-deal w-12 h-16 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-gradient-to-b from-white to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 shadow-md flex items-center justify-center"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <div
                className="runora-card-float w-7 h-9 rounded-md border border-ios-blue/25 bg-ios-blue/10"
                style={{ animationDelay: `${i * 0.25}s` }}
              />
            </div>
          ))}
        </div>

        <h3 className="text-[16px] font-bold text-zinc-900 dark:text-white">
          {PHASE_TITLE[phase]}
        </h3>

        {/* Live counter */}
        {part && total > 0 ? (
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1 tabular-nums">
            {done} de {total} {itemLabel}
          </p>
        ) : (
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">
            {phase === 'reading'
              ? 'Abrindo o pacote…'
              : 'Preparando o plano…'}
          </p>
        )}

        {/* Progress bar */}
        <div className="mt-4 h-2 w-full rounded-full bg-black/[0.07] dark:bg-white/[0.12] overflow-hidden">
          <div
            className={`h-full rounded-full bg-ios-blue transition-[width] duration-150 ease-out ${
              phase === 'applying' && part ? 'runora-progress-shimmer' : ''
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {phase === 'applying' && part && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <Loader2 className="w-3 h-3 animate-spin" />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
