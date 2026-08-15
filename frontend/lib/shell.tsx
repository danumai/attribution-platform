'use client';
/**
 * The console shell every signed-in portal wears: a fixed left rail for navigation,
 * a header strip with the page title and its actions, and the section body.
 *
 * Sections are the caller's state (or links) — the shell only renders the rail and
 * reports which item was picked.
 */
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TicketMark } from '@/lib/mark';
import { btnBase, cx, h1, inkAccent, muted, riseStagger, stampCaps } from '@/lib/tw';

export type NavItem = {
  id: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
  /** set instead of relying on onSelect when the item leaves the page */
  href?: string;
  group?: string;
};

const ICONS = {
  overview: <path d="M3 3h6v6H3zM11 3h6v4h-6zM11 10h6v7h-6zM3 12h6v5H3z" />,
  orgs: <path d="M3 17h14M5 17V5h6v12M11 9h4v8M7 8h2M7 11h2M7 14h2" />,
  partnerships: <path d="M8.5 6.5h-2a3.5 3.5 0 1 0 0 7h2M11.5 6.5h2a3.5 3.5 0 1 1 0 7h-2M7 10h6" />,
  campaigns: <path d="M4 4v13M4 5h11l-2.2 3.2L15 11.5H4" />,
  scans: <path d="M3 6.5V4a1 1 0 0 1 1-1h2.5M13.5 3H16a1 1 0 0 1 1 1v2.5M17 13.5V16a1 1 0 0 1-1 1h-2.5M6.5 17H4a1 1 0 0 1-1-1v-2.5M6 10h8" />,
  redemptions: <path d="M10 3.5v13M13 6.2a3.2 3.2 0 0 0-3-1.7c-1.9 0-3 1-3 2.4 0 3.3 6.2 1.7 6.2 5 0 1.5-1.3 2.6-3.2 2.6a3.4 3.4 0 0 1-3.2-1.9" />,
  qr: <path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h2v2h-2zM16 12h1M12 16h1M15 15h2v2h-2z" />,
  ledger: <path d="M4 3h10a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2zM4 14h12M7 6.5h6M7 9.5h6" />,
  audit: <path d="M6 3.5h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 7h4M8 10h4M8 13h2" />,
  settings: <path d="M10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M10 2.8l1 1.9 2.1-.4 1.4 1.4-.4 2.1 1.9 1v2l-1.9 1 .4 2.1-1.4 1.4-2.1-.4-1 1.9H9l-1-1.9-2.1.4-1.4-1.4.4-2.1-1.9-1v-2l1.9-1-.4-2.1 1.4-1.4 2.1.4 1-1.9z" />,
  back: <path d="M11.5 5 6.5 10l5 5" />,
} as const;

function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         className={cx('size-[17px] shrink-0', className)}>
      {ICONS[name]}
    </svg>
  );
}

/* One rail row. Each state prints its own hover ink rather than layering a second
   hover rule over the first — two utilities on one property would race. */
const railRow =
  'my-px flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] ' +
  'font-medium no-underline';

function railItem(state: 'idle' | 'current' | 'out') {
  return cx(
    btnBase,
    railRow,
    state === 'current'
      ? 'border-transparent bg-accent-soft font-semibold text-accent-text'
      : state === 'out'
        ? 'mt-2 border-transparent bg-transparent text-mut enabled:hover:bg-bad-soft enabled:hover:text-bad'
        : 'border-transparent bg-transparent text-ink-soft enabled:hover:bg-card-alt enabled:hover:text-ink',
  );
}

