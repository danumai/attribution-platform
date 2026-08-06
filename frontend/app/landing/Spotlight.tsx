'use client';
import type { ReactNode } from 'react';

/* Wraps a grid of cards and feeds the pointer position to whichever [data-spot] card is under
 * it, so the card can paint a sheen at the cursor (see .lp [data-spot]::before in landing.css).
 * One listener on the container rather than one per card, and children stay server-rendered. */
export default function Spotlight({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-spot]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
