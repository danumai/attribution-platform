import { ReactNode } from 'react';
import * as lp from '@/lib/lp';

/**
 * The eyebrow + h2 + sub block that opens every section on the landing page. Extracted because
 * it repeats seven times with only the text changing — the real duplication in this file, more
 * than any individual <section> wrapper.
 */
export default function SectionHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  /** e.g. <JourneyTrigger /> under "How it works" — optional, most sections have none */
  children?: ReactNode;
}) {
  return (
    <div className={lp.sectionHead}>
      <span className={lp.eyebrow}>{eyebrow}</span>
      <h2 className={lp.h2}>{title}</h2>
      <p className={lp.sub}>{sub}</p>
      {children}
    </div>
  );
}