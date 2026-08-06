/**
 * The auth card: a form panel carrying the words and a tinted side panel carrying the
 * page's own facts. Login, the 404 and the dead-code page are all the same surface, so the
 * composition lives here once rather than in three copies.
 */
import { ReactNode } from 'react';
import { TicketMark } from '@/lib/mark';
import { cx, riseStagger, stamp } from '@/lib/tw';

/** the page frame the card sits on */
export const passPage = cx(
  'relative z-1 mx-auto max-w-[860px] px-5 pt-[min(8vh,72px)] pb-24 max-[560px]:pt-8',
  riseStagger,
);

export function Pass({ single, children }: { single?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        'relative isolate grid overflow-hidden rounded-2xl border border-line bg-card shadow-pass',
        single
          ? 'grid-cols-[minmax(0,1fr)]'
          : 'grid-cols-[minmax(0,1fr)_260px] max-[760px]:grid-cols-[minmax(0,1fr)]',
      )}
    >
      {children}
    </div>
  );
}

export function Coupon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('px-9 pt-9 pb-8 max-[560px]:px-6 max-[560px]:pt-7 max-[560px]:pb-6', className)}>
      {children}
    </div>
  );
}

export function Brand() {
  return (
    <div className="mb-7 flex items-center gap-2.5">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink [&_svg]:size-4.5 [&_svg]:fill-current"
        aria-hidden="true"
      >
        <TicketMark />
      </span>
      <b className="text-[14px] font-semibold tracking-[-0.014em]">QR Reward Platform</b>
    </div>
  );
}

export const passTitle =
  'mt-6 mb-2 text-[clamp(22px,4vw,28px)] font-semibold leading-[1.18] tracking-[-0.026em] text-balance';

export const passLede = 'mb-2 max-w-[46ch] text-[14px] text-mut';

export const passNote =
  'mt-6 border-t border-line-soft pt-4 text-[13px] leading-[1.55] text-mut';

/** a status mark called out on the card, not a status line */
export function PassStamp({ children, posted }: { children: ReactNode; posted?: boolean }) {
  return (
    <span
      className={cx(
        'inline-grid place-items-center rounded-full border px-3.5 py-1.5',
        'text-[13px] font-semibold tracking-[-0.006em]',
        posted ? 'border-ok-line bg-ok-soft text-ok' : 'border-bad-line bg-bad-soft text-bad',
      )}
    >
      {children}
    </span>
  );
}

/** The tear line between the two panels is gone; the side panel's own tint is the division. */
export function Perf() {
  return null;
}

/** the side panel: the page's own facts, on a tinted ground */
export function Stub({ children }: { children: ReactNode }) {
  return (
    <aside
      className={cx(
        'relative flex flex-col gap-5 border-l border-line bg-card-alt px-6 py-9',
        'max-[760px]:border-l-0 max-[760px]:border-t max-[760px]:px-6 max-[760px]:py-6',
      )}
    >
      {children}
    </aside>
  );
}

export function Fields({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-4">
      {items.map(([dt, dd]) => (
        <div key={dt}>
          <dt className={stamp}>{dt}</dt>
          <dd className="mt-1 text-[13.5px] font-medium tracking-[-0.008em] text-ink">{dd}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Serial({ items }: { items: string[] }) {
  return (
    <p className="mt-auto flex gap-3.5 border-t border-line pt-3.5 font-mono text-[11px] text-mut">
      {items.map((s) => (
        <span key={s}>{s}</span>
      ))}
    </p>
  );
}
