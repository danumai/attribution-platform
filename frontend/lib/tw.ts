/**
 * Shared utility strings for the primitives the console repeats on every page.
 *
 * These are Tailwind class lists, not a CSS layer — they exist so a card or a
 * button is spelled once instead of four hundred times. Spacing is deliberately
 * absent: margins belong to the call site, where the layout decision is made.
 */

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

/* ---- surfaces ---- */

/* A panel is flat stock with a 1px rule for its edge. It carries no hover: a static panel
   that reacts to the cursor is reactive chrome on a surface nothing can be done to, and a
   page of twelve of them flickers as the pointer crosses it. */
export const card = 'relative rounded-lg border border-line bg-card p-[22px] shadow-contact-sm';

/** the stamped caps field name — a printed label, never a sentence */
export const stamp = 'text-stamp uppercase text-mut';

export const muted = 'text-[13.5px] text-mut';

/** section head: a stamped caps label with a perforated rule running out from it */
export const sectionHead =
  'mt-[38px] mb-3 flex items-center gap-3 text-stamp uppercase text-mut ' +
  "after:content-[''] after:h-0.5 after:flex-1 after:bg-[image:var(--perf-h)]";

/* ---- buttons ---- */

/* Shape and behaviour only — no padding and no colour, so an odd-shaped control
   (an icon square, a tab, a preset plate) composes from the same base without two
   utilities fighting over the same property. */
export const btnBase =
  'relative cursor-pointer rounded-md border ' +
  'text-sm font-semibold tracking-[-0.005em] whitespace-nowrap no-underline ' +
  'transition-[background-color,border-color,transform,opacity,color] duration-150 ease-press ' +
  'enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40';

/** the four inks a control can be printed in */
export const inkAccent = 'border-transparent bg-accent text-accent-ink enabled:hover:bg-accent-hover';
export const inkGhost = 'border-mut bg-transparent text-ink enabled:hover:bg-card-alt';
export const inkDanger =
  'border-transparent bg-bad text-white enabled:hover:bg-[color-mix(in_srgb,var(--color-bad)_86%,#000)]';
export const inkQuiet = 'border-transparent bg-transparent text-ink-soft enabled:hover:bg-card-alt enabled:hover:text-ink';

/** the ordinary button box; odd-shaped controls set their own display instead */
export const btnBox = 'inline-flex items-center justify-center';

const pad = `${btnBox} px-4.25 py-2.5`;

export const btn = `${btnBase} ${pad} ${inkAccent}`;
export const btnGhost = `${btnBase} ${pad} ${inkGhost}`;
export const btnDanger = `${btnBase} ${pad} ${inkDanger}`;

export const btnTiny = `${btnBase} ${btnBox} px-2.5 py-1 text-xs ${inkAccent}`;
export const btnTinyGhost = `${btnBase} ${btnBox} px-2.5 py-1 text-xs ${inkGhost}`;

/** acts on this page but reads at link weight; must be a button to take focus */
export const linkish =
  'cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-accent ' +
  'enabled:hover:underline underline-offset-[3px] disabled:opacity-40 disabled:cursor-not-allowed';

export const link =
  'font-semibold text-accent no-underline hover:underline hover:underline-offset-[3px]';

/* ---- forms ---- */

export const label = 'mt-[18px] mb-1.5 block text-[13px] font-medium tracking-[-0.004em] text-ink-soft';

export const field =
  'w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink ' +
  'transition-[border-color,box-shadow] duration-150 ease-press ' +
  'placeholder:text-mut/75 hover:border-mut focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20';

/** native arrow is unstyleable, so the chevron is printed into the field */
export const select = `${field} cursor-pointer appearance-none pr-[34px] bg-no-repeat bg-[position:calc(100%-12px)_50%] bg-[image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='12'%20height='12'%20viewBox='0%200%2012%2012'%20fill='none'%20stroke='%236f6757'%20stroke-width='1.6'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M3%204.5%206%207.5%209%204.5'/%3E%3C/svg%3E")]`;

