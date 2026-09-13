import { ReactNode } from 'react';
import { card, cx, h3, muted } from '@/lib/tw';

/**
 * What a section with nothing in it looks like. Every empty state used to be one sentence in a
 * bordered box with nothing to do about it.
 */
export function Empty({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(card, 'grid justify-items-center px-6 py-12 text-center', className)}>
      <span
        className="mb-3.5 grid size-11 place-items-center rounded-full bg-sunk text-mut [&_svg]:size-5"
        aria-hidden="true"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 6.5h13M3.5 10h13M3.5 13.5h7" />
        </svg>
      </span>
      <b className={h3}>{title}</b>
      {body && <p className={cx(muted, 'mt-1.5 max-w-[46ch] leading-[1.55]')}>{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}