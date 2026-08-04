/**
 * Landing-page utility strings.
 *
 * Every static rule the landing used to carry in landing.css lives here as Tailwind
 * utilities. The `lp-*` class names that remain in the TSX are motion hooks only —
 * landing.css still owns the authored press sequence and the scroll-linked moves,
 * because @keyframes, @property and `animation-timeline: view()` ranges staggered by
 * :nth-of-type cannot be spelled as utility classes. See landing.css.
 */
import { cx } from '@/lib/tw';

export { cx };

/* ---- the stock itself ---- */

export const wrap = 'mx-auto w-[min(1160px,100%-48px)] max-[720px]:w-[calc(100%-32px)]';

/** every surface cut from card carries the fibre, tinting the card and never the type */
export const stocked =
  'relative isolate ' +
  "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:content-[''] " +
  'before:bg-[image:var(--fibre)] before:bg-[length:120px_120px] before:opacity-[.055] before:[mix-blend-mode:multiply]';

/** contact, not lift: a hairline lit edge, a tight contact shadow, one long cast */
export const passShell = 'relative isolate rounded-xl border border-line bg-card shadow-pass';

/** press furniture: registration crop marks around a trimmed card. Below the measure
 *  there is no bleed room, so they are dropped rather than crowded. */
export const cropped =
  "after:pointer-events-none after:absolute after:-inset-[21px] after:opacity-70 after:content-[''] " +
  'after:bg-[image:linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0),linear-gradient(var(--color-line)_0_0)] ' +
  'after:bg-no-repeat ' +
  'after:bg-[size:13px_1px,1px_13px,13px_1px,1px_13px,13px_1px,1px_13px,13px_1px,1px_13px] ' +
  'after:bg-[position:left_top,left_top,right_top,right_top,left_bottom,left_bottom,right_bottom,right_bottom] ' +
  'max-[1180px]:after:hidden';

/* ---- ticket vocabulary ---- */

export const field = 'grid gap-1';
export const fieldTerm = 'text-stamp uppercase text-mut';
export const fieldValue = 'm-0 font-mono text-[13px] tracking-[-0.01em] text-ink tabular-nums';

/** the tear line, biting a notch out of both edges of the card */
const NOTCH =
  'absolute left-1/2 size-5.5 -translate-x-1/2 rounded-full bg-paper shadow-notch ' +
  'max-[1000px]:top-1/2 max-[1000px]:bottom-auto max-[1000px]:translate-x-0 max-[1000px]:-translate-y-1/2';

export const perf = cx(
  'relative shrink-0 self-stretch max-[1000px]:h-[30px]',
  "before:absolute before:inset-y-3.5 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-[image:var(--perf-v)] before:content-['']",
  'max-[1000px]:before:inset-[50%_14px_auto_14px] max-[1000px]:before:h-0.5 max-[1000px]:before:w-auto',
  'max-[1000px]:before:translate-x-0 max-[1000px]:before:-translate-y-1/2 max-[1000px]:before:bg-[image:var(--perf-h)]',
);
export const notchTop = cx(NOTCH, '-top-[11px] max-[1000px]:-left-[11px]');
export const notchBottom = cx(NOTCH, '-bottom-[11px] max-[1000px]:-right-[11px] max-[1000px]:left-auto');

/* ---- nav ---- */

export const nav = 'lp-nav sticky top-0 z-30 border-b border-line bg-paper py-4';
export const navInner = cx(wrap, 'flex items-center justify-between gap-4.5');
/** the page feeding through the press — reading progress in validation ink */
export const navProgress = 'lp-nav-progress absolute inset-x-0 -bottom-px h-0.5 origin-left scale-x-0 bg-accent';