export const colorField =
  'h-[42px] w-full cursor-pointer rounded-md border border-line bg-card p-[3px] ' +
  'transition-[border-color,box-shadow] duration-150 ease-press hover:border-mut ' +
  'focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20';

export const rangeField = 'h-[22px] w-full cursor-pointer accent-accent';

export const checkbox = 'mt-[3px] h-[15px] w-auto cursor-pointer accent-accent';

export const checkLabel = 'mt-[18px] flex cursor-pointer items-start gap-[9px] text-[13px] text-ink-soft';

/* ---- segmented control: printed tabs, the live one on stock ---- */

export const tabs =
  'mt-1 flex gap-0.5 overflow-x-auto rounded-lg border border-line bg-card-sunk p-[3px] ' +
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** quieter sub-level control, sitting inside a panel that already has tabs */
export const tabsSub = `${tabs} inline-flex`;

export function tab(selected: boolean) {
  return cx(
    btnBase,
    btnBox,
    'rounded-sm px-3.5 py-[7px] text-[13px]',
    selected
      ? 'border-line bg-card text-ink'
      : 'border-transparent bg-transparent text-ink-soft enabled:hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)] enabled:hover:text-ink',
  );
}

/* ---- data ---- */

export const table = 'w-full border-collapse text-[13.5px]';

export const th =
  'border-b border-line bg-card-alt px-2.5 py-[11px] text-left text-stamp uppercase text-mut';

export const td =
  'border-b border-line-soft px-2.5 py-[11px] text-left text-ink-soft tabular-nums';

export const tr = 'transition-colors duration-100 ease-press hover:bg-card-alt last:[&>td]:border-b-0';

export const code =
  'rounded-sm border border-line-soft bg-card-alt px-1.5 py-0.5 font-mono text-[12.5px] text-ink-soft';

/** a secret printed in full, meant to be selected and copied */
export const codeKey =
  'mt-2 block rounded-md border border-line bg-card-alt px-3.25 py-2.75 font-mono text-[12.5px] break-all text-ink';

/** the frame a table is printed in: rounded stock with a sticky head */
export const tableWrap =
  'mt-2 overflow-auto rounded-lg border border-line bg-card shadow-contact-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-2';

export const tdNum = `${td} text-right tabular-nums`;
export const thNum = `${th} text-right`;

export const tableFoot =
  'flex items-center gap-3 border-t border-line bg-card-alt px-3.5 py-2.5';

export const empty = 'px-5.5 py-8.5 text-center [&_p]:text-mut';

/* ---- the numbers worth glancing at ---- */

/**
 * The figure strip: one bordered container subdivided by perforations, per DESIGN.md's
 * Layout rule, never a grid of separate cards.
 *
 * It replaces a `flex-wrap` run of `flex-auto` cells, where every cell sized itself to the
 * width of its own number — so a six-digit figure printed a cell twice as wide as a
 * two-digit one, nothing shared a left edge, and the wrap row stretched whatever was left
 * across the whole card. Equal columns put the stamped names on one baseline and the
 * figures on another, which is the whole reason a strip of numbers is worth glancing at.
 */
export const figureStrip = 'grid overflow-hidden rounded-lg border border-line bg-card shadow-contact-sm';

/**
 * How many columns a strip of `n` figures breaks into.
 *
 * `auto-fit` picks the count from a minimum width, which is how a strip of seven ends up as
 * six across and one alone on a row with five cells of empty card beside it. These counts
 * are chosen so a wrapped row is never a single orphan: seven goes four-and-three, five goes
 * three-and-two. Anything past seven falls back to fitting what it can.
 */
export function figureColumns(n: number) {
  return (
    {
      1: 'grid-cols-1',
      2: 'grid-cols-2 max-[440px]:grid-cols-1',
      3: 'grid-cols-3 max-[680px]:grid-cols-1',
      4: 'grid-cols-4 max-[880px]:grid-cols-2 max-[380px]:grid-cols-1',
      5: 'grid-cols-5 max-[1080px]:grid-cols-3 max-[680px]:grid-cols-2 max-[380px]:grid-cols-1',
      6: 'grid-cols-6 max-[1260px]:grid-cols-3 max-[680px]:grid-cols-2 max-[380px]:grid-cols-1',
      // Seven never goes seven across. It fits, but only just: a seven-digit scan count
      // lands ~2px off the tear line beside it, and a figure crowding its own divider is
      // the crampedness this strip exists to remove. Four-and-three reads calmer.
      7: 'grid-cols-4 max-[880px]:grid-cols-3 max-[560px]:grid-cols-2 max-[380px]:grid-cols-1',
    }[n] ?? 'grid-cols-[repeat(auto-fit,minmax(158px,1fr))]'
  );
}

