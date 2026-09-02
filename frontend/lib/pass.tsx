/**
 * The auth card: a form panel carrying the words and a tinted side panel carrying the page's own
 * facts. Login, the 404 and the dead-code page are all the same surface.
 */
import { ReactNode } from 'react';
import { TicketMark } from '@/lib/mark';
import { cx, riseStagger, stampCaps } from '@/lib/tw';

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
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-on [&_svg]:size-4.5 [&_svg]:fill-current"
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

/**
 * The fork the whole product turns on, asked as a choice rather than buried as a tab: promoter and
 * publisher are two different products, not a preference.
 */
export function RoleCard({
  title,
  body,
  selected,
  onSelect,
}: {
  title: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'group cursor-pointer rounded-xl border p-4 text-left',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-press',
        selected
          ? 'border-accent-text bg-accent-soft shadow-contact-sm'
          : 'border-line bg-card hover:border-mut/40 hover:bg-card-alt',
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cx(
            'grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-150',
            selected ? 'border-accent-text bg-accent' : 'border-line bg-card',
          )}
          aria-hidden="true"
        >
          <span className={cx('size-1.5 rounded-full bg-card', !selected && 'opacity-0')} />
        </span>
        <b className={cx('text-[14px] font-semibold tracking-[-0.012em]', selected && 'text-accent-text')}>
          {title}
        </b>
      </span>
      <span className="mt-1.5 block text-[13px] leading-normal text-mut">{body}</span>
    </button>
  );
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
          <dt className={stampCaps}>{dt}</dt>
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
