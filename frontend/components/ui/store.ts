/**
 * A tiny external store: one mutable value, a subscriber list, and a snapshot getter — the shape
 * `useSyncExternalStore` expects. Toasts and dialogs each get their own instance, so pushing a
 * toast never notifies the dialog's listeners and vice versa. (The original combined
 * `lib/ui.tsx` shared one `listeners` set between both; splitting them is a safe simplification,
 * not a behaviour change — `useSyncExternalStore` already bails out via `Object.is` on an
 * unchanged snapshot, so no consumer ever saw anything different.)
 */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      emit();
    },
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
  };
}