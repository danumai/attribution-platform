'use client';
import { useEffect, useState } from 'react';

const STEPS = [
  { key: 'print', label: 'Print', body: 'Design and export a print-ready QR code.' },
  { key: 'scan', label: 'Scan', body: 'A phone scans it and opens the publisher’s store listing.' },
  { key: 'signup', label: 'Signup', body: 'The user signs up; the install is matched server-to-server.' },
  { key: 'ledger', label: 'Ledger', body: 'The fee posts from campaign budget to the publisher, atomically.' },
] as const;

const STEP_MS = 1800;

export default function JourneyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % STEPS.length);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="lp-journey-modal-scrim" onClick={onClose}>
      <div
        className="lp-journey-modal lp-pass-shell lp-stocked"
        role="dialog"
        aria-modal="true"
        aria-label="The scan-to-payout journey"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lp-journey-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <div className="lp-journey lp-journey-modal-inner">
          {STEPS.map((s, i) => (
            <div className="lp-journey-point" key={s.key} data-active={i === active ? '' : undefined}>
              <span className="lp-journey-dot" />
              <span className="lp-journey-label">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="lp-journey-modal-body">{STEPS[active].body}</p>
      </div>
    </div>
  );
}
