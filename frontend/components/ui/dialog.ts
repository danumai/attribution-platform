/**
 * Dialog state and the promise-based `confirmDialog`/`formDialog`/`promptDialog` API. No JSX
 * here — the renderer lives in `Dialogs.tsx`.
 */
import { createStore } from './store';

/**
 * One control in a dialog. `select` and `checks` need `options`; everything else is an `<input>`.
 * A `checks` value is the ticked options' values joined by commas — dialog values are strings.
 */
export type DialogField = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'checks';
  value?: string;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** blocks submit while empty — the dialog equivalent of a required field */
  required?: boolean;
};

export type Dialog = {
  title: string;
  body?: string;
  confirmText?: string;
  danger?: boolean;
  /**
   * present => the dialog carries a form; absent => it is a confirm.
   *
   * A function is re-read on every keystroke, which is what lets one field depend on another:
   * the campaign dialog cannot know which rewards to offer until a partnership is picked.
   */
  fields?: DialogField[] | ((vals: Record<string, string>) => DialogField[]);
  resolve: (v: Record<string, string> | boolean | null) => void;
};

export const dialogStore = createStore<Dialog | null>(null);

/** Replaces window.confirm. Resolves true when confirmed. */
export function confirmDialog(o: Omit<Dialog, 'resolve' | 'fields'>) {
  return new Promise<boolean>((res) => {
    dialogStore.set({ ...o, resolve: (v) => res(v === true) });
  });
}

/**
 * A form in a dialog. Resolves the field values, or null when cancelled. This exists so creating
 * a thing stops being permanent page furniture parked under its own list.
 */
export function formDialog(o: Omit<Dialog, 'resolve'> & { fields: NonNullable<Dialog['fields']> }) {
  return new Promise<Record<string, string> | null>((res) => {
    dialogStore.set({ ...o, resolve: (v) => res(v && typeof v === 'object' ? v : null) });
  });
}

/** Replaces window.prompt: one field, unwrapped. Built on `formDialog` so there is a single
 *  rendering path rather than a second one that drifts. */
export function promptDialog(o: {
  title: string;
  body?: string;
  confirmText?: string;
  danger?: boolean;
  inputLabel?: string;
  input: string;
}) {
  const { inputLabel, input, ...rest } = o;
  return formDialog({
    ...rest,
    fields: [{ name: 'value', label: inputLabel ?? '', value: input, required: true }],
  }).then((r) => (r ? (r.value ?? null) : null));
}