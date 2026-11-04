import { useEffect } from 'react';

/**
 * Locks <body> scrolling while any overlay (modal / drawer / fullscreen
 * viewer) is open. Reference-counted so modals stacked on top of each other
 * (e.g. a ConfirmationModal inside CardEditorModal) never unlock the body
 * early: each consumer registers one count while open, the body is restored
 * only when the last one closes. The previous inline overflow value is
 * preserved so a page that intentionally scrolled cannot be reset.
 */
let lockCount = 0;
let previousOverflow = '';

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    lockCount += 1;
    if (lockCount === 1) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [locked]);
}
