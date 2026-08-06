/**
 * Landing-page utility strings.
 *
 * This file used to be a second design system: its own buttons, its own headings, its own
 * shadows, all spelled in a printed-ticket vocabulary that the signed-in console no longer
 * shares. It is now an *editorial layer* — the same tokens and the same primitives as
 * `lib/tw.ts`, set at the top of the type scale instead of the bottom, with the few landing-only
 * compositions (the hero grid, the posting board, the coupon strip) defined here.
 *
 * The `lp-*` class names that remain in the TSX are motion hooks only — landing.css owns the
 * entrance sequence and the scroll-linked moves, because @keyframes, @property and
 * `animation-timeline: view()` ranges staggered by :nth-of-type cannot be spelled as utilities.
 */
import { btnBase, btnBox, cx, inkAccent, inkGhost } from '@/lib/tw';

export { cx };

/* ---- measure ---- */

export const wrap = 'mx-auto w-[min(1160px,100%-48px)] max-[720px]:w-[calc(100%-32px)]';

/** a raised surface at landing scale — the console's card, one step more lifted */
export const passShell = 'relative rounded-2xl border border-line bg-card shadow-pass';

/* ---- field pairs ---- */

export const field = 'grid gap-1';
/* Landing labels are wide-tracked caps — the exhibition-catalogue register. The console
   keeps sentence case; see the two label tokens in globals.css. */
export const fieldTerm = 'text-stamp-caps uppercase text-mut';
export const fieldValue = 'm-0 font-mono text-[13px] tracking-[-0.01em] text-ink tabular-nums';

/* ---- nav ---- */

export const nav = 'lp-nav sticky top-0 z-30 border-b border-line bg-canvas/85 py-3.5 backdrop-blur-xl';
export const navInner = cx(wrap, 'flex items-center justify-between gap-4.5');
/** reading progress, in the accent */
export const navProgress =
  'lp-nav-progress absolute inset-x-0 -bottom-px h-0.5 origin-left scale-x-0 bg-accent';

export const mark =
  'group flex items-center gap-2.5 text-sm font-semibold tracking-[-0.015em] whitespace-nowrap text-ink no-underline ' +
  'max-[480px]:text-[13px] ' +
  '[&_svg]:size-7 [&_svg]:shrink-0 [&_svg]:rounded-lg [&_svg]:bg-accent [&_svg]:fill-accent-on [&_svg]:p-1.5 ' +
  '[&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:-rotate-6';

/* ---- buttons: the console's controls, at landing scale ---- */

const lpPad = `${btnBox} px-5 py-2.5 text-sm font-semibold`;

/* No sheen and no glow. A gleam sweeping across the primary action reads as a shiny web
   button, which is the register this theme is deliberately not in — the button earns its
   emphasis from being the only madder fill on the page. */
export const btn = cx(btnBase, lpPad, inkAccent, 'active:translate-y-px');
export const btnGhost = cx(btnBase, lpPad, inkGhost, 'active:translate-y-px');
export const btnLg = 'px-6 py-3.25 text-[15px]';

/* ---- hero ---- */

export const hero = 'lp-hero relative isolate pt-16 pb-4 max-[720px]:pt-9';

/** A single faint value shift behind the hero, not a coloured wash.
 *
 *  Three tinted radial glows was the loudest generic-SaaS signature on the page, and on a
 *  mid-grey canvas coloured light does not read as atmosphere — it reads as a smudge. Depth
 *  here comes from value, the same way it does on every other surface in the system. Being
 *  a static gradient, it also no longer needs a client component to gate an infinite
 *  animation while off screen. */
export const heroWash =
  'pointer-events-none absolute inset-[-120px_-10%_auto_-10%] -z-1 h-[640px] ' +
  'bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--color-card)_70%,transparent),transparent_72%)]';

/** The hero is a two-column composition, not a bordered card. The card is the proof panel on
 *  the right; wrapping the argument in one too made the whole viewport a single object. */
export const pass =
  'lp-pass grid grid-cols-[minmax(0,1fr)_400px] items-center gap-14 ' +
  'max-[1000px]:grid-cols-[minmax(0,1fr)] max-[1000px]:gap-9';

