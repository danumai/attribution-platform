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

/* A card is a raised white surface with a hairline edge and one soft shadow. It carries no
   hover: a static panel that reacts to the cursor is reactive chrome on a surface nothing can
   be done to, and a page of twelve of them flickers as the pointer crosses it. */
export const card = 'relative rounded-xl border border-line bg-card p-6 shadow-contact-sm';

/** the small field label — sentence case, muted, sits above its value */
export const stamp = 'text-stamp text-mut';

export const muted = 'text-[14px] text-mut';

/** section head: a real heading, with a hairline rule running out from it */
export const sectionHead =
  'mt-10 mb-4 flex items-center gap-4 text-[13px] font-semibold tracking-[-0.006em] text-ink ' +
  "after:content-[''] after:h-px after:flex-1 after:bg-line";

/* ---- buttons ---- */

/* Shape and behaviour only — no padding and no colour, so an odd-shaped control
   (an icon square, a tab, a preset plate) composes from the same base without two
   utilities fighting over the same property. */
export const btnBase =
  'relative cursor-pointer rounded-lg border ' +
  'text-[13.5px] font-medium tracking-[-0.006em] whitespace-nowrap no-underline ' +
  'transition-[background-color,border-color,box-shadow,opacity,color] duration-150 ease-press ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

/** the four inks a control can be printed in */
export const inkAccent =
  'border-transparent bg-accent text-accent-on enabled:hover:bg-accent-hover';
export const inkGhost =
  'border-line bg-card text-ink shadow-contact-sm enabled:hover:bg-card-alt enabled:hover:border-mut/40';
export const inkDanger =
  'border-transparent bg-bad text-white shadow-contact-sm enabled:hover:bg-[color-mix(in_srgb,var(--color-bad)_86%,#000)]';
export const inkQuiet =
  'border-transparent bg-transparent text-ink-soft enabled:hover:bg-card-alt enabled:hover:text-ink';

/** the ordinary button box; odd-shaped controls set their own display instead */
export const btnBox = 'inline-flex items-center justify-center';

const pad = `${btnBox} px-3.5 py-2`;

export const btn = `${btnBase} ${pad} ${inkAccent}`;
export const btnGhost = `${btnBase} ${pad} ${inkGhost}`;
export const btnDanger = `${btnBase} ${pad} ${inkDanger}`;

export const btnTiny = `${btnBase} ${btnBox} rounded-md px-2.5 py-1 text-xs ${inkAccent}`;
export const btnTinyGhost = `${btnBase} ${btnBox} rounded-md px-2.5 py-1 text-xs ${inkGhost}`;

/** acts on this page but reads at link weight; must be a button to take focus */
export const linkish =
  'cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-medium text-accent-text ' +
  'enabled:hover:underline underline-offset-[3px] disabled:opacity-45 disabled:cursor-not-allowed';

export const link =
  'font-medium text-accent-text no-underline hover:underline hover:underline-offset-[3px]';

/* ---- forms ---- */

export const label = 'mt-5 mb-1.5 block text-[13px] font-medium tracking-[-0.006em] text-ink';

export const field =
  'w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[14px] text-ink shadow-contact-sm ' +
  'transition-[border-color,box-shadow] duration-150 ease-press ' +
  'placeholder:text-mut/70 hover:border-mut/40 focus:border-accent-text focus:outline-none focus:ring-4 focus:ring-accent/12';

/** native arrow is unstyleable, so the chevron is drawn into the field */
export const select = `${field} cursor-pointer appearance-none pr-[34px] bg-no-repeat bg-[position:calc(100%-12px)_50%] bg-[image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='12'%20height='12'%20viewBox='0%200%2012%2012'%20fill='none'%20stroke='%23737e8c'%20stroke-width='1.6'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M3%204.5%206%207.5%209%204.5'/%3E%3C/svg%3E")]`;

export const colorField =
  'h-[42px] w-full cursor-pointer rounded-lg border border-line bg-card p-[3px] shadow-contact-sm ' +
  'transition-[border-color,box-shadow] duration-150 ease-press hover:border-mut/40 ' +
  'focus:border-accent-text focus:outline-none focus:ring-4 focus:ring-accent/12';