/* The subdivision is drawn, not bordered: a tear line down the left of every cell and
   across the top of every wrapped row. Both are laid 1px outside the cell so the strip's
   own `overflow-hidden` clips the ones that would otherwise print over the card's edge —
   which is what lets the rules survive an `auto-fit` grid that reflows its column count. */
const cellRules =
  "before:absolute before:inset-y-2 before:-left-px before:w-px before:content-[''] " +
  'before:bg-[image:var(--perf-v)] before:bg-[length:1px_11px] ' +
  "after:absolute after:inset-x-2 after:-top-px after:h-px after:content-[''] " +
  'after:bg-[image:var(--perf-h)] after:bg-[length:11px_1px]';

export const figureCell = `relative px-4.5 py-4 text-left ${cellRules}`;

/** the same cell when it is also the jump to the section the figure was counted from */
export const figureCellLink = cx(
  'group relative cursor-pointer border-0 bg-transparent px-4.5 py-4 text-left',
  'transition-colors duration-150 ease-press hover:bg-card-alt active:translate-y-px',
  cellRules,
);

/** a printed field's value: mono, tight, tabular — the figure the row is read for */
export const fact = 'mt-1 font-mono text-[23px] font-semibold tracking-[-0.04em] tabular-nums';

/** a work queue row: count, what it is, and where it takes you */
export const queueRow = cx(
  btnBase,
  'flex w-full items-center gap-3.5 rounded-md border-transparent bg-transparent px-3 py-3 text-left font-medium text-ink-soft',
  'enabled:hover:bg-card-alt',
  '[&+&]:rounded-none [&+&]:border-t [&+&]:border-t-line-soft',
);

export function queueCount(hot: boolean) {
  return cx(
    'min-w-8.5 rounded-sm border px-2 py-0.5 text-center font-mono text-[13px] tabular-nums',
    hot ? 'border-warn-line bg-warn-soft font-bold text-warn' : 'border-line bg-card-sunk',
  );
}

/** an aside under a control, not an alert */
export const hint = 'mt-2 text-[12.5px] leading-[1.5] text-mut';

/* ---- state ---- */

const alertBase = 'flex gap-2 rounded-md border px-[13px] py-2.5 text-[13.5px] animate-rise-fast';

export const alertErr = `${alertBase} border-bad-line bg-bad-soft text-bad`;
export const alertWarn = `${alertBase} border-warn-line bg-warn-soft text-warn`;

/** status chips are printed rectangles, never pills */
const pillBase =
  "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-[3px] align-middle " +
  "text-[10.5px] font-bold uppercase tracking-[.06em] " +
  "before:content-[''] before:size-[5px] before:rounded-full before:bg-current";

export const pillNeutral = `${pillBase} border-line bg-card-alt text-ink-soft`;
export const pillOk = `${pillBase} border-ok-line bg-ok-soft text-ok`;
export const pillWarn = `${pillBase} border-warn-line bg-warn-soft text-warn`;
export const pillBad = `${pillBase} border-bad-line bg-bad-soft text-bad`;
/** live: the dot keeps blinking so "active" reads as a state, not a colour */
export const pillActive = `${pillOk} before:animate-blink`;

/** maps a status string to its printed chip */
export function pill(status?: string | null) {
  const s = (status ?? '').toLowerCase();
  if (s === 'active') return pillActive;
  if (s === 'accepted') return pillOk;
  if (s === 'pending' || s === 'paused') return pillWarn;
  if (s === 'suspended' || s === 'ended' || s === 'rejected') return pillBad;
  return pillNeutral;
}

