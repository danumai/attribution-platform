'use client';
/**
 * The console primitives every signed-in surface shares: toasts, modal dialogs, the failed
 * load, and the figure strip.
 *
 * A module-level store so any page can call `toast.success(...)` or
 * `await confirmDialog(...)` without threading a context through props.
 * <UI /> is mounted once in the root layout and renders both.
 */
import { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Spark } from '@/lib/chart';
import {
  alertErr,
  btn,
  btnDanger,
  btnGhost,
  card,
  cx,
  delta as deltaChip,
  field,
  figure,
  figureCell,
  figureCellLink,
  figureColumns,
  figureStrip,
  h3,
  hint,
  label,
  meter,
  meterFill,
  muted,
  select,
  skeleton,
  split,
  stampCaps,
} from '@/lib/tw';

type Kind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: Kind; text: string; leaving?: boolean };

/**
 * One control in a dialog. `select` and `checks` need `options`; everything else is an
 * `<input>`. A `checks` field is a set of checkboxes and its value is the ticked options'
 * values joined by commas — dialog values are strings, and one field is one string.
 */
type DialogField = {
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

type Dialog = {
  title: string;
  body?: string;
  confirmText?: string;
  danger?: boolean;
  /**
   * present => the dialog carries a form; absent => it is a confirm.
   *
   * A function is re-read on every keystroke, which is what lets one field depend on another:
   * the campaign dialog cannot know which rewards to offer until a partnership is picked, and
   * asking twice in two dialogs to avoid that is worse than one that follows along.
   */
  fields?: DialogField[] | ((vals: Record<string, string>) => DialogField[]);
  resolve: (v: Record<string, string> | boolean | null) => void;
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
export function confirmDialog(o: Omit<Dialog, 'resolve' | 'fields'>) {
  return new Promise<boolean>((res) => {
    dialog = { ...o, resolve: (v) => res(v === true) };
    emit();
  });
}

/**
 * A form in a dialog. Resolves the field values, or null when cancelled.
 *
 * This exists so creating a thing stops being permanent page furniture. Both consoles used to
 * park a creation form under its own list — a "New campaign" panel on screen forever, below
 * every campaign you already had, whether or not you wanted one.
 */
export function formDialog(o: Omit<Dialog, 'resolve'> & { fields: NonNullable<Dialog['fields']> }) {
  return new Promise<Record<string, string> | null>((res) => {
    dialog = { ...o, resolve: (v) => res(v && typeof v === 'object' ? v : null) };
    emit();
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

/**
 * What a failed load looks like.
 *
 * Both consoles derive "still loading" from the absence of data, so a *failed* load is
 * indistinguishable from one in flight once the toast expires. This replaces the skeleton
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

/**
 * One printed figure.
 *
 * `go` marks the section this number was counted from. The two optional halves are the rest
 * of the stat-tile contract: `delta` is the signed change against a named period, and
 * `spark` is the shape that change came out of — neither is ever invented, so a caller with
 * no history to compare against simply omits them.
 */
export type Figure = {
  k: string;
  v: ReactNode;
  go?: string;
  /** `pct` as a fraction; `goodUp` says which direction is the good news */
  delta?: { pct: number; since: string; goodUp?: boolean };
  spark?: number[];
};

/**
 * A run of figures printed as one strip.
 *
 * One definition, because four surfaces spelling out "a number" for themselves is four
 * vocabularies an operator reads side by side. The name is stamped above the value, which is
 * also what makes a strip scannable: the labels share a baseline and so do the figures.
 */
export function Figures({
  items,
  onPick,
  className,
}: {
  items: Figure[];
  onPick?: (go: string) => void;
  /** margins belong to the call site, the way every other primitive in `tw` works */
  className?: string;
}) {
  return (
    <div className={cx(figureStrip, figureColumns(items.length), className)}>
      {items.map(({ k, v, go, delta, spark }) => {
        // Up is not automatically the good news — a caller says which direction it wanted,
        // and the arrow carries the direction even where the colour cannot be seen.
        const up = (delta?.pct ?? 0) >= 0;
        const good = up === (delta?.goodUp ?? true);
        const body = (
          <>
            {/* The label leads, so a reader scanning for one figure finds it by name. On a
                cell that jumps somewhere, it takes the validation ink on hover — that plus
                the cell filling is the affordance, so the strip needs no arrow per cell.
                There is no `group` on a static cell, so the variant never fires there. */}
            <span className={cx(stampCaps, 'block transition-colors duration-150 ease-press group-hover:text-accent-text')}>
              {k}
            </span>
            {/* the trace sits beside the figure, not under it: a stat cell is one line of
                information, and stacking the shape below the number doubles the strip's height
                to say the same thing */}
            <span className="mt-2 flex items-end justify-between gap-3">
              <b className={figure}>{v}</b>
              {/* The trace yields, the number never does. A six-figure strip on a console that
                  already spends 248px on the rail gives a cell about 145px of content, and a
                  seven-digit total plus a fixed-width trace does not fit in it — so the trace
                  is the flex item that shrinks. The SVG carries a viewBox, so it scales down
                  uniformly rather than distorting, and it stops at 40px, below which it stops
                  being a shape and becomes a smudge. */}
              {spark && spark.length > 1 && (
                <Spark className="mb-1.5 h-5 w-18 min-w-10 shrink" values={spark} />
              )}
            </span>
            {delta && (
              <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className={deltaChip(good)}>
                  <span aria-hidden="true">{up ? '↑' : '↓'}</span>
                  {Math.abs(delta.pct * 100).toFixed(0)}%
                  <span className="sr-only">{up ? 'up' : 'down'}</span>
                </span>
                <span className="text-[11.5px] text-mut">{delta.since}</span>
              </span>
            )}
          </>
        );
        return go && onPick ? (
          <button key={k} className={figureCellLink} onClick={() => onPick(go)} title={`Open ${k}`}>
            {body}
          </button>
        ) : (
          <div key={k} className={figureCell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What a section with nothing in it looks like.
 *
 * Every empty state in the console used to be one sentence in a bordered box, with nothing to
 * do about it. A reader who has just arrived and has no campaigns is exactly the reader most in
 * need of a button, so the action is part of the primitive rather than an afterthought beside it.
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

/**
 * Stands in for a section while its data is in flight.
 *
 * One shape per thing being awaited. The console used to shimmer the same five bars whether a
 * table, a strip of figures or a form was arriving — which tells the reader nothing about what
 * is about to appear, and makes the swap land as a jump rather than a fill.
 */
export function SkeletonCard({ lines = 5, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx(card, 'grid gap-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={skeleton} style={{ width: `${100 - i * 9}%` }} />
      ))}
    </div>
  );
}

export function SkeletonStrip({ cells = 4, className }: { cells?: number; className?: string }) {
  return (
    <div
      className={cx(figureStrip, figureColumns(cells), className)}
      aria-busy="true"
      aria-label="Loading"
    >
      {/* Sized to the cell it stands in, not to a generic bar: the label rail is short and
          the figure under it is tall, so the swap to real data lands as a fill rather than
          as the strip changing height. */}
      {Array.from({ length: cells }, (_, i) => (
        <div key={i} className={figureCell}>
          <div className={cx(skeleton, 'h-2 w-14')} />
          <div className={cx(skeleton, 'mt-3 h-6 w-16')} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={cx('overflow-hidden rounded-xl border border-line bg-card shadow-contact-sm', className)}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex gap-4 border-b border-line bg-card-alt px-3.5 py-3.5">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className={cx(skeleton, 'h-2.5 flex-1')} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-line-soft px-3.5 py-3.5 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className={cx(skeleton, 'flex-1')} style={{ opacity: 1 - r * 0.13 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A proportion, printed.
 *
 * `of` is the denominator the bar is drawn against. Pass it only when it is real — a meter with
 * an invented ceiling is worse than no meter, because it looks like a measurement.
 */
export function Meter({
  value,
  of,
  state,
  className,
}: {
  value: number;
  of: number;
  state?: 'ok' | 'warn' | 'bad';
  className?: string;
}) {
  const ratio = of > 0 ? Math.min(Math.max(value / of, 0), 1) : 0;
  return (
    <div
      className={cx(meter, className)}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i className={meterFill(ratio, state)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/** Verified against guest, in the two colours the landing page already assigns those states. */
export function Split({
  verified,
  guest,
  className,
}: {
  verified: number;
  guest: number;
  className?: string;
}) {
  const total = verified + guest;
  if (!total) return null;
  return (
    <div className={cx(split, className)} aria-hidden="true">
      <i className="block h-full bg-ok" style={{ width: `${(verified / total) * 100}%` }} />
      <i className="block h-full bg-warn-lit" style={{ width: `${(guest / total) * 100}%` }} />
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
  info: 'border-accent-line text-accent-text',
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

/** The controls as they stand for these values — a static list, or one that follows along. */
const fieldsOf = (d: Dialog, vals: Record<string, string>) =>
  (typeof d.fields === 'function' ? d.fields(vals) : (d.fields ?? []));

function Dialogs() {
  const d = useSyncExternalStore(subscribe, () => dialog, () => dialog);
  const ref = useRef<HTMLDialogElement>(null);
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!d) return;
    setVals(Object.fromEntries(fieldsOf(d, {}).map((f) => [f.name, f.value ?? ''])));
    ref.current?.showModal();
  }, [d]);

  if (!d) return null;

  // A field that only appears once another one is filled in was never seeded, so its own
  // `value` is its default until somebody touches it. That is what makes "every offer this
  // publisher grants, ticked" the starting state of a control that did not exist a keystroke ago.
  const fields = fieldsOf(d, vals);
  const valueOf = (f: DialogField) => {
    const v = vals[f.name] ?? f.value ?? '';
    // A `checks` value only means anything against the options on screen. When those change
    // under it — a different publisher was picked — a tick for an option that is gone is
    // dropped rather than submitted, so a `required` field asks again instead of sending it.
    return f.type === 'checks' && v
      ? v.split(',').filter((x) => f.options?.some((o) => o.value === x)).join(',')
      : v;
  };

  const close = (v: Record<string, string> | boolean | null) => {
    ref.current?.close();
    dialog = null;
    emit();
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
        {d.body && <p className={`${muted} leading-[1.5]`}>{d.body}</p>}

        {fields.map((f, i) => {
          const set = (v: string) => setVals((s) => ({ ...s, [f.name]: v }));
          const cur = valueOf(f);
          const ticked = cur ? cur.split(',') : [];
          return (
            <div key={f.name}>
              {f.label && <label className={label} htmlFor={`dlg-${f.name}`}>{f.label}</label>}
              {f.type === 'checks' ? (
                /* Checkboxes rather than a multi-select: picking two of five things out of a
                   native multiple <select> means knowing to hold a modifier key, and this is
                   the control a promoter uses once per campaign and never learns. */
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

export function UI() {
  return (
    <>
      <Toasts />
      <Dialogs />
    </>
  );
}
