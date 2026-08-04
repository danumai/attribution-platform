'use client';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

// The ambient glow loops forever, so — same as ScanStub's validation loop —
// it only runs while actually on screen, gated via data-run.
export default function HeroGlow() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return <div className={lp.heroGlow} aria-hidden="true" ref={ref} data-run={inView ? '' : undefined} />;
}