export const rangeField = 'h-[22px] w-full cursor-pointer accent-accent';

export const checkbox = 'mt-[3px] h-[15px] w-auto cursor-pointer accent-accent';

export const checkLabel = 'mt-5 flex cursor-pointer items-start gap-[9px] text-[13px] text-ink-soft';

/* ---- segmented control ---- */

export const tabs =
  'mt-1 flex gap-1 overflow-x-auto rounded-lg border border-line bg-sunk p-1 ' +
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** quieter sub-level control, sitting inside a panel that already has tabs */
export const tabsSub = `${tabs} inline-flex`;

export function tab(selected: boolean) {
  return cx(
    btnBase,
    btnBox,
    'rounded-md px-3 py-1.5 text-[13px]',
    selected
      ? 'border-transparent bg-card text-ink shadow-contact-sm'
      : 'border-transparent bg-transparent text-mut enabled:hover:text-ink',
  );
}

/* ---- data ---- */

export const table = 'w-full border-collapse text-[13.5px]';

export const th =
  'border-b border-line bg-card-alt px-3.5 py-3 text-left text-[12px] font-medium text-mut';

export const td =
  'border-b border-line-soft px-3.5 py-3 text-left text-ink-soft tabular-nums';

export const tr = 'transition-colors duration-100 ease-press hover:bg-card-alt last:[&>td]:border-b-0';

export const code =
  'rounded-md border border-line-soft bg-card-alt px-1.5 py-0.5 font-mono text-[12.5px] text-ink-soft';

/** a secret printed in full, meant to be selected and copied */
export const codeKey =
  'mt-2 block rounded-lg border border-line bg-card-alt px-3.5 py-3 font-mono text-[12.5px] break-all text-ink';

/** the frame a table sits in: a rounded card with a sticky head */
export const tableWrap =
  'mt-3 overflow-auto rounded-xl border border-line bg-card shadow-contact-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-2';

export const tdNum = `${td} text-right tabular-nums`;
export const thNum = `${th} text-right`;

export const tableFoot =
  'flex items-center gap-3 border-t border-line bg-card-alt px-4 py-3';

/* ---- the numbers worth glancing at ---- */

/**
 * The figure strip: a run of stat cells sharing one bordered container, so the labels sit on
 * one baseline and the figures on another — which is the whole reason a strip of numbers is
 * worth glancing at.
 */
export const figureStrip = 'grid overflow-hidden rounded-xl border border-line bg-card shadow-contact-sm';

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
      7: 'grid-cols-4 max-[880px]:grid-cols-3 max-[560px]:grid-cols-2 max-[380px]:grid-cols-1',
    }[n] ?? 'grid-cols-[repeat(auto-fit,minmax(158px,1fr))]'
  );
}

/* The subdivision is a hairline: down the left of every cell and across the top of every
   wrapped row. Both are laid 1px outside the cell so the strip's own `overflow-hidden` clips
   the ones that would otherwise draw over the card's edge — which is what lets the rules
   survive a grid that reflows its column count. */
const cellRules =
  "before:absolute before:inset-y-0 before:-left-px before:w-px before:content-[''] before:bg-line " +
  "after:absolute after:inset-x-0 after:-top-px after:h-px after:content-[''] after:bg-line";

export const figureCell = `relative px-5 py-4.5 text-left ${cellRules}`;

/** the same cell when it is also the jump to the section the figure was counted from */
export const figureCellLink = cx(
  'group relative cursor-pointer border-0 bg-transparent px-5 py-4.5 text-left',
  'transition-colors duration-150 ease-press hover:bg-card-alt',
  cellRules,
);

/** a field's value: tight, tabular — the figure the row is read for */
export const fact = 'mt-1.5 text-[22px] font-semibold tracking-[-0.03em] tabular-nums';

/** a work queue row: count, what it is, and where it takes you */
export const queueRow = cx(
  btnBase,
  'flex w-full items-center gap-3.5 rounded-lg border-transparent bg-transparent px-3 py-3 text-left text-[14px] font-normal text-ink-soft',
  'enabled:hover:bg-card-alt',
  '[&+&]:rounded-none [&+&]:border-t [&+&]:border-t-line-soft',
);

