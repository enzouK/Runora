import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

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
 * Ajuda estilo Anki: cartão flutuante centralizado sobre o modal (fundo
 * borrado). Com um único tópico, mostra o conteúdo direto; com vários,
 * lista-os como accordion (um aberto por vez).
 * Renderizado em portal — imune a overflow-hidden e transforms de ancestrais.
 */
export const HelpPanel: React.FC<HelpPanelProps> = ({
  isOpen,
  onClose,
  title = 'Ajuda',
  topics,
}) => {
  const [openTopic, setOpenTopic] = useState<number | null>(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Reinicia o accordion sempre que o painel abre
  useEffect(() => {
    if (isOpen) setOpenTopic(topics.length > 0 ? 0 : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
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

  const single = topics.length === 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col max-h-[80vh] ios-fade-in"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
            {single ? topics[0].label : title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {single ? (
            <div className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 space-y-2">
              {topics[0].content}
            </div>
          ) : (
            <div className="space-y-2">
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
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.07]">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Entendido</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
