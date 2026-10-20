import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';

interface InfoHintProps {
  /** Explicação exibida no cartão ao clicar no ⓘ (texto simples ou parágrafos). */
  text?: string;
  /** Alternativa rica ao `text`: JSX com múltiplos parágrafos, negritos etc. */
  children?: React.ReactNode;
  /** Lado do ícone pelo qual o cartão se alinha horizontalmente. */
  align?: 'left' | 'right';
}

const CARD_WIDTH = 240;

/**
 * ⓘ informativo: clique abre/fecha um cartão de explicação renderizado em
 * portal (position: fixed), imune a overflow-hidden e bordas do modal.
 * Fecha ao clicar fora ou pressionar Escape. Funciona em desktop e mobile.
 */
export const InfoHint: React.FC<InfoHintProps> = ({ text, children, align = 'left' }) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || cardRef.current?.contains(t)) return;
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

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const openUp = rect.bottom + 220 + 12 > window.innerHeight;
    setAnchor({
      x:
        align === 'right'
          ? Math.max(8, rect.right - CARD_WIDTH)
          : Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8)),
      y: openUp ? Math.max(8, rect.top - 220 - 8) : rect.bottom + 8,
      up: openUp,
    });
    setOpen(true);
  };

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={`p-0.5 rounded-full transition-colors ${
          open ? 'text-ios-blue' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
        title="Mais informações"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={cardRef}
            style={{
              position: 'fixed',
              left: anchor.x,
              top: anchor.y,
              width: CARD_WIDTH,
              maxHeight: anchor.up ? anchor.y - 16 : window.innerHeight - anchor.y - 16,
              zIndex: 80,
            }}
            className="overflow-y-auto rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.15)] p-3 text-xs font-normal normal-case tracking-normal leading-relaxed text-zinc-600 dark:text-zinc-300 ios-fade-in"
          >
            {children ?? text}
          </div>,
          document.body
        )}
    </span>
  );
};
