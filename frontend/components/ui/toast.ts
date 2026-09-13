/**
 * Toast state and the public `toast.success(...)`/`toast.error(...)` API. No JSX here — the
 * renderer lives in `Toasts.tsx`. Any page can call `toast.success(...)` without threading a
 * context through props, same as before.
 */
import { createStore } from './store';

export type Kind = 'success' | 'error' | 'info';
export type Toast = { id: number; kind: Kind; text: string; leaving?: boolean };

export const toastStore = createStore<Toast[]>([]);

let seq = 0;
const DURATION = 4200;
const EXIT = 220;

function push(kind: Kind, text: string) {
  if (!text) return;
  const id = ++seq;
  toastStore.set([...toastStore.get(), { id, kind, text }]);
  setTimeout(() => dismissToast(id), DURATION);
  return id;
}

export function dismissToast(id: number) {
  const list = toastStore.get();
  const t = list.find((x) => x.id === id);
  if (!t || t.leaving) return;
  toastStore.set(list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
  setTimeout(() => {
    toastStore.set(toastStore.get().filter((x) => x.id !== id));
  }, EXIT);
}

export const toast = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
  info: (text: string) => push('info', text),
};