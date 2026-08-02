'use client';
import { useState } from 'react';
import JourneyModal from './JourneyModal';

export default function JourneyTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="lp-btn lp-btn-ghost lp-journey-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">&#9654;</span> Watch the journey
      </button>
      <JourneyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