export function Shell({
  org,
  items,
  active,
  onSelect,
  title,
  lede,
  actions,
  children,
}: {
  org: { name: string; type: string };
  items: NavItem[];
  active?: string;
  onSelect?: (id: string) => void;
  title: string;
  lede?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const r = useRouter();
  const [open, setOpen] = useState(false);

  const nav = items.map((it, i) => {
    const current = it.id === active;
    const head = it.group && it.group !== items[i - 1]?.group && (
      <span
        key={`${it.group}-h`}
        className={`${stampCaps} block px-3 pt-5 pb-2 font-semibold`}
      >
        {it.group}
      </span>
    );
    const inner = (
      <>
        <Icon name={it.icon} className={current ? 'text-accent-text' : 'text-mut'} />
        <span className="flex-1 truncate">{it.label}</span>
        {it.badge ? (
          <span className="min-w-5 shrink-0 rounded-full bg-warn-soft px-1.5 py-px text-center text-[11px] font-semibold text-warn tabular-nums">
            {it.badge}
          </span>
        ) : null}
      </>
    );
    return (
      <div key={it.id} className="first:[&_span:first-child]:pt-0.5">
        {head}
        {it.href ? (
          <Link
            className={railItem(current ? 'current' : 'idle')}
            href={it.href}
            aria-current={current ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {inner}
          </Link>
        ) : (
          <button
            className={railItem(current ? 'current' : 'idle')}
            aria-current={current ? 'page' : undefined}
            onClick={() => {
              onSelect?.(it.id);
              setOpen(false);
            }}
          >
            {inner}
          </button>
        )}
      </div>
    );
  });

  return (
    <div className="relative z-1 grid min-h-dvh grid-cols-[248px_minmax(0,1fr)] max-[900px]:grid-cols-[minmax(0,1fr)]">
      <button
        className={cx(
          'hidden',
          open && 'max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-55 max-[900px]:block max-[900px]:bg-scrim max-[900px]:backdrop-blur-sm',
        )}
        aria-label="Close menu"
        onClick={() => setOpen(false)}
      />

      <aside
        className={cx(
          'sticky top-0 flex h-dvh flex-col self-start border-r border-line bg-card px-3 pt-4 pb-3',
          'max-[900px]:fixed max-[900px]:left-0 max-[900px]:z-60 max-[900px]:w-66 max-[900px]:shadow-contact',
          'max-[900px]:transition-transform max-[900px]:duration-[.24s] max-[900px]:ease-press',
          open ? 'max-[900px]:translate-x-0' : 'max-[900px]:-translate-x-[101%]',
        )}
      >
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-on [&_svg]:size-4.5 [&_svg]:fill-current"
            aria-hidden="true"
          >
            <TicketMark />
          </span>
          <div className="min-w-0 leading-[1.3]">
            <b className="block truncate text-[13.5px] font-semibold tracking-[-0.012em]">{org.name}</b>
            <span className={`${stampCaps} block`}>
              {org.type === 'admin' ? 'Super admin' : org.type}
            </span>
          </div>
        </div>

        <nav className="-mx-1 flex-1 overflow-y-auto py-3" aria-label="Sections">
          {nav}
        </nav>

        <button
          className={cx(railItem('out'), 'border-t border-t-line-soft')}
          onClick={() => {
            // Only the session. `localStorage.clear()` also wiped `api_key:<org>`, which the
            // server stores as a hash and can never show again — signing out lost it forever.
            localStorage.removeItem('token');
            localStorage.removeItem('org');
            r.push('/login');
          }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
               className="size-[17px] shrink-0 text-mut">
            <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12 13l3.5-3L12 7M15 10H7.5" />
          </svg>
          <span className="flex-1 truncate">Sign out</span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3.5 border-b border-line bg-canvas/85 px-8 pt-5 pb-4 backdrop-blur-xl max-[900px]:p-4">
          <button
            className={cx(btnBase, inkAccent, 'hidden size-9 shrink-0 p-0 max-[900px]:grid max-[900px]:place-items-center')}
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="size-4.5">
              <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className={h1}>{title}</h1>
            {lede && <p className={`${muted} mt-0.5 max-w-[70ch]`}>{lede}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
        </header>
        <main
          className={cx(
            'w-full max-w-[1180px] px-8 pt-2 pb-24 max-[900px]:px-4 max-[900px]:pb-20',
            /* the first section head sits under the page header, so it needs no top rule */
            '[&>h2:first-child]:mt-6',
            riseStagger,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
