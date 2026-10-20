import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoHintProps {
  /** Explicação exibida no cartão ao clicar no ⓘ. */
  text: string;
  /** Alinhamento do cartão em relação ao ícone. */
  align?: 'left' | 'right';
}

/**
 * ⓘ informativo: clique abre/fecha um cartão de explicação no estilo do app.
 * Fecha ao clicar fora ou pressionar Escape. Funciona em desktop e mobile.
 */
export const InfoHint: React.FC<InfoHintProps> = ({ text, align = 'left' }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`p-0.5 rounded-full transition-colors ${
          open
            ? 'text-ios-blue'
            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
        title="Mais informações"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1.5 z-20 w-60 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.15)] p-3 text-xs font-normal normal-case tracking-normal leading-relaxed text-zinc-600 dark:text-zinc-300 ios-fade-in ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {text}
        </div>
      )}
    </span>
  );
};