/** a figure the page is read for: mono, tight, tabular.
 *
 *  The size gives way before the number does. A seven-digit coin total is ~118px at 28px
 *  mono, which is wider than a cell gets once a dense strip meets the console's 248px rail —
 *  and a figure that overruns its cell is worse than a figure set slightly smaller.
 *
 *  No entrance of its own either: the section it sits in already rises once, and seven
 *  numbers each counting themselves in is decoration, which this world does not do. */
export const figure =
  'block font-mono text-[clamp(21px,1.9vw,28px)] font-semibold tracking-[-0.04em] tabular-nums';

export const skeleton =
  'h-3 rounded-full animate-shimmer ' +
  'bg-[linear-gradient(90deg,var(--color-line-soft)_25%,var(--color-line)_50%,var(--color-line-soft)_75%)] bg-[length:300%_100%]';

/* ---- admin console ---- */

/** table chrome: the filter box and the row count above the sheet */
export const tablebar = 'mt-3 flex flex-wrap items-center justify-between gap-3';

export const search =
  'flex flex-[0_1_340px] items-center gap-2 rounded-md border border-line bg-card px-2.5 ' +
  'transition-[border-color,box-shadow] duration-150 ease-press ' +
  'focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20 ' +
  '[&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-mut';

export const searchInput =
  'w-full border-0 bg-transparent py-2.25 text-[14.5px] text-ink outline-none placeholder:text-mut/75';

/** the line above a table that says what is being shown and what is narrowing it */
export const filterBar = 'mt-3 flex flex-wrap items-center gap-2.5';

/** an applied filter, printed as a field with a tear-off — never state hidden in a heading */
export const filterChip =
  'inline-flex items-center gap-1.5 rounded-sm border border-accent-line bg-accent-soft ' +
  'py-1 pr-1 pl-2.5 text-accent [&_code]:font-mono [&_code]:text-[12.5px]';

export const filterChipDrop =
  'grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm border-0 bg-transparent ' +
  'text-accent transition-colors duration-150 ease-press hover:bg-accent-line [&_svg]:size-3';

/* row action menu — one control per row instead of a run of links */
export const menu = 'group relative inline-block';

export const menuSummary =
  'grid h-7 w-[30px] cursor-pointer list-none place-items-center rounded-sm border border-transparent text-mut ' +
  'transition-[background-color,border-color,color] duration-150 ease-press ' +
  'hover:border-line hover:bg-card-sunk hover:text-ink ' +
  'group-open:border-line group-open:bg-card-sunk group-open:text-ink ' +
  '[&::-webkit-details-marker]:hidden [&_svg]:size-4';

/** full-viewport catcher so clicking anywhere else dismisses the menu */
export const menuScrim = 'fixed inset-0 z-40';

export const menuPop =
  'absolute top-[calc(100%+5px)] right-0 z-41 min-w-49 rounded-md border border-line bg-card p-1.25 shadow-contact animate-rise-fast';

export function menuItem(danger?: boolean) {
  return cx(
    btnBase,
    'block w-full rounded-sm px-2.75 py-2 text-left text-[13.5px] font-medium',
    danger
      ? 'border-transparent bg-transparent text-bad enabled:hover:bg-bad-soft'
      : inkQuiet,
  );
}

/* The ledger check reads as a stamp on the page, not a line in a stats row. The struck
   mark and, when it fails, the whole card's wash carry the state. */
export function health(ok: boolean) {
  return cx(
    'mt-4 flex items-start gap-3.5 rounded-lg border p-4 px-4.5 shadow-contact-sm',
    ok ? 'border-line bg-card' : 'border-bad-line bg-bad-soft',
  );
}

export function healthMark(ok: boolean) {
  return cx(
    'grid size-[30px] shrink-0 place-items-center rounded-full [&_svg]:size-5',
    ok ? 'bg-ok-soft text-ok' : 'bg-white text-bad',
  );
}

/* ---- QR design studio ---- */

export const studio =
  'mt-3 grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-start gap-4 max-[900px]:grid-cols-[minmax(0,1fr)]';

export const studioPreview = 'sticky top-[74px] max-[900px]:static';

