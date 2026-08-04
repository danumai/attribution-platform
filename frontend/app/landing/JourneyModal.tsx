'use client';
import { useEffect, useRef } from 'react';
import * as lp from '@/lib/lp';

/**
 * Native <dialog>, like every other modal in this codebase (see `Dialogs` in lib/ui.tsx).
 *
 * This used to be a div scrim with a hand-rolled Esc listener and manual focus save/restore,
 * on the reasoning that a focus trap was overkill for "two interactive elements". That stopped
 * being true when the body became a <video controls>: tabbing past its controls walked out
 * into the page behind, which was neither inert nor scroll-locked. `showModal()` gives the
 * trap, Esc, the backdrop and page inertness for free, and deletes both effects.
 */
export default function JourneyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `showModal()` on an already-open dialog throws, hence the guards.
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={lp.modalDialog}
      aria-label="The scan-to-payout journey"
      // Esc fires `cancel`; let the parent own `open` rather than letting the browser close
      // the element behind React's back and leave the two out of step.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Click-away. The dialog box fills the top layer, so a click that lands on the element
      // itself rather than on its content is a click on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={`${lp.modal} ${lp.passShell} ${lp.stocked}`}>
        <button className={lp.modalClose} onClick={onClose} aria-label="Close">
          &times;
        </button>
        {/* Mounted only while open, so the recording is not playing behind a closed dialog. */}
        {open && (
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
        )}
        <p className={lp.modalBody}>
          An actual recording of the product — printing a QR code, the scan redirect, the
          publisher’s real signup screen, and the ledger updating with the new redemption.
        </p>
      </div>
    </dialog>
  );
}
