'use client';
/**
 * Toasts + modal dialogs, no dependencies.
 *
 * A module-level store so any page can call `toast.success(...)` or
 * `await confirmDialog(...)` without threading a context through props.
 * <UI /> is mounted once in the root layout and renders both.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { alertErr, btn, btnDanger, btnGhost, card, cx, field, h3, label, muted } from '@/lib/tw';

type Kind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: Kind; text: string; leaving?: boolean };
type Dialog = {
  title: string;
  body?: string;
  confirmText?: string;
  danger?: boolean;
  /** present => prompt dialog; the string is the initial input value */
  input?: string;
  inputLabel?: string;
  resolve: (v: string | boolean | null) => void;
};

let toasts: Toast[] = [];
let dialog: Dialog | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

let seq = 0;
const DURATION = 4200;
const EXIT = 220;

function push(kind: Kind, text: string) {
  if (!text) return;
  const id = ++seq;
  toasts = [...toasts, { id, kind, text }];
  emit();
  setTimeout(() => dismiss(id), DURATION);
  return id;
}

function dismiss(id: number) {
  const t = toasts.find((x) => x.id === id);
  if (!t || t.leaving) return;
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, EXIT);
}

export const toast = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
  info: (text: string) => push('info', text),
};

/** Replaces window.confirm. Resolves true when confirmed. */
export function confirmDialog(o: Omit<Dialog, 'resolve' | 'input' | 'inputLabel'>) {
  return new Promise<boolean>((res) => {
    dialog = { ...o, resolve: (v) => res(v === true) };
    emit();
  });
}

/** Replaces window.prompt. Resolves the string, or null when cancelled. */
export function promptDialog(o: Omit<Dialog, 'resolve'> & { input: string }) {
  return new Promise<string | null>((res) => {
    dialog = { ...o, resolve: (v) => res(typeof v === 'string' ? v : null) };
    emit();
  });
}

/**
 * What a failed load looks like.
 *
 * Both consoles derive "still loading" from the absence of data, so a load that *failed* is
 * indistinguishable from one still in flight: the toast expires after four seconds and the
 * operator is left watching shimmer bars with nothing to click. This replaces the skeleton
 * rather than sitting above it — the page is not loading, and must not claim to be.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cx(card, 'mt-3')} role="alert">
      <h3 className={h3}>This didn’t load</h3>
      <p className={cx(alertErr, 'mt-3')}>{message}</p>
      <button className={cx(btn, 'mt-4')} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

const ICONS: Record<Kind, JSX.Element> = {
  success: <path d="M4 8.5 6.8 11 12 5" />,
  error: <path d="M8 4.6v4.2M8 11.4v.1" />,
  info: <path d="M8 7.4v4.2M8 4.6v.1" />,
};

/** the kind tints the rule and the mark; the message itself stays in text ink */
const KIND: Record<Kind, string> = {
  success: 'border-ok-line text-ok',
  error: 'border-bad-line text-bad',
  info: 'border-accent-line text-accent',
};

function Toasts() {
  const snap = useSyncExternalStore(subscribe, () => toasts, () => toasts);
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
            'pointer-events-auto flex items-start gap-2.5 rounded-md border bg-card px-3.25 py-3 text-[13.5px] shadow-contact',
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
            onClick={() => dismiss(t.id)}
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

function Dialogs() {
  const d = useSyncExternalStore(subscribe, () => dialog, () => dialog);
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!d) return;
    setValue(d.input ?? '');
    ref.current?.showModal();
  }, [d]);

  if (!d) return null;

  const close = (v: string | boolean | null) => {
    ref.current?.close();
    dialog = null;
    emit();
    d.resolve(v);
  };

  return (
    // native <dialog> gives focus trap, Esc and ::backdrop for free
    <dialog
      ref={ref}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-lg border border-line bg-card p-6 text-ink shadow-contact open:animate-modal-in backdrop:animate-fade backdrop:bg-[color-mix(in_srgb,#2a2113_55%,transparent)]"
      onCancel={(e) => { e.preventDefault(); close(null); }}
    >
      <form
        method="dialog"
        onSubmit={(e) => { e.preventDefault(); close(d.input !== undefined ? value : true); }}
      >
        <h3 className={`${h3} mb-1.5`}>{d.title}</h3>
        {d.body && <p className={`${muted} leading-[1.5]`}>{d.body}</p>}
        {d.input !== undefined && (
          <>
            {d.inputLabel && <label className={label}>{d.inputLabel}</label>}
            {/* autofocus is correct here: a prompt dialog exists to take one value */}
            <input
              className={cx(field, d.inputLabel ? '' : 'mt-4.5')}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </>
        )}
        <div className="mt-5.5 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className={d.danger ? btnDanger : btn}>
            {d.confirmText ?? 'Confirm'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function UI() {
  return (
    <>
      <Toasts />
      <Dialogs />
    </>
  );
}