export function queueCount(hot: boolean) {
  return cx(
    'min-w-8 rounded-md border px-2 py-0.5 text-center text-[13px] font-semibold tabular-nums',
    hot ? 'border-warn-line bg-warn-soft text-warn' : 'border-line bg-card-alt text-mut',
  );
}

/** an aside under a control, not an alert */
export const hint = 'mt-2 text-[12.5px] leading-[1.5] text-mut';

/* ---- state ---- */

const alertBase = 'flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13.5px] animate-rise-fast';

export const alertErr = `${alertBase} border-bad-line bg-bad-soft text-bad`;
export const alertWarn = `${alertBase} border-warn-line bg-warn-soft text-warn`;

/** status chips are soft-tinted pills */
const pillBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] align-middle " +
  "text-[12px] font-medium capitalize " +
  "before:content-[''] before:size-[6px] before:rounded-full before:bg-current";

export const pillNeutral = `${pillBase} border-line bg-card-alt text-mut`;
export const pillOk = `${pillBase} border-ok-line bg-ok-soft text-ok`;
export const pillWarn = `${pillBase} border-warn-line bg-warn-soft text-warn`;
export const pillBad = `${pillBase} border-bad-line bg-bad-soft text-bad`;
/** live: the dot keeps blinking so "active" reads as a state, not a colour */
export const pillActive = `${pillOk} before:animate-blink`;

/** maps a status string to its chip */
export function pill(status?: string | null) {
  const s = (status ?? '').toLowerCase();
  if (s === 'active') return pillActive;
  if (s === 'accepted') return pillOk;
  if (s === 'pending' || s === 'paused') return pillWarn;
  if (s === 'suspended' || s === 'ended' || s === 'rejected') return pillBad;
  return pillNeutral;
}

/** a figure the page is read for: tight, set in the sans everything else uses.
 *
 *  The size gives way before the number does. A seven-digit coin total is wider than a cell
 *  gets once a dense strip meets the console's rail — and a figure that overruns its cell is
 *  worse than a figure set slightly smaller.
 *
 *  Proportional figures, not tabular: equal-width digits are what make a column of table rows
 *  line up, and at this size they only make a number like 121 look loose. Nothing in a strip
 *  of stat cells aligns vertically, so there is nothing for them to buy.
 *
 *  No entrance of its own either: the section it sits in already rises once, and seven
 *  numbers each counting themselves in is decoration. */
export const figure = 'block text-[clamp(21px,1.9vw,28px)] font-semibold tracking-[-0.03em]';

/**
 * The signed change under a figure.
 *
 * Colour is direction × whether up is the good news, which is why the caller declares
 * `goodUp` rather than the chip assuming green-is-up: scans rising is good, and a budget
 * burning down faster is not. The arrow carries the direction on its own, so the chip
 * still reads correctly with the colour taken away.
 */
export function delta(good: boolean) {
  return cx(
    'inline-flex items-center gap-0.75 text-[12px] font-medium tabular-nums',
    good ? 'text-ok' : 'text-bad',
  );
}

export const skeleton =
  'h-3 rounded-full animate-shimmer ' +
  'bg-[linear-gradient(90deg,var(--color-line-soft)_25%,var(--color-line)_50%,var(--color-line-soft)_75%)] bg-[length:300%_100%]';

/* ---- admin console ---- */

/** table chrome: the filter box and the row count above the sheet */
export const tablebar = 'mt-4 flex flex-wrap items-center justify-between gap-3';

export const search =
  'flex flex-[0_1_340px] items-center gap-2 rounded-lg border border-line bg-card px-3 shadow-contact-sm ' +
  'transition-[border-color,box-shadow] duration-150 ease-press ' +
  'focus-within:border-accent-text focus-within:ring-4 focus-within:ring-accent/12 ' +
  '[&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-mut';

export const searchInput =
  'w-full border-0 bg-transparent py-2.25 text-[14px] text-ink outline-none placeholder:text-mut/70';

