'use client';
import { useSyncExternalStore } from 'react';
import { cx } from '@/lib/tw';
import { toastStore, dismissToast, type Kind } from './toast';

const ICONS: Record<Kind, JSX.Element> = {
  success: <path d="M4 8.5 6.8 11 12 5" />,
  error: <path d="M8 4.6v4.2M8 11.4v.1" />,
  info: <path d="M8 7.4v4.2M8 4.6v.1" />,
};

/** the kind tints the rule and the mark; the message itself stays in text ink */
const KIND: Record<Kind, string> = {
  success: 'border-ok-line text-ok',
  error: 'border-bad-line text-bad',
  info: 'border-accent-line text-accent-text',
};

export function Toasts() {
  const snap = useSyncExternalStore(toastStore.subscribe, toastStore.get, toastStore.get);
  if (!snap.length) return null;
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-100 flex w-[min(360px,calc(100vw-32px))] flex-col-reverse gap-2.5 max-[600px]:inset-x-3 max-[600px]:bottom-3 max-[600px]:w-auto"
      role="region"
      aria-label="Notifications"
    >
      {snap.map((t) => (
        <output
          key={t.id}
          className={cx(
            'pointer-events-auto flex items-start gap-2.5 rounded-md border bg-card-high px-3.25 py-3 text-[13.5px] shadow-contact',
            KIND[t.kind],
            t.leaving ? 'animate-toast-out' : 'animate-toast-in',
          )}
        >
          <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.kind !== 'success' && <circle cx="8" cy="8" r="6.2" />}
            {ICONS[t.kind]}
          </svg>
          <span className="flex-1 leading-[1.45] wrap-break-word text-ink">{t.text}</span>
          <button
            className="-mt-0.5 -mr-0.5 shrink-0 cursor-pointer rounded-sm p-1 leading-none text-mut transition-colors duration-150 ease-press hover:bg-card-alt"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            <svg className="size-3.25" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m4.5 4.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </output>
      ))}
    </div>
  );
}