import React, { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

export interface HelpTopic {
  label: string;
  content: React.ReactNode;
}

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Título do painel = nome da seção (ex.: "Limites Diários"). */
  label: string;
  /**
   * 1 tópico → conteúdo direto.
   * Vários → índice de botões no topo + informação da opção selecionada abaixo.
   */
  topics: HelpTopic[];
}

/**
 * Ajuda como "box dentro da box": camada escura sobre o modal + cartão
 * centralizado. Deve ser renderizado DENTRO do card do modal (que precisa
 * de `relative`). Um único tópico mostra o conteúdo direto; vários mostram
 * um índice de botões com a informação abaixo.
 */
export const HelpPanel: React.FC<HelpPanelProps> = ({
  isOpen,
  onClose,
  label,
  topics,
}) => {
  const [selected, setSelected] = useState(0);
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Reinicia a seleção sempre que a camada abre
  useEffect(() => {
    if (isOpen) setSelected(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (layerRef.current?.contains(e.target as Node)) return;
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

  const current = topics[selected];

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col max-h-full ios-fade-in"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">{label}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {topics.length > 1 && (
            <div className="space-y-1.5 mb-4">
              {topics.map((topic, idx) => (
                <button
                  key={topic.label}
                  type="button"
                  onClick={() => setSelected(idx)}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-[12px] text-left text-[13px] font-semibold border transition-all active:scale-[0.99] ${
                    selected === idx
                      ? 'bg-ios-blue/10 text-ios-blue border-ios-blue/30'
                      : 'bg-black/[0.03] dark:bg-white/[0.05] text-zinc-600 dark:text-zinc-300 border-transparent hover:bg-black/[0.06] dark:hover:bg-white/[0.1]'
                  }`}
                >
                  <span className="min-w-0 truncate">{topic.label}</span>
                  {selected === idx && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />}
                </button>
              ))}
            </div>
          )}

          {current && (
            <div
              key={current.label}
              className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 space-y-2 ios-fade-in"
            >
              {current.content}
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
    </div>
  );
};
