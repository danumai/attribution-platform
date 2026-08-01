'use client';
/**
 * Toasts + modal dialogs, no dependencies.
 *
 * A module-level store so any page can call `toast.success(...)` or
 * `await confirmDialog(...)` without threading a context through props.
 * <UI /> is mounted once in the root layout and renders both.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

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

const ICONS: Record<Kind, JSX.Element> = {
  success: <path d="M4 8.5 6.8 11 12 5" />,
  error: <path d="M8 4.6v4.2M8 11.4v.1" />,
  info: <path d="M8 7.4v4.2M8 4.6v.1" />,
};

function Toasts() {
  const snap = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  if (!snap.length) return null;
  return (
    <div className="toaster" role="region" aria-label="Notifications">
      {snap.map((t) => (
        <output key={t.id} className={`toast ${t.kind}${t.leaving ? ' leaving' : ''}`}>
          <svg className="toast-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.kind !== 'success' && <circle cx="8" cy="8" r="6.2" />}
            {ICONS[t.kind]}
          </svg>
          <span className="toast-text">{t.text}</span>
          <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
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
    <dialog ref={ref} className="modal" onCancel={(e) => { e.preventDefault(); close(null); }}>
      <form
        method="dialog"
        onSubmit={(e) => { e.preventDefault(); close(d.input !== undefined ? value : true); }}
      >
        <h3>{d.title}</h3>
        {d.body && <p className="muted">{d.body}</p>}
        {d.input !== undefined && (
          <>
            {d.inputLabel && <label>{d.inputLabel}</label>}
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className={d.danger ? 'danger' : ''}>
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