export const mark =
  'group flex items-center gap-2.5 text-sm font-[650] tracking-[-0.015em] whitespace-nowrap text-ink no-underline ' +
  'max-[480px]:text-[13px] ' +
  '[&_svg]:size-6.5 [&_svg]:shrink-0 [&_svg]:fill-ink [&_svg]:transition-[fill,rotate] [&_svg]:duration-200 ' +
  'hover:[&_svg]:fill-accent hover:[&_svg]:-rotate-4';

/* ---- buttons ---- */

/* No border colour here: a variant that sets its own would be racing this one for the
   same property, and utility order in the sheet — not in the attribute — would decide. */
const lpBtnBase =
  'relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border ' +
  'px-5 py-2.75 text-sm font-semibold tracking-[-0.005em] no-underline';

/** a key press: the button seats into the card and its printed edge disappears */
export const btn = cx(
  lpBtnBase,
  'border-transparent bg-accent text-white shadow-key transition-[background-color,transform,box-shadow,border-color] duration-150',
  'hover:bg-accent-hover hover:shadow-key-lit active:translate-y-px active:shadow-key-down',
);

/** ink soaking across the card from the left, rather than a state swap */
export const btnGhost = cx(
  lpBtnBase,
  'border-mut bg-transparent text-ink shadow-none',
  'bg-[image:linear-gradient(var(--color-card-alt)_0_0)] bg-no-repeat bg-[length:0%_100%]',
  'transition-[background-size,border-color,transform,color] duration-[.28s] ease-out',
  'hover:bg-[length:100%_100%] hover:border-ink active:translate-y-px',
);

export const btnLg = 'px-6.5 py-3.5 text-[15px]';

/* ---- hero ---- */

export const hero = 'lp-hero relative isolate pt-[46px] pb-3 max-[720px]:pt-6.5';

/** ambient backdrop in the system's own three inks, low enough to read as this
 *  product's colors rather than a generic SaaS wash */
export const heroGlow =
  'lp-hero-glow pointer-events-none absolute inset-[-80px_-10%_auto_-10%] -z-1 h-[620px] opacity-90 blur-[6px] ' +
  'bg-[radial-gradient(45%_55%_at_18%_20%,color-mix(in_srgb,var(--color-accent)_16%,transparent),transparent_70%),radial-gradient(38%_48%_at_82%_10%,color-mix(in_srgb,var(--color-warn-lit)_14%,transparent),transparent_72%),radial-gradient(40%_50%_at_55%_60%,color-mix(in_srgb,var(--color-ok)_10%,transparent),transparent_74%)]';

export const pass = 'lp-pass grid grid-cols-[minmax(0,1fr)_30px_320px] items-stretch max-[1000px]:grid-cols-[minmax(0,1fr)]';

export const coupon = 'px-10.5 pt-11 pb-10 max-[720px]:px-5.5 max-[720px]:pt-8 max-[720px]:pb-7';

export const routing =
  'lp-routing flex flex-wrap gap-x-7.5 gap-y-3 border-b border-line-soft pb-6 mb-7.5 ' +
  'max-[720px]:gap-x-5 max-[720px]:gap-y-2.5 max-[720px]:pb-5 max-[720px]:mb-6';

/** letterpress: the type is struck into the stock, lit from above */
export const h1 =
  'lp-h1 m-0 font-display text-[clamp(40px,6.2vw,80px)] font-extrabold [font-stretch:112%] ' +
  'leading-[0.94] tracking-[-0.036em] text-balance text-ink ' +
  '[text-shadow:0_1px_0_rgba(255,255,255,.9),0_-1px_0_rgba(26,23,18,.12)] ' +
  /* keeps "Pay for signups," on one line so the authored break still lands */
  'max-[720px]:text-[34px] ' +
  '[&_em]:relative [&_em]:not-italic [&_em]:text-accent [&_em]:[text-shadow:0_1px_0_rgba(255,255,255,.6)]';

export const lede =
  'lp-lede mt-6 max-w-[52ch] text-[16.5px] leading-[1.62] tracking-[-0.006em] text-ink-soft ' +
  '[&_b]:font-[650] [&_b]:text-ink';