/** the line above a table that says what is being shown and what is narrowing it */
export const filterBar = 'mt-4 flex flex-wrap items-center gap-2.5';

/** an applied filter, shown as a removable chip — never state hidden in a heading */
export const filterChip =
  'inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft ' +
  'py-1 pr-1 pl-3 text-[13px] text-accent-text [&_code]:font-mono [&_code]:text-[12.5px]';

export const filterChipDrop =
  'grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent ' +
  'text-accent-text transition-colors duration-150 ease-press hover:bg-accent-line [&_svg]:size-3';

/* row action menu — one control per row instead of a run of links */
export const menu = 'group relative inline-block';

export const menuSummary =
  'grid h-7 w-[30px] cursor-pointer list-none place-items-center rounded-md border border-transparent text-mut ' +
  'transition-[background-color,border-color,color] duration-150 ease-press ' +
  'hover:border-line hover:bg-card-alt hover:text-ink ' +
  'group-open:border-line group-open:bg-card-alt group-open:text-ink ' +
  '[&::-webkit-details-marker]:hidden [&_svg]:size-4';

/** full-viewport catcher so clicking anywhere else dismisses the menu */
export const menuScrim = 'fixed inset-0 z-40';

export const menuPop =
  'absolute top-[calc(100%+6px)] right-0 z-41 min-w-49 rounded-xl border border-line bg-card-high p-1.5 shadow-contact animate-rise-fast';

export function menuItem(danger?: boolean) {
  return cx(
    btnBase,
    'block w-full rounded-md px-3 py-2 text-left text-[13.5px] font-normal',
    danger
      ? 'border-transparent bg-transparent text-bad enabled:hover:bg-bad-soft'
      : inkQuiet,
  );
}

/* The ledger check reads as a banner on the page, not a line in a stats row. The mark and,
   when it fails, the whole card's wash carry the state. */
export function health(ok: boolean) {
  return cx(
    'mt-4 flex items-start gap-3.5 rounded-xl border p-5 shadow-contact-sm',
    ok ? 'border-line bg-card' : 'border-bad-line bg-bad-soft',
  );
}

export function healthMark(ok: boolean) {
  return cx(
    'grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-5',
    ok ? 'bg-ok-soft text-ok' : 'bg-card text-bad',
  );
}

/* ---- proportion: meters and splits ---- */

/**
 * The trough a meter fills. A bar is a width, not a chart library — the same call the audience
 * panel's BarList already makes.
 *
 * Meters exist here because a spend product that prints its budget as an integer has hidden its
 * only real story. "1,200 coins" says nothing; "1,200 left of 5,000" is the whole picture.
 */
export const meter = 'h-1.5 overflow-hidden rounded-full bg-sunk';

/**
 * How full, and in which ink.
 *
 * The thresholds are the ones the dashboard was already applying to text colour inline — a
 * budget that cannot pay for one more signup is `bad`, under ten is `warn`. Lifting them here
 * is what stops the third call site from picking its own numbers.
 */
export function meterFill(ratio: number, state?: 'ok' | 'warn' | 'bad') {
  const ink = state ?? (ratio <= 0 ? 'bad' : ratio < 0.15 ? 'warn' : 'ok');
  return cx(
    'block h-full rounded-full transition-[width] duration-500 ease-out',
    { ok: 'bg-accent', warn: 'bg-warn-lit', bad: 'bg-bad' }[ink],
  );
}

/** the ink a figure takes when the figure itself is the warning */
export function meterInk(covers: number) {
  return covers === 0 ? 'text-bad' : covers < 10 ? 'text-warn' : 'text-ink';
}

/** two proportions in one bar: verified against guest, in the colours the landing page uses */
export const split = 'flex h-1.5 gap-px overflow-hidden rounded-full bg-sunk';

/* ---- QR design studio ---- */

export const studio =
  'mt-4 grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-start gap-5 max-[900px]:grid-cols-[minmax(0,1fr)]';

export const studioPreview = 'sticky top-[86px] max-[900px]:static';

export const previewHead = 'mb-3 flex items-baseline justify-between';