export const coupon = 'max-w-[42ch] max-[1000px]:max-w-none';

/** the three facts the model turns on, above the headline */
export const routing =
  'lp-routing flex flex-wrap gap-x-8 gap-y-3 pb-7 mb-7 border-b border-line ' +
  'max-[720px]:gap-x-5 max-[720px]:gap-y-2.5 max-[720px]:pb-5 max-[720px]:mb-6';

export const h1 =
  'lp-h1 m-0 text-hero text-balance text-ink [&_em]:not-italic [&_em]:text-accent-text';

export const lede =
  'lp-lede mt-6 max-w-[52ch] text-lede text-ink-soft [&_b]:font-semibold [&_b]:text-ink';

export const cta = 'lp-cta mt-8 flex flex-wrap gap-3 max-[560px]:[&>*]:flex-[1_1_100%]';
export const ctaNote = 'lp-cta-note mt-4 text-[13px] text-mut';

/* ---- the proof panel: one code, and what happens to it ---- */

export const stub = cx(
  'lp-stub flex flex-col gap-5 p-7',
  passShell,
  'max-[1000px]:mx-auto max-[1000px]:w-full max-[1000px]:max-w-[420px]',
);

export const codePlate =
  'lp-code relative overflow-hidden rounded-xl border border-line bg-sunk p-5 ' +
  '[&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:fill-ink';

export const scanSweep =
  'lp-scan absolute inset-x-0 top-0 h-[44%] border-b-2 border-accent-text opacity-0 ' +
  'bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-accent)_14%,transparent)_74%,color-mix(in_srgb,var(--color-accent)_30%,transparent))]';

/** the plate takes the reader's ring the instant the sweep clears the code */
export const codeRing =
  'lp-code-ring absolute inset-0 rounded-xl opacity-0 shadow-[0_0_0_2px_var(--color-accent-text)_inset]';

export const stubFields = 'lp-stub-fields m-0 grid grid-cols-2 gap-4';

export const status = 'lp-status inline-grid';
export const statusIdle = 'lp-status-idle [grid-area:1/1] justify-self-start font-mono text-[13px] text-mut';
export const statusDone =
  'lp-status-done [grid-area:1/1] justify-self-start font-mono text-[13px] font-semibold text-ok opacity-0';

/* ---- the posting board ---- */

export const board = cx('lp-board mt-5 overflow-hidden', passShell);

export const boardHead =
  'flex items-center justify-between gap-3 border-b border-line bg-card-alt px-5 py-3';
export const boardTitle = 'text-stamp-caps uppercase font-semibold text-ink-soft';
export const tag =
  'rounded-full border border-line bg-card px-2.5 py-0.5 text-[11px] font-medium text-mut';

export const boardRows = 'm-0 list-none p-0';
export const boardRow =
  'lp-board-row grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft px-5 py-3.25 last:border-b-0 ' +
  'max-[720px]:grid-cols-[70px_minmax(0,1fr)] max-[720px]:gap-x-3 max-[720px]:gap-y-2';
export const boardMeta =
  'grid min-w-0 gap-0.5 max-[720px]:col-span-full ' +
  '[&_b]:truncate [&_b]:text-[13.5px] [&_b]:font-semibold [&_b]:tracking-[-0.01em] [&_b]:text-ink ' +
  '[&>span]:truncate [&>span]:text-[11.5px] [&>span]:text-mut';
export const boardCoins =
  'lp-board-coins font-mono text-sm font-semibold text-ok tabular-nums max-[720px]:col-start-2 max-[720px]:row-start-1 max-[720px]:justify-self-end';

export const boardFoot =
  'flex items-baseline justify-between gap-3 border-t border-line bg-card-alt px-5 py-3 ' +
  '[&>span]:text-stamp-caps [&>span]:uppercase [&>span]:text-mut ' +
  '[&_b]:font-mono [&_b]:text-[17px] [&_b]:font-semibold [&_b]:text-ink [&_b]:tabular-nums';

