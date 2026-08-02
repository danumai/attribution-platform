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

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
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
    const head = it.group && it.group !== items[i - 1]?.group && (
      <span className="rail-group" key={`${it.group}-h`}>{it.group}</span>
    );
    const inner = (
      <>
        <Icon name={it.icon} />
        <span>{it.label}</span>
        {it.badge ? <span className="rail-badge">{it.badge}</span> : null}
      </>
    );
    return (
      <div key={it.id} className="rail-slot">
        {head}
        {it.href ? (
          <Link
            className="rail-item"
            href={it.href}
            aria-current={it.id === active ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {inner}
          </Link>
        ) : (
          <button
            className="rail-item"
            aria-current={it.id === active ? 'page' : undefined}
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
    <div className={`shell${open ? ' open' : ''}`}>
      <button className="rail-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />

      <aside className="rail">
        <div className="rail-id">
          <span className="rail-mark" aria-hidden="true">QR</span>
          <div className="rail-who">
            <b>{org.name}</b>
            <span className="muted">{org.type === 'admin' ? 'super admin' : org.type}</span>
          </div>
        </div>

        <nav className="rail-nav" aria-label="Sections">{nav}</nav>

        <button
          className="rail-item rail-out"
          onClick={() => {
            localStorage.clear();
            r.push('/login');
          }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12 13l3.5-3L12 7M15 10H7.5" />
          </svg>
          <span>Sign out</span>
        </button>
      </aside>

      <div className="shell-body">
        <header className="pagehead">
          <button className="rail-toggle" aria-label="Open menu" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
            </svg>
          </button>
          <div className="pagehead-text">
            <h1>{title}</h1>
            {lede && <p className="muted">{lede}</p>}
          </div>
          {actions && <div className="pagehead-actions">{actions}</div>}
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
