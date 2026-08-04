'use client';
import { useEffect, useRef } from 'react';
import * as lp from '@/lib/lp';

export default function JourneyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Minimal focus management: move focus into the dialog on open, restore it
  // to whatever had focus before (the trigger button) on close. Not a full
  // focus trap -- the dialog has exactly two interactive elements (close
  // button, scrim) and Escape/scrim-click already cover exit.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={lp.modalScrim} onClick={onClose}>
      <div
        className={`${lp.modal} ${lp.passShell} ${lp.stocked}`}
        role="dialog"
        aria-modal="true"
        aria-label="The scan-to-payout journey"
        onClick={(e) => e.stopPropagation()}
      >
        <button className={lp.modalClose} ref={closeRef} onClick={onClose} aria-label="Close">
          &times;
        </button>
        <video
          className={lp.modalVideo}
          src="/journey.webm"
          poster="/journey-poster.png"
          autoPlay
          muted
          loop
          playsInline
          controls
        />
        <p className={lp.modalBody}>
          An actual recording of the product — printing a QR code, the scan redirect, the
          publisher’s real signup screen, and the ledger updating with the new redemption.
        </p>
      </div>
    </div>
  );
}