const tierBase = 'justify-self-start rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize';
export const tierGuest = cx(tierBase, 'border-warn-line bg-warn-soft text-warn');
export const tierVerified = cx(tierBase, 'border-ok-line bg-ok-soft text-ok');
export const tier = (t: 'guest' | 'verified') => (t === 'guest' ? tierGuest : tierVerified);

/* ---- section frame ---- */

export const section = 'pt-28 max-[720px]:pt-20';

/* `lp-enter` gives every section head the same scroll-in the cards below it already have —
   without it the headings snapped in while their own content rose, which read as two pages. */
export const sectionHead = 'lp-enter mb-10 max-w-[62ch]';

/** a small labelled rule leading into the heading — structure, not decoration */
export const eyebrow =
  "mb-4 flex items-center gap-2.5 text-[12.5px] font-semibold tracking-[0.01em] text-accent-text " +
  "before:h-px before:w-7 before:bg-accent before:content-['']";

export const h2 = 'm-0 block text-display text-balance text-ink';

export const sub = 'mt-4 max-w-[60ch] text-[15.5px] leading-[1.62] text-ink-soft';

/* ---- the journey diagram ---- */

export const journey = 'lp-journey relative mb-6 grid grid-cols-4 px-1.5 max-[720px]:hidden';
export const journeyLine =
  'lp-journey-line absolute inset-[15px_6px_auto_6px] h-1 w-[calc(100%-12px)] overflow-visible';
export const journeyTrack = 'lp-journey-track [stroke-width:2] stroke-line';
export const journeyDraw =
  'lp-journey-draw [stroke-width:2] stroke-accent [stroke-dasharray:400] [stroke-dashoffset:0]';

export const journeyPoint = 'lp-journey-point relative flex flex-col items-center gap-2 pt-2';
// Activation is CSS-driven off `view()` (see landing.css).
export const journeyDot =
  'lp-journey-dot size-4 rounded-full border-2 border-line bg-card ' +
  'transition-[border-color,background-color,transform] duration-300';
export const journeyToken =
  'lp-journey-token pointer-events-none absolute top-2 size-2 rounded-full bg-ok opacity-0';
export const journeyLabel =
  'lp-journey-label text-stamp-caps uppercase text-mut transition-colors duration-300 max-[1000px]:hidden';

export const journeyTrigger = 'mt-5 [&>span]:text-[11px]';

/**
 * The journey modal is a native <dialog>, so the browser owns the focus trap, Esc, inertness
 * of the page behind, and the scrim (::backdrop). `m-auto` is what centres it: a dialog in
 * the top layer has no flex parent to be centred by.
 */
export const modalDialog =
  'm-auto w-[min(720px,calc(100vw-48px))] bg-transparent p-0 text-ink ' +
  'backdrop:bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]';
export const modal = 'relative w-full px-7 pt-8.5 pb-7';
export const modalClose =
  'absolute -top-3.5 -right-3.5 z-2 grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-card ' +
  'text-base leading-none text-ink-soft shadow-contact hover:bg-card-alt hover:text-ink';
export const modalVideo = 'mb-4 block aspect-[1280/800] w-full rounded-xl border border-line bg-card-alt';
export const modalBody = 'min-h-11 text-sm leading-[1.6] text-ink-soft';

/* ---- the route: four steps ---- */

export const strip =
  'grid grid-cols-4 overflow-hidden rounded-2xl border border-line bg-card shadow-contact ' +
  'max-[1000px]:grid-cols-2 max-[720px]:grid-cols-1';

export const leg =
  'lp-leg relative px-6.5 pt-7 pb-8 transition-colors duration-200 hover:bg-card-alt ' +
  '[&+&]:border-l [&+&]:border-l-line ' +
  'max-[1000px]:[&:nth-child(3)]:border-t max-[1000px]:[&:nth-child(3)]:border-t-line ' +
  'max-[1000px]:[&:nth-child(4)]:border-t max-[1000px]:[&:nth-child(4)]:border-t-line ' +
  'max-[1000px]:[&:nth-child(odd)]:border-l-0 ' +
  'max-[720px]:[&+&]:border-l-0 max-[720px]:[&+&]:border-t max-[720px]:[&+&]:border-t-line';

/** the step number, set as a figure rather than a coupon serial */
export const legNo =
  'grid size-7 place-items-center rounded-lg bg-accent-soft font-mono text-[12px] font-semibold text-accent-text';
export const legTitle = 'mt-4 mb-2.5 text-[17px] font-semibold tracking-[-0.02em] text-ink';
export const legBody = 'text-[15px] leading-[1.6] text-ink-soft';
export const legMeta =
  'mt-4 inline-block rounded-md border border-line-soft bg-card-alt px-2 py-1 font-mono text-[11.5px] text-mut';

/** a code chip sitting inside a sentence — no margin, so it does not break the line rhythm */
export const codeInline =
  'rounded-md border border-line-soft bg-card-alt px-1.5 py-0.5 font-mono text-[12.5px] text-ink-soft';

/* ---- the two rates ---- */

export const classes = 'grid grid-cols-2 gap-5 max-[720px]:grid-cols-1 max-[720px]:gap-4';

export function fareCard(verified: boolean) {
  return cx(
    'lp-enter relative flex flex-col rounded-2xl border bg-card px-7 pt-7 pb-7',
    'transition-[border-color,box-shadow] duration-200 hover:shadow-contact',
    verified ? 'lp-class-verified border-accent-line' : 'lp-class-guest border-line',
  );
}

export const fareTop = 'flex items-center justify-between gap-3.5';
export const fareTitle = 'text-[19px] font-semibold tracking-[-0.022em] text-ink';

export const fareAmount =
  'mt-6 mb-1.5 font-mono text-[42px] font-semibold tracking-[-0.045em] tabular-nums ' +
  '[&_small]:ml-2 [&_small]:font-sans [&_small]:text-[13px] [&_small]:font-medium [&_small]:tracking-normal [&_small]:text-mut';

export const fareMeter =
  'lp-meter mt-4 mb-5 h-1.5 overflow-hidden rounded-full bg-sunk [&_i]:block [&_i]:h-full [&_i]:origin-left [&_i]:rounded-full';

export const fareBody = 'text-[15px] leading-[1.62] text-ink-soft [&+p]:mt-3';

export const fareFoot = 'mt-auto border-t border-line-soft pt-5 text-[12.5px] text-mut';

/* ---- the budget planner ---- */

export const planner = cx(
  'lp-enter relative mt-5 overflow-hidden rounded-2xl border border-line bg-card',
  'grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] shadow-contact max-[860px]:grid-cols-[minmax(0,1fr)]',
);

export const plannerControls =
  'grid content-start gap-7 border-r border-line bg-card-alt px-7 py-8 ' +
  'max-[860px]:border-r-0 max-[860px]:border-b max-[720px]:px-6 max-[720px]:py-7';

export const plannerField = 'grid gap-3.5';
export const plannerLabel =
  'flex items-baseline justify-between gap-3 text-stamp-caps uppercase text-mut ' +
  '[&_b]:font-mono [&_b]:text-[13.5px] [&_b]:font-semibold [&_b]:text-ink [&_b]:tabular-nums';

/** native range input; the track fill and thumb are drawn in landing.css off `--pct` */
export const range = 'lp-range w-full cursor-grab appearance-none bg-transparent active:cursor-grabbing';

export const plannerOut =
  'grid grid-cols-3 gap-x-6 gap-y-7 px-8 py-8 max-[1000px]:grid-cols-1 max-[720px]:px-6 max-[720px]:py-7';

export const plannerFigure = 'grid content-start gap-1.5';
export const plannerNum =
  'font-mono text-[34px] font-semibold leading-none tracking-[-0.045em] text-ink tabular-nums max-[720px]:text-[28px]';
export const plannerCap = 'text-[13px] leading-[1.45] text-mut';

export const plannerNote =
  'col-span-full border-t border-line-soft px-8 py-5 text-[12.5px] leading-[1.6] text-mut max-[720px]:px-6';

/* ---- questions ---- */

export const faq = 'lp-faq lp-enter overflow-hidden rounded-2xl border border-line bg-card shadow-contact';

export const faqItem = 'lp-faq-item border-line-soft [&+&]:border-t';

