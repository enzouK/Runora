import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface IOSSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface IOSSelectProps {
  value: string;
  options: IOSSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  maxMenuHeight?: number;
}

/**
 * Elegant iOS-style dropdown: rounded pill trigger with chevron and a
 * floating frosted-glass option list with a checkmark on the selection.
 * Rendered in a portal so it is never clipped by overflow containers.
 */
export const IOSSelect: React.FC<IOSSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Selecionar…',
  className = '',
  maxMenuHeight = 240,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    const openedAt = Date.now();
    const handlePointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const handleScroll = (e: Event) => {
      // Ignore scrolls from inside the menu and the immediate layout-adjustment
      // scroll that some scrollable containers emit right after the menu mounts
      if (menuRef.current?.contains(e.target as Node)) return;
      if (Date.now() - openedAt < 200) return;
      setIsOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  const toggle = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = Math.min(options.length * 36 + 14, maxMenuHeight);
    const openUp = rect.bottom + menuHeight + 12 > window.innerHeight;
    setAnchor({
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
      y: openUp ? rect.top - menuHeight - 6 : rect.bottom + 6,
      w: Math.max(rect.width, 200),
      up: openUp,
    });
    setIsOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-100 hover:border-zinc-300 dark:hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${className}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={selected ? '' : 'text-zinc-400'}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: anchor.x,
              top: anchor.y,
              width: anchor.w,
              maxHeight: maxMenuHeight,
              zIndex: 70,
            }}
            className="overflow-y-auto rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-700/80 shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-150"
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs text-left transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.hint && (
                      <span className="block text-[10px] text-zinc-400 mt-0.5">{opt.hint}</span>
                    )}
                  </span>
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
};
