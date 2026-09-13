'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { btn, btnDanger, btnGhost, cx, field, h3, hint, label, muted, select } from '../../lib/tw';
import { dialogStore, type Dialog, type DialogField } from './dialog';

/** The controls as they stand for these values — a static list, or one that follows along. */
const fieldsOf = (d: Dialog, vals: Record<string, string>) =>
  (typeof d.fields === 'function' ? d.fields(vals) : (d.fields ?? []));

export function Dialogs() {
  const d = useSyncExternalStore(dialogStore.subscribe, dialogStore.get, dialogStore.get);
  const ref = useRef<HTMLDialogElement>(null);
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!d) return;
    setVals(Object.fromEntries(fieldsOf(d, {}).map((f) => [f.name, f.value ?? ''])));
    ref.current?.showModal();
  }, [d]);

  if (!d) return null;

  // A field that only appears once another is filled was never seeded, so its own `value` is its
  // default until somebody touches it.
  const fields = fieldsOf(d, vals);
  const valueOf = (f: DialogField) => {
    const v = vals[f.name] ?? f.value ?? '';
    // A `checks` value only means anything against the options on screen. When those change under
    // it — a different publisher was picked — a tick for a vanished option has to go.
    return f.type === 'checks' && v
      ? v.split(',').filter((x) => f.options?.some((o) => o.value === x)).join(',')
      : v;
  };

  const close = (v: Record<string, string> | boolean | null) => {
    ref.current?.close();
    dialogStore.set(null);
    d.resolve(v);
  };

  // A required field that is empty blocks submit, rather than letting the form post and come
  // back as a server error — which is what the login page used to do.
  const incomplete = fields.some((f) => f.required && !valueOf(f).trim());

  return (
    // native <dialog> gives focus trap, Esc and ::backdrop for free
    <dialog
      ref={ref}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-line bg-card-high p-6 text-ink shadow-pass open:animate-modal-in backdrop:animate-fade backdrop:bg-scrim"
      onCancel={(e) => { e.preventDefault(); close(null); }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          // Read off the fields on screen, not off `vals`: an untouched dependent field holds
          // its default there and nowhere else.
          close(d.fields ? Object.fromEntries(fields.map((f) => [f.name, valueOf(f)])) : true);
        }}
      >
        <h3 className={`${h3} mb-1.5`}>{d.title}</h3>
        {d.body && <p className={`${muted} leading-normal`}>{d.body}</p>}

        {fields.map((f, i) => {
          const set = (v: string) => setVals((s) => ({ ...s, [f.name]: v }));
          const cur = valueOf(f);
          const ticked = cur ? cur.split(',') : [];
          return (
            <div key={f.name}>
              {f.label && <label className={label} htmlFor={`dlg-${f.name}`}>{f.label}</label>}
              {f.type === 'checks' ? (
                // Checkboxes rather than a multi-select: picking two of five out of a native
                // multiple <select> means knowing to hold a modifier key.
                <div className="mt-1.5 grid gap-1.5 rounded-lg border border-line bg-sunk px-3.5 py-3">
                  {f.options?.length ? (
                    f.options.map((o) => (
                      <label key={o.value} className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent-text"
                          checked={ticked.includes(o.value)}
                          onChange={() =>
                            // Rebuilt in the options' own order, so the stored string does not
                            // depend on the order they were clicked in.
                            set(
                              f.options!
                                .filter((x) =>
                                  x.value === o.value ? !ticked.includes(o.value) : ticked.includes(x.value),
                                )
                                .map((x) => x.value)
                                .join(','),
                            )
                          }
                        />
                        {o.label}
                      </label>
                    ))
                  ) : (
                    <p className={muted}>{f.placeholder ?? 'Nothing to pick here.'}</p>
                  )}
                </div>
              ) : f.type === 'select' ? (
                <select
                  id={`dlg-${f.name}`}
                  className={cx(select, !f.label && 'mt-4.5')}
                  /* the first control is what the dialog was opened to fill in */
                  autoFocus={i === 0}
                  value={cur}
                  onChange={(e) => set(e.target.value)}
                >
                  {f.placeholder && <option value="">{f.placeholder}</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`dlg-${f.name}`}
                  className={cx(field, !f.label && 'mt-4.5')}
                  type={f.type ?? 'text'}
                  autoFocus={i === 0}
                  placeholder={f.placeholder}
                  value={cur}
                  onChange={(e) => set(e.target.value)}
                />
              )}
              {f.hint && <p className={hint}>{f.hint}</p>}
            </div>
          );
        })}

        <div className="mt-5.5 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className={d.danger ? btnDanger : btn} disabled={incomplete}>
            {d.confirmText ?? 'Confirm'}
          </button>
        </div>
      </form>
    </dialog>
  );
}