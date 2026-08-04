'use client';
import { useState } from 'react';
import JourneyModal from './JourneyModal';
import * as lp from '@/lib/lp';

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
