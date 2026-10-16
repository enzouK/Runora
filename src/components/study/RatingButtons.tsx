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
    classes: string;
    intervalClass: string;
  }[] = [
    {
      rating: 1,
      label: 'Errei',
      sublabel: 'Again',
      keyNum: '1',
      classes:
        'bg-ios-red/10 dark:bg-ios-red/[0.16] hover:bg-ios-red/[0.16] dark:hover:bg-ios-red/[0.22] border-ios-red/20 text-ios-red active:scale-[0.97]',
      intervalClass: 'text-ios-red/80',
    },
    {
      rating: 2,
      label: 'Difícil',
      sublabel: 'Hard',
      keyNum: '2',
      classes:
        'bg-ios-orange/10 dark:bg-ios-orange/[0.16] hover:bg-ios-orange/[0.16] dark:hover:bg-ios-orange/[0.22] border-ios-orange/20 text-ios-orange active:scale-[0.97]',
      intervalClass: 'text-ios-orange/80',
    },
    {
      rating: 3,
      label: 'Bom',
      sublabel: 'Good',
      keyNum: '3',
      classes:
        'bg-ios-blue/10 dark:bg-ios-blue/[0.16] hover:bg-ios-blue/[0.16] dark:hover:bg-ios-blue/[0.22] border-ios-blue/20 text-ios-blue active:scale-[0.97]',
      intervalClass: 'text-ios-blue/80',
    },
    {
      rating: 4,
      label: 'Fácil',
      sublabel: 'Easy',
      keyNum: '4',
      classes:
        'bg-ios-green/10 dark:bg-ios-green/[0.16] hover:bg-ios-green/[0.16] dark:hover:bg-ios-green/[0.22] border-ios-green/20 text-ios-green active:scale-[0.97]',
      intervalClass: 'text-ios-green/80',
    },
  ];

  return (
    <div className="w-full">
      <div className="text-[11px] font-semibold text-center uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2.5">
        Como você se saiu?
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
              className={`relative flex flex-col items-center justify-center py-3 px-2 rounded-[14px] border transition-all ${b.classes} disabled:opacity-50`}
            >
              <span className="text-[13px] font-bold tracking-tight">{b.label}</span>
              <span className={`text-[12px] font-semibold tabular-nums mt-0.5 ${b.intervalClass}`}>
                {intervalText}
              </span>

              {/* Keyboard hint badge */}
              <span className="hidden sm:inline-flex mt-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold opacity-60 bg-black/[0.06] dark:bg-white/[0.12]">
                {b.keyNum}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