export const cta = 'lp-cta mt-8 flex flex-wrap gap-3 max-[720px]:[&>*]:flex-[1_1_100%]';
export const ctaNote = 'lp-cta-note mt-4 text-[13px] text-mut';

/* ---- the stub ---- */

/** a security tint sits under it, the way a real instrument prints a guilloché
 *  ground that a photocopier cannot hold */
export const stub = cx(
  'lp-stub relative isolate flex flex-col gap-5 px-7.5 py-10',
  "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:content-['']",
  'before:bg-[image:var(--guilloche)] before:opacity-[.13]',
  'before:[mask-image:radial-gradient(120%_90%_at_60%_40%,var(--color-ink)_30%,transparent_78%)]',
  'max-[1000px]:grid max-[1000px]:grid-cols-[190px_minmax(0,1fr)] max-[1000px]:items-center',
  'max-[1000px]:gap-x-7 max-[1000px]:gap-y-3 max-[1000px]:px-8 max-[1000px]:pt-1 max-[1000px]:pb-9',
  'max-[720px]:grid-cols-[minmax(0,1fr)] max-[720px]:px-5.5 max-[720px]:pb-7',
);

export const codePlate =
  'lp-code relative overflow-hidden rounded-md border border-line-soft bg-white p-3.5 ' +
  'shadow-[0_1px_2px_rgba(26,23,18,.05)] max-[720px]:max-w-[210px] ' +
  '[&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:fill-ink';

export const scanSweep =
  'lp-scan absolute inset-x-0 top-0 h-[44%] border-b-2 border-accent opacity-0 ' +
  'bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-accent)_14%,transparent)_74%,color-mix(in_srgb,var(--color-accent)_30%,transparent))]';

/** the plate takes the reader's ring the instant the sweep clears the code */
export const codeRing = 'lp-code-ring absolute inset-0 rounded-md opacity-0 shadow-[0_0_0_2px_var(--color-accent)_inset]';

export const stubFields = 'lp-stub-fields m-0 grid gap-[15px] max-[1000px]:grid-cols-2 max-[720px]:grid-cols-1';

export const status = 'lp-status inline-grid';
export const statusIdle = 'lp-status-idle [grid-area:1/1] justify-self-start font-mono text-[13px] text-mut';
export const statusDone = 'lp-status-done [grid-area:1/1] justify-self-start font-mono text-[13px] font-semibold text-ok opacity-0';

/** the stub's tail: serial, revision and press number, the way stock is marked */
export const serial =
  'lp-serial mt-auto flex flex-wrap gap-x-2.5 gap-y-1 border-t border-dashed border-line pt-3.5 ' +
  'font-mono text-[10.5px] tracking-[0.02em] text-mut max-[1000px]:col-span-full max-[1000px]:mt-1';

/* ---- the posting board ---- */

export const board = cx(
  'lp-board relative mt-4.5 overflow-hidden rounded-lg border border-line bg-card shadow-board',
  /* a soft light-catch along the top edge, the one "glass" touch on this card */
  "after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-11 after:rounded-t-lg after:content-['']",
  'after:bg-[linear-gradient(to_bottom,color-mix(in_srgb,#fff_55%,transparent),transparent)]',
);

export const boardHead =
  'relative z-1 flex items-center justify-between gap-3 border-b border-line bg-card-alt px-5 py-3';
export const boardTitle = 'text-stamp uppercase text-ink-soft';
export const tag = 'rounded-sm border border-line px-2 py-0.75 text-[10px] font-bold tracking-[0.1em] uppercase text-mut';

export const boardRows = 'relative z-1 m-0 list-none p-0';
export const boardRow =
  'lp-board-row grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft px-5 py-3.25 last:border-b-0 ' +
  'max-[720px]:grid-cols-[70px_minmax(0,1fr)] max-[720px]:gap-x-3 max-[720px]:gap-y-2';