/* The plate's background comes from the merchant's chosen backdrop at the call site, not
   from a theme token — a QR preview is a proof of a printed artifact, and the Cutout
   preset is transparent. Theming this dark would show an unscannable code as if it were
   fine. Only the frame around it follows the theme. */
export const qrbox =
  'flex aspect-square items-center justify-center rounded-lg border border-line p-4 shadow-contact-sm ' +
  'transition-colors duration-200 ease-press [&_img]:max-h-full [&_img]:max-w-full';

/** icon pickers — the option shows the shape, it does not describe it */
export const swatches = 'mt-2 flex flex-wrap gap-2';

export function chip(on: boolean) {
  return cx(
    btnBase,
    'grid h-[42px] w-[46px] place-items-center p-0 [&_svg]:size-[22px]',
    on
      ? 'border-accent-text bg-accent-soft text-accent-text'
      : 'border-line bg-card text-ink-soft shadow-contact-sm enabled:hover:bg-card-alt',
  );
}

export const chipWide = 'w-auto px-3.5 text-[13px] tabular-nums';

export const presets = 'mt-3 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1.5';

/* Selection is a recessed mount under the plate, never a ring around it and never coloured:
   the chrome around a colour swatch has to be achromatic or it fights the swatch. */
export function preset(pressed: boolean) {
  return cx(
    btnBase,
    'group grid justify-items-center gap-2.5 px-2 pt-3 pb-2.5 text-center text-[11.5px] font-medium leading-[1.25]',
    pressed
      ? 'border-line bg-sunk text-ink'
      : 'border-transparent bg-transparent text-mut enabled:hover:bg-card-alt enabled:hover:text-ink',
  );
}

/** the plate is chip-scale, so it takes a 1px rule for its edge rather than a shadow */
export const presetProof =
  'block h-auto w-full max-w-[68px] rounded-md shadow-[0_0_0_1px_var(--color-line)] ' +
  'transition-shadow duration-150 ease-press group-aria-pressed:shadow-[0_0_0_1px_var(--color-ink-soft)]';

/** the code switcher: each code as its own tab */
export function codeTab(on: boolean, voided: boolean) {
  return cx(
    btnBase,
    'flex flex-col items-start gap-0.5 px-3.5 py-2 text-left [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[13px] [&_code]:text-inherit',
    on
      ? 'border-accent-line bg-accent-soft text-accent-text'
      : 'border-line bg-card text-ink-soft shadow-contact-sm enabled:hover:bg-card-alt',
    voided && 'line-through opacity-55',
  );
}

export const colorwell = 'min-w-[150px] flex-[1_1_160px]';

/** logo drop target */
export function logoWell(state: 'idle' | 'over' | 'filled') {
  return cx(
    'mt-2 rounded-xl border-2 transition-[border-color,background-color] duration-150 ease-press',
    state === 'filled'
      ? 'flex flex-row items-center gap-4 border-solid border-line bg-card-alt px-4 py-3.5 text-left'
      : 'flex cursor-pointer flex-col items-center justify-center gap-1.5 border-dashed px-5 py-7 text-center [&_svg]:size-6.5 [&_svg]:text-mut',
    state === 'over'
      ? 'border-accent-text bg-accent-soft'
      : state === 'idle' && 'border-line bg-sunk hover:border-accent-text hover:bg-accent-soft',
  );
}

/* ---- page frame ---- */

/** each section rises into place, the first four on a stagger */
export const riseStagger =
  '[&>*]:animate-rise [&>*:nth-child(2)]:[animation-delay:.04s] ' +
  '[&>*:nth-child(3)]:[animation-delay:.08s] [&>*:nth-child(4)]:[animation-delay:.12s] ' +
  '[&>*:nth-child(n+5)]:[animation-delay:.15s]';

/** a standalone page (no console rail): centred measure on the app canvas */
export const page =
  `relative z-1 mx-auto max-w-[1060px] px-6 pt-8 pb-24 max-[600px]:px-4 max-[600px]:pt-5 max-[600px]:pb-18 ${riseStagger}`;

/* ---- headings ---- */

export const h1 = 'text-title text-balance';

export const h3 = 'text-[15px] font-semibold tracking-[-0.014em]';
