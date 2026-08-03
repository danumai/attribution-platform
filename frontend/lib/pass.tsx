/**
 * The full pass: a coupon carrying the words, a tear line, and a stub carrying the
 * ticket's own printed facts. Login, the 404 and the dead-code page are all the same
 * instrument, so the composition lives here once rather than in three copies.
 */
import { ReactNode } from 'react';
import { TicketMark } from '@/lib/mark';
import { cx, riseStagger, stamp } from '@/lib/tw';

/** the page frame the pass sits on */
export const passPage = cx(
  'relative z-1 mx-auto max-w-[900px] px-5 pt-[min(7vh,56px)] pb-24 max-[560px]:pt-6',
  riseStagger,
);

/** laid fibre in the card surface — the tooth you feel on real ticket stock */
const FIBRE =
  "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:content-[''] " +
  'before:bg-[image:var(--fibre)] before:bg-[length:120px_120px] before:opacity-[.055] ' +
  'before:[mix-blend-mode:multiply]';

export function Pass({ single, children }: { single?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        'relative isolate grid overflow-hidden rounded-xl border border-line bg-card shadow-contact',
        single ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_30px_230px] max-[760px]:grid-cols-[minmax(0,1fr)]',
        FIBRE,
      )}
    >
      {children}
    </div>
  );
}

export function Coupon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('px-10.5 pt-10 pb-9 max-[560px]:px-5.5 max-[560px]:pt-7.5 max-[560px]:pb-6.5', className)}>
      {children}
    </div>
  );
}

export function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2.25 [&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:fill-ink">
      <TicketMark />
      <b className="text-sm font-[650] tracking-[-0.015em]">QR Reward Platform</b>
    </div>
  );
}

/** letterpress: the type is struck into the stock, lit from above */
export const passTitle =
  'mt-5.5 mb-2 font-display text-[clamp(26px,5vw,34px)] font-extrabold [font-stretch:108%] ' +
  'leading-[1.1] tracking-[-0.028em] text-balance ' +
  '[text-shadow:0_1px_0_rgba(255,255,255,.9),0_-1px_0_rgba(26,23,18,.12)]';

export const passLede = 'mb-1.5 max-w-[46ch] text-[14.5px] text-ink-soft';

export const passNote =
  'mt-5 border-t border-line-soft pt-4 text-[13px] leading-[1.55] text-mut';

/** a rubber stamp struck across the coupon, not a status line */
export function PassStamp({ children, posted }: { children: ReactNode; posted?: boolean }) {
  return (
    <span
      className={cx(
        'inline-grid place-items-center rounded-sm border-2 border-current px-3.5 py-[7px]',
        'font-mono text-[15px] font-bold tracking-[.2em] indent-[.2em] opacity-85 -rotate-4',
        posted ? 'text-ok' : 'text-bad',
      )}
    >
      {children}
    </span>
  );
}

/** the tear between coupon and stub, punched top and bottom */
const NOTCH =
  'absolute left-1/2 size-5.5 -translate-x-1/2 rounded-full bg-paper shadow-notch ' +
  'max-[760px]:top-1/2 max-[760px]:bottom-auto max-[760px]:translate-x-0 max-[760px]:-translate-y-1/2';

export function Perf() {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'relative max-[760px]:mx-6.5 max-[760px]:h-0.5',
        "before:absolute before:inset-y-3.5 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-[image:var(--perf-v)] before:content-['']",
        'max-[760px]:before:inset-0 max-[760px]:before:h-0.5 max-[760px]:before:w-auto max-[760px]:before:translate-x-0 max-[760px]:before:bg-[image:var(--perf-h)]',
      )}
    >
      <span className={cx(NOTCH, '-top-[11px] max-[760px]:-left-[11px]')} />
      <span className={cx(NOTCH, '-bottom-[11px] max-[760px]:-right-[11px] max-[760px]:left-auto')} />
    </div>
  );
}

/** the stub: the part torn off, under a security tint a photocopier cannot hold */
export function Stub({ children }: { children: ReactNode }) {
  return (
    <aside
      className={cx(
        'relative isolate flex flex-col gap-4.5 px-6.5 py-10',
        'max-[760px]:px-6.5 max-[760px]:pt-6 max-[760px]:pb-7.5',
        "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:content-['']",
        'before:bg-[image:var(--guilloche)] before:opacity-[.13]',
        'before:[mask-image:radial-gradient(120%_90%_at_60%_40%,var(--color-ink)_30%,transparent_78%)]',
      )}
    >
      {children}
    </aside>
  );
}

export function Fields({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-[15px]">
      {items.map(([dt, dd]) => (
        <div key={dt}>
          <dt className={stamp}>{dt}</dt>
          <dd className="mt-[3px] font-mono text-[13px] tracking-[-.01em] text-ink">{dd}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Serial({ items }: { items: string[] }) {
  return (
    <p className="mt-auto flex gap-3.5 border-t border-line-soft pt-3.5 font-mono text-[11px] text-mut">
      {items.map((s) => (
        <span key={s}>{s}</span>
      ))}
    </p>
  );
}