export const boardMeta =
  'grid min-w-0 gap-0.5 max-[720px]:col-span-full ' +
  '[&_b]:truncate [&_b]:text-[13.5px] [&_b]:font-semibold [&_b]:tracking-[-0.01em] [&_b]:text-ink ' +
  '[&>span]:truncate [&>span]:text-[11.5px] [&>span]:text-mut';
/** the ink setting on the page as the figure lands */
export const boardCoins =
  'lp-board-coins font-mono text-sm font-semibold text-ok tabular-nums max-[720px]:col-start-2 max-[720px]:row-start-1 max-[720px]:justify-self-end';

export const boardFoot =
  'flex items-baseline justify-between gap-3 border-t border-line bg-card-alt px-5 py-3 ' +
  '[&>span]:text-stamp [&>span]:uppercase [&>span]:text-mut ' +
  '[&_b]:font-mono [&_b]:text-[17px] [&_b]:font-semibold [&_b]:text-ink [&_b]:tabular-nums';

const tierBase =
  'justify-self-start rounded-sm border px-2.25 py-0.75 text-[10.5px] font-bold tracking-[0.06em] uppercase';
export const tierGuest = cx(tierBase, 'border-warn-line bg-warn-soft text-warn');
export const tierVerified = cx(tierBase, 'border-ok-line bg-ok-soft text-ok');
export const tier = (t: 'guest' | 'verified') => (t === 'guest' ? tierGuest : tierVerified);

/* ---- section frame ---- */

export const section = 'pt-27 max-[720px]:pt-19';

export const sectionHead = 'mb-10 max-w-[62ch]';

/** press furniture: the trim rule the sheet is cut along, with its registration tick
 *  struck in validation ink. Graphic structure, not a label. */
export const trim =
  'mb-8.5 h-px border-0 bg-[linear-gradient(to_right,var(--color-accent)_0_26px,color-mix(in_srgb,var(--color-ink)_26%,transparent)_26px)]';

export const h2 =
  'm-0 block font-display text-[clamp(28px,3.6vw,42px)] font-extrabold [font-stretch:108%] ' +
  'leading-[1.04] tracking-[-0.03em] normal-case text-balance text-ink ' +
  '[text-shadow:0_1px_0_rgba(255,255,255,.75)]';

export const sub = 'mt-4 max-w-[60ch] text-[15.5px] leading-[1.62] text-ink-soft';

/* ---- the journey diagram ---- */

export const journey =
  'lp-journey relative mb-5.5 grid grid-cols-4 px-1.5 max-[720px]:hidden';
export const journeyLine = 'lp-journey-line absolute inset-[15px_6px_auto_6px] h-1 w-[calc(100%-12px)] overflow-visible';
export const journeyTrack = 'lp-journey-track [stroke-width:2] stroke-line';
export const journeyDraw = 'lp-journey-draw [stroke-width:2] stroke-accent [stroke-dasharray:400] [stroke-dashoffset:0]';

export const journeyPoint = 'lp-journey-point relative flex flex-col items-center gap-2 pt-2';
export const journeyDot =
  'lp-journey-dot size-4 rounded-full border-2 border-line bg-card ' +
  'transition-[border-color,background-color,transform] duration-300 ' +
  'group-data-[active]:border-accent group-data-[active]:bg-accent group-data-[active]:scale-115';
export const journeyToken =
  'lp-journey-token pointer-events-none absolute top-2 size-2 rounded-full bg-ok opacity-0';
export const journeyLabel =
  'lp-journey-label text-stamp uppercase text-mut transition-colors duration-300 max-[1000px]:hidden';

export const journeyTrigger = 'mt-4.5 [&>span]:text-[11px]';

export const modalScrim =
  'fixed inset-0 z-100 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)] p-6';
