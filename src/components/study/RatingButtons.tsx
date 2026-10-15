import React from 'react';
import { FSRSPrediction, FSRSRating } from '../../types/anki';

interface RatingButtonsProps {
  predictions: Record<FSRSRating, FSRSPrediction> | null;
  onRate: (rating: FSRSRating) => void;
  disabled?: boolean;
}

export const RatingButtons: React.FC<RatingButtonsProps> = ({
  predictions,
  onRate,
  disabled = false,
}) => {
  const buttons: {
    rating: FSRSRating;
    label: string;
    sublabel: string;
    keyNum: string;
    bgClass: string;
    hoverClass: string;
    borderClass: string;
    textClass: string;
    timeClass: string;
  }[] = [
    {
      rating: 1,
      label: 'Errei',
      sublabel: 'Again',
      keyNum: '1',
      bgClass: 'bg-rose-50/80 dark:bg-rose-950/30',
      hoverClass: 'hover:bg-rose-100 dark:hover:bg-rose-900/40 active:scale-[0.98]',
      borderClass: 'border-rose-200 dark:border-rose-900/60',
      textClass: 'text-rose-700 dark:text-rose-300',
      timeClass: 'text-rose-600 dark:text-rose-400 font-bold',
    },
    {
      rating: 2,
      label: 'Difícil',
      sublabel: 'Hard',
      keyNum: '2',
      bgClass: 'bg-amber-50/80 dark:bg-amber-950/30',
      hoverClass: 'hover:bg-amber-100 dark:hover:bg-amber-900/40 active:scale-[0.98]',
      borderClass: 'border-amber-200 dark:border-amber-900/60',
      textClass: 'text-amber-800 dark:text-amber-300',
      timeClass: 'text-amber-700 dark:text-amber-400 font-bold',
    },
    {
      rating: 3,
      label: 'Bom',
      sublabel: 'Good',
      keyNum: '3',
      bgClass: 'bg-blue-50/80 dark:bg-blue-950/30',
      hoverClass: 'hover:bg-blue-100 dark:hover:bg-blue-900/40 active:scale-[0.98]',
      borderClass: 'border-blue-200 dark:border-blue-900/60',
      textClass: 'text-blue-700 dark:text-blue-300',
      timeClass: 'text-blue-600 dark:text-blue-400 font-bold',
    },
    {
      rating: 4,
      label: 'Fácil',
      sublabel: 'Easy',
      keyNum: '4',
      bgClass: 'bg-emerald-50/80 dark:bg-emerald-950/30',
      hoverClass: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/40 active:scale-[0.98]',
      borderClass: 'border-emerald-200 dark:border-emerald-900/60',
      textClass: 'text-emerald-700 dark:text-emerald-300',
      timeClass: 'text-emerald-600 dark:text-emerald-400 font-bold',
    },
  ];

  return (
    <div className="w-full">
      <div className="text-[11px] font-semibold text-center uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
        Classificação FSRS (Intervalo Calculado)
      </div>
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {buttons.map((b) => {
          const prediction = predictions ? predictions[b.rating] : null;
          const intervalText = prediction ? prediction.intervalText : '...';

          return (
            <button
              key={b.rating}
              type="button"
              disabled={disabled}
              onClick={() => onRate(b.rating)}
              className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border transition-all shadow-sm ${b.bgClass} ${b.hoverClass} ${b.borderClass} ${b.textClass} disabled:opacity-50`}
            >
              <span className="text-xs sm:text-sm font-bold tracking-tight">
                {b.label}
              </span>
              <span className={`text-[11px] sm:text-xs mt-0.5 font-mono ${b.timeClass}`}>
                {intervalText}
              </span>

              {/* iOS style keyboard hint badge */}
              <span className="hidden sm:inline-flex mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono opacity-60 bg-black/5 dark:bg-white/10">
                {b.keyNum}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
