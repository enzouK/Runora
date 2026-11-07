import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  /** Conteúdo do botão que abre o popover. */
  trigger: React.ReactNode;
  /** Classe do botão que abre o popover. */
  triggerClassName?: string;
  /** Título (tooltip) do botão. */
  title?: string;
  /** Largura do popover. */
  width?: number;
  /** Alinhar o popover pela direita do botão. */
  alignRight?: boolean;
  /** Conteúdo do popover (recebe o callback para fechar). */
  children: (close: () => void) => React.ReactNode;
}

/**
 * Popover flutuante (renderizado no body, então nunca é cortado pelo
 * scroll da editor). Fecha ao clicar fora ou apertar ESC.
 */
export const Popover: React.FC<PopoverProps> = ({
  trigger,
  triggerClassName = '',
  title,
  width = 220,
  alignRight = false,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimatedHeight = 280;
    const up = rect.bottom + estimatedHeight + 12 > window.innerHeight && rect.top > estimatedHeight;
    setAnchor({
      x: alignRight ? Math.max(8, rect.right - width) : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      y: up ? rect.top - 8 : rect.bottom + 6,
      up,
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        onClick={toggle}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              left: anchor.x,
              top: anchor.y,
              width,
              zIndex: 70,
            }}
            className="rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-700/80 shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-150"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </>
  );
};