export const faqQ =
  'flex cursor-pointer list-none items-start justify-between gap-5 px-7 py-5.5 ' +
  'text-[15.5px] font-semibold tracking-[-0.015em] text-ink select-none ' +
  'transition-colors duration-200 hover:bg-card-alt [&::-webkit-details-marker]:hidden ' +
  'max-[720px]:px-5 max-[720px]:py-5 max-[720px]:text-[15px]';

/** the plus rotates into a minus as the panel opens — one mark, two states */
export const faqMark =
  'lp-faq-mark mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text ' +
  'transition-[transform,background-color] duration-300 [&_svg]:size-3.5';

export const faqA =
  'px-7 pb-6 max-w-[80ch] text-[15px] leading-[1.62] text-ink-soft max-[720px]:px-5 max-[720px]:pb-5';

/* ---- who this is for ---- */

export const paths = 'grid grid-cols-2 gap-5 max-[720px]:grid-cols-1';

export const path = cx(
  'lp-enter flex flex-col rounded-2xl border border-line bg-card p-7',
  'transition-[border-color,box-shadow] duration-200 hover:shadow-contact hover:border-mut/40',
);

export const pathMark =
  'grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-text [&_svg]:size-5';
export const pathTitle = 'mt-4 text-[19px] font-semibold tracking-[-0.022em] text-ink';
export const pathBody = 'mt-2.5 text-[15px] leading-[1.6] text-ink-soft';
export const pathList =
  'mt-5 mb-6 grid gap-2.5 text-[14px] leading-[1.5] text-ink-soft ' +
  "[&_li]:relative [&_li]:pl-6 " +
  "[&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-[7px] [&_li]:before:size-1.5 [&_li]:before:rounded-full [&_li]:before:bg-accent [&_li]:before:content-['']";
export const pathFoot = 'mt-auto';

/* ---- the controls ---- */

export const rules = 'm-0 overflow-hidden rounded-2xl border border-line bg-card shadow-contact';

export const rule =
  'lp-enter lp-rule group grid grid-cols-[220px_minmax(0,1fr)_190px] items-baseline gap-6 px-7 py-6 ' +
  'transition-colors duration-200 hover:bg-card-alt [&+&]:border-t [&+&]:border-t-line-soft ' +
  'max-[1000px]:grid-cols-[200px_minmax(0,1fr)] max-[1000px]:p-6 ' +
  'max-[720px]:grid-cols-[minmax(0,1fr)] max-[720px]:gap-2 max-[720px]:px-5 max-[720px]:py-5.5';

export const ruleTerm = 'text-[14.5px] font-semibold tracking-[-0.015em] text-ink';
export const ruleBody = 'm-0 max-w-[66ch] text-[15px] leading-[1.6] text-ink-soft';
export const ruleVal =
  'm-0 text-right font-mono text-[12.5px] text-mut transition-colors duration-200 group-hover:text-accent-text ' +
  'max-[1000px]:col-start-2 max-[1000px]:text-left max-[720px]:col-start-1';

/* ---- close ---- */

export const close = 'pt-28 max-[720px]:pt-20';

/** the closing band: one surface, the argument's last line and its two doors */
export const closePass = cx(
  passShell,
  'grid grid-cols-[minmax(0,1fr)_300px] overflow-hidden max-[1000px]:grid-cols-[minmax(0,1fr)]',
);
export const closeMain = 'px-10 py-11 max-[720px]:px-6 max-[720px]:py-8';
export const closeStub =
  'flex flex-col justify-center gap-3.5 border-l border-line bg-card-alt px-7 py-10 ' +
  'max-[1000px]:border-l-0 max-[1000px]:border-t max-[720px]:px-6 max-[720px]:py-7 ' +
  '[&_p]:text-sm [&_p]:leading-[1.6] [&_p]:text-ink-soft';

export const foot =
  'mt-24 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-6 pb-10 ' +
  'text-[12.5px] text-mut max-[480px]:justify-start ' +
  '[&_a]:font-medium [&_a]:text-ink-soft [&_a]:no-underline hover:[&_a]:text-accent-text';

/** visually hidden, still read aloud */
export const srOnly = 'absolute size-px overflow-hidden p-0 whitespace-nowrap [clip-path:inset(50%)]';
