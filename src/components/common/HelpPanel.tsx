import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';

export interface HelpTopic {
  label: string;
  content: React.ReactNode;
}

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  topics: HelpTopic[];
}

/**
 * Painel de ajuda estilo Anki: drawer fixo à direita com a lista de tópicos.
 * Clicar em um tópico expande a explicação (accordion, um aberto por vez).
 * Renderizado em portal — imune a overflow-hidden e transforms de ancestrais.
 */
export const HelpPanel: React.FC<HelpPanelProps> = ({
  isOpen,
  onClose,
  title = 'Ajuda',
  topics,
}) => {
  const [openTopic, setOpenTopic] = useState<number | null>(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Reinicia o accordion sempre que o painel abre
  useEffect(() => {
    if (isOpen) setOpenTopic(topics.length > 0 ? 0 : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed top-0 right-0 h-full w-[340px] max-w-[90vw] z-[90] bg-white dark:bg-ios-card-dark border-l border-black/[0.06] dark:border-white/[0.08] shadow-[-10px_0_40px_rgba(0,0,0,0.15)] flex flex-col ios-fade-in"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
        <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {topics.map((topic, idx) => {
          const expanded = openTopic === idx;
          return (
            <div
              key={topic.label}
              className="rounded-[14px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenTopic(expanded ? null : idx)}
                className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left"
              >
                <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                  {topic.label}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {expanded && (
                <div className="px-3.5 pb-3.5 text-xs font-normal leading-relaxed text-zinc-600 dark:text-zinc-300 space-y-2">
                  {topic.content}
                </div>
              )}
            </div>
          );
        })}

        {topics.length === 0 && (
          <p className="text-[13px] text-zinc-400 py-2">Nenhuma informação disponível.</p>
        )}
      </div>
    </div>,
    document.body
  );
};