export const previewHead = 'mb-3 flex items-baseline justify-between';

export const qrbox =
  'flex aspect-square items-center justify-center rounded-md border border-line p-4 shadow-contact-sm ' +
  'transition-colors duration-200 ease-press [&_img]:max-h-full [&_img]:max-w-full';

/** icon pickers — the option shows the shape, it does not describe it */
export const swatches = 'mt-1.5 flex flex-wrap gap-2';

export function chip(on: boolean) {
  return cx(
    btnBase,
    'grid h-[42px] w-[46px] place-items-center p-0 [&_svg]:size-[22px]',
    on
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-line bg-card text-ink-soft enabled:hover:bg-card-alt',
  );
}

export const chipWide = 'w-auto px-3.5 text-[13px] tabular-nums';

export const presets = 'mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1';

/* Selection is a recessed mount under the plate, never a ring around it and never coloured:
   the chrome around a colour swatch has to be achromatic or it fights the swatch. */
export function preset(pressed: boolean) {
  return cx(
    btnBase,
    'group grid justify-items-center gap-2.5 px-1.75 pt-2.5 pb-2.25 text-center text-stamp uppercase leading-[1.25] tracking-[.1em]',
    pressed
      ? 'border-line bg-card-sunk text-ink'
      : 'border-transparent bg-transparent text-mut enabled:hover:bg-card-alt enabled:hover:text-ink',
  );
}

/** the plate is chip-scale, so it takes a 1px rule for its edge rather than a shadow */
export const presetProof =
  'block h-auto w-full max-w-[68px] rounded-sm shadow-[0_0_0_1px_var(--color-line)] ' +
  'transition-shadow duration-150 ease-press group-aria-pressed:shadow-[0_0_0_1px_var(--color-ink-soft)]';

/** the code switcher: each printed code as its own stub */
export function codeTab(on: boolean, voided: boolean) {
  return cx(
    btnBase,
    'flex flex-col items-start gap-0.5 px-3.25 py-2 text-left [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[13px] [&_code]:text-inherit',
    on
      ? 'border-accent-line bg-accent-soft text-accent'
      : 'border-line bg-card-alt text-ink-soft enabled:hover:bg-card-sunk',
    voided && 'line-through opacity-55',
  );
}

export const colorwell = 'min-w-[150px] flex-[1_1_160px]';

/** logo drop target */
export function logoWell(state: 'idle' | 'over' | 'filled') {
  return cx(
    'mt-2 rounded-lg border-2 transition-[border-color,background-color] duration-150 ease-press',
    state === 'filled'
      ? 'flex flex-row items-center gap-4 border-solid border-line bg-card-alt px-4 py-3.5 text-left'
      : 'flex cursor-pointer flex-col items-center justify-center gap-1.25 border-dashed px-4.5 py-6.5 text-center [&_svg]:size-6.5 [&_svg]:text-mut',
    state === 'over'
      ? 'border-accent bg-accent-soft'
      : state === 'idle' && 'border-line bg-card-sunk hover:border-accent hover:bg-accent-soft',
  );
}

/* ---- page frame ---- */

/** each section rises into place, the first four on a stagger */
export const riseStagger =
  '[&>*]:animate-rise [&>*:nth-child(2)]:[animation-delay:.04s] ' +
  '[&>*:nth-child(3)]:[animation-delay:.08s] [&>*:nth-child(4)]:[animation-delay:.12s] ' +
  '[&>*:nth-child(n+5)]:[animation-delay:.15s]';

/** a standalone page (no console rail): centred measure on the paper ground */
export const page =
  `relative z-1 mx-auto max-w-[1060px] px-5 pt-6.5 pb-24 max-[600px]:px-3.5 max-[600px]:pt-4 max-[600px]:pb-18 ${riseStagger}`;

/* ---- headings ---- */

export const h1 =
  'font-display text-[clamp(24px,3vw,30px)] font-extrabold [font-stretch:108%] ' +
  'leading-[1.1] tracking-[-0.028em] text-balance';

export const h3 = 'text-base font-[650] tracking-[-0.018em]';