export const modal = 'relative w-[min(720px,100%)] px-7 pt-8.5 pb-7';
export const modalClose =
  'absolute -top-3.5 -right-3.5 z-2 size-7 cursor-pointer rounded-full border border-line bg-card ' +
  'text-base leading-none text-ink-soft shadow-[0_2px_8px_-2px_rgba(26,23,18,.35)] hover:bg-card-alt hover:text-ink';
export const modalVideo =
  'mb-4 block aspect-[1280/800] w-full rounded-lg border border-line bg-card-alt';
export const modalBody = 'min-h-11 text-sm leading-[1.6] text-ink-soft';

/* ---- the route: four coupons on one strip ---- */

export const strip =
  'grid grid-cols-4 overflow-hidden rounded-lg border border-line bg-card shadow-strip ' +
  'max-[1000px]:grid-cols-2 max-[720px]:grid-cols-1';

export const leg =
  'lp-leg relative px-6.5 pt-7.5 pb-8 transition-colors duration-[.24s] ' +
  'hover:bg-[color-mix(in_srgb,var(--color-card-alt)_60%,transparent)] ' +
  "[&+&]:before:absolute [&+&]:before:inset-[18px_auto_18px_0] [&+&]:before:w-0.5 [&+&]:before:content-[''] " +
  '[&+&]:before:bg-[image:var(--perf-v)] ' +
  'max-[1000px]:[&:nth-child(3)]:border-t max-[1000px]:[&:nth-child(3)]:border-t-line-soft ' +
  'max-[1000px]:[&:nth-child(4)]:border-t max-[1000px]:[&:nth-child(4)]:border-t-line-soft ' +
  'max-[720px]:[&+&]:border-t max-[720px]:[&+&]:border-t-line-soft max-[720px]:[&+&]:before:content-none';

export const legNo = 'font-mono text-[11.5px] font-bold tracking-[0.1em] text-accent';
export const legTitle = 'mt-3.5 mb-2.5 text-[17px] font-[650] tracking-[-0.02em] text-ink';
export const legBody = 'text-[15px] leading-[1.6] text-ink-soft';
export const legMeta =
  'mt-3.5 inline-block rounded-sm border border-line-soft bg-card-alt px-1.75 py-0.75 font-mono text-[11.5px] text-mut';

/** a code chip sitting inside a sentence — no margin, so it does not break the line rhythm */
export const codeInline =
  'rounded-sm border border-line-soft bg-card-alt px-1.5 py-0.5 font-mono text-[12.5px] text-ink-soft';

/* ---- fare classes: guest vs verified ---- */

export const classes = 'grid grid-cols-2 gap-5 max-[720px]:grid-cols-1 max-[720px]:gap-4';

export function fareCard(verified: boolean) {
  return cx(
    'lp-enter relative flex flex-col overflow-hidden rounded-lg border bg-card px-7.5 pt-8 pb-7.5',
    'transition-[border-color,box-shadow] duration-[.24s]',
    'hover:border-[color-mix(in_srgb,var(--color-ink)_30%,var(--color-line))]',
    'hover:shadow-[0_1px_0_#fff_inset,0_18px_34px_-28px_rgba(26,23,18,.35)]',
    verified ? 'lp-class-verified border-[color-mix(in_srgb,var(--color-accent)_34%,var(--color-line))]' : 'lp-class-guest border-line',
  );
}

export const fareTop = 'flex items-center justify-between gap-3.5';
export const fareTitle = 'font-display text-2xl font-extrabold [font-stretch:108%] tracking-[-0.026em] text-ink';

/** struck across the card at an angle, with the uneven coverage of a real stamp */
export const fareStamp =
  'lp-stamp pointer-events-none absolute right-6 bottom-5.5 rounded-sm border-2 border-current px-3.5 pt-1.5 pb-1.25 ' +
  'text-[15px] font-extrabold tracking-[0.2em] uppercase opacity-[.34] -rotate-11 ' +
  '[mask-image:var(--distress)] [mask-size:110px_110px] ' +
  'max-[720px]:right-4.5 max-[720px]:bottom-4.5 max-[720px]:text-[13px]';

