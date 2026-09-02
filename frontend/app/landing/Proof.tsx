'use client';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

/**
 * Social proof, without inventing any: the rail lists the *kinds* of app a scan can land in rather
 * than borrowed brand marks.
 */

const SECTORS = [
  'Travel apps',
  'Fintech',
  'Grocery delivery',
  'Ride hailing',
  'Streaming',
  'Ticketing',
  'Loyalty programs',
  'Marketplaces',
];

const QUOTES = [
  {
    body: 'Placeholder — replace with a real promoter quote about paying only for confirmed signups.',
    who: 'Name, role',
    org: 'Promoter organization',
    mark: '01',
  },
  {
    body: 'Placeholder — replace with a real publisher quote about setting its own verification bar.',
    who: 'Name, role',
    org: 'Publisher organization',
    mark: '02',
  },
  {
    body: 'Placeholder — replace with a real quote about voiding a leaked print run, or delete this card.',
    who: 'Name, role',
    org: 'Organization',
    mark: '03',
  },
];

export default function Proof() {
  // The marquee is an infinite animation, so it is gated on visibility the same way the
  // scan loop is — an off-screen band should not be spending frames.
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <>
      <div className={lp.marquee} ref={ref} data-run={inView || undefined}>
        {/* Two identical tracks. The first scrolls a full track-width left, at which point
            the second sits exactly where the first began — so the loop has no seam. The
            copy is decorative repetition, hence aria-hidden. */}
        {[false, true].map((dupe) => (
          <div className={lp.marqueeTrack} key={String(dupe)} aria-hidden={dupe || undefined}>
            {SECTORS.map((s) => (
              <span className={lp.marqueeItem} key={s}>
                {s}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className={lp.quotes}>
        {QUOTES.map((q) => (
          <figure className={lp.quote} key={q.mark}>
            <blockquote className={lp.quoteBody}>{q.body}</blockquote>
            <figcaption className={lp.quoteWho}>
              <span className={lp.quoteMark} aria-hidden="true">
                {q.mark}
              </span>
              <span>
                <b>{q.who}</b>
                <span>{q.org}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}
