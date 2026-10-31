import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
   * Styled in-app confirmation modal (iOS alert style).
   */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      // onMouseDown (not onClick): a text-selection drag that starts inside the
      // modal and is released over the backdrop must NOT close it.
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col ios-fade-in">
        <div className="p-6 text-center space-y-2.5">
          {confirmVariant === 'danger' && (
            <div className="w-12 h-12 rounded-full bg-ios-red/10 text-ios-red flex items-center justify-center mx-auto mb-1">
              <AlertTriangle className="w-6 h-6" />
            </div>
          )}
          <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">{title}</h3>
          <div className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{message}</div>
        </div>
        <div className="grid grid-cols-2 border-t border-black/[0.05] dark:border-white/[0.07]">
          <button
            type="button"
            onClick={onCancel}
            className="py-3.5 text-[14px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors border-r border-black/[0.05] dark:border-white/[0.07]"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`py-3.5 text-[14px] font-bold transition-colors ${
              confirmVariant === 'danger'
                ? 'text-ios-red hover:bg-ios-red/10'
                : 'text-ios-blue hover:bg-ios-blue/10'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