export const fareAmount =
  'my-6.5 mb-1.5 font-mono text-[44px] font-semibold tracking-[-0.045em] tabular-nums ' +
  '[&_small]:ml-2 [&_small]:text-[13px] [&_small]:font-medium [&_small]:tracking-normal [&_small]:text-mut';

export const fareMeter =
  'lp-meter my-5 mb-4.5 h-1.5 overflow-hidden rounded-full border border-line-soft bg-card-alt ' +
  '[&_i]:block [&_i]:h-full [&_i]:origin-left';

export const fareBody = 'text-[15px] leading-[1.62] text-ink-soft [&+p]:mt-3';

/** keeps the footnote clear of the struck stamp in the same corner */
export const fareFoot = 'mt-auto pt-5.5 pr-32 text-[12.5px] text-mut max-[720px]:pr-26';

/* ---- fare rules: the money controls, printed on the back ---- */

export const rules =
  'm-0 overflow-hidden rounded-lg border border-line bg-card shadow-rules';

export const rule =
  'lp-enter lp-rule group relative grid grid-cols-[220px_minmax(0,1fr)_190px] items-baseline gap-6 px-7.5 py-6.5 ' +
  'transition-colors duration-[.24s] hover:bg-[color-mix(in_srgb,var(--color-card-alt)_60%,transparent)] ' +
  "[&+&]:before:absolute [&+&]:before:inset-[0_22px_auto_22px] [&+&]:before:h-0.5 [&+&]:before:content-[''] " +
  '[&+&]:before:bg-[image:var(--perf-h)] ' +
  'max-[1000px]:grid-cols-[200px_minmax(0,1fr)] max-[1000px]:p-6 ' +
  'max-[720px]:grid-cols-[minmax(0,1fr)] max-[720px]:gap-2 max-[720px]:px-5 max-[720px]:py-5.5 ' +
  'max-[720px]:[&+&]:before:inset-[0_16px_auto_16px]';

export const ruleTerm = 'text-[14.5px] font-[650] tracking-[-0.015em] text-ink';
export const ruleBody = 'm-0 max-w-[66ch] text-[15px] leading-[1.6] text-ink-soft';
export const ruleVal =
  'm-0 text-right font-mono text-[12.5px] text-mut transition-colors duration-200 group-hover:text-accent ' +
  'max-[1000px]:col-start-2 max-[1000px]:text-left max-[720px]:col-start-1';

/* ---- close ---- */

export const close = 'pt-27 max-[720px]:pt-19';
export const closePass = 'grid grid-cols-[minmax(0,1fr)_30px_300px] max-[1000px]:grid-cols-[minmax(0,1fr)]';
export const closeMain = 'px-10.5 py-11.5 max-[720px]:px-5.5 max-[720px]:pt-8 max-[720px]:pb-7';
export const closeStub =
  'flex flex-col justify-center gap-3.5 px-7.5 py-10 ' +
  'max-[1000px]:px-8 max-[1000px]:pt-1 max-[1000px]:pb-9 max-[720px]:px-5.5 max-[720px]:pb-7 ' +
  '[&_p]:text-sm [&_p]:leading-[1.6] [&_p]:text-ink-soft';

export const foot =
  'mt-23 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-6 pb-10 ' +
  'text-[12.5px] text-ink-soft max-[480px]:justify-start ' +
  '[&_a]:font-medium [&_a]:text-ink-soft [&_a]:no-underline hover:[&_a]:text-accent';

export const footPress = 'font-mono text-[10.5px] tracking-[0.12em] uppercase text-ink-soft';

/** visually hidden, still read aloud */
export const srOnly = 'absolute size-px overflow-hidden p-0 whitespace-nowrap [clip-path:inset(50%)]';
