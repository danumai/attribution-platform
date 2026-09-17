'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import * as lp from '@/lib/lp';

// The modal carries a <video>; splitting it out keeps that code (and the client-only
// dialog logic) out of the main landing bundle. It's still mounted unconditionally below
// (only `open` toggles it), so this doesn't delay the fetch until the button is clicked —
// only conditionally rendering `<JourneyModal>` itself would do that.
const JourneyModal = dynamic(() => import('./JourneyModal'), { ssr: false });

export default function JourneyTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${lp.btnGhost} ${lp.journeyTrigger}`} onClick={() => setOpen(true)}>
        <span aria-hidden="true">&#9654;</span> Watch the journey
      </button>
      <JourneyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
