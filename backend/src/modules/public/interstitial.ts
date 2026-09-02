/**
 * The one screen an actual scanner sees.
 *
 * Everything else in this product is a console for the two businesses on either side of a
 * campaign. This page is for the person who just pointed a camera at a printed code, and it
 * exists for a functional reason before an aesthetic one: iOS has no install-referrer channel,
 * so the only moment we can read this device's timezone, screen geometry, core count and
 * appearance is right here, in a browser, before the App Store takes the session away.
 *
 * The page is dressed as the printed stub being validated — a reader sweep across the code
 * plate, stamped labels over monospace values, and a progress rule that feeds for exactly as
 * long as the hold lasts. The header row answers "where am I going" without a sentence: the
 * code plate, a dotted route, and the destination store's own tile at the far end.
 *
 * Three constraints shape the implementation, each ruling out an otherwise obvious choice:
 *
 *   Self-contained.  CSP is `default-src 'none'` across this API; this page relaxes it only to
 *                    a nonce for its own inline style and script, plus `data:` for the fibre
 *                    tile. Nothing loads over the network — no webfont (a blocking request on a
 *                    page that lives one second) and no vendor-hosted store badge.
 *
 *   Front-loaded.    ~900ms before the hand-off begins, so everything lands inside the first
 *                    560ms and the loops carry the remainder.
 *
 *   Legible at rest. Under `prefers-reduced-motion`, and with script blocked entirely, every
 *                    word is on screen and the store link still works.
 */

/**
 * How long the page is held before the hand-off starts.
 *
 * Not decoration: a `location.replace` fired in the same tick as page load is swallowed by
 * in-app webviews (Instagram, TikTok), and a beat lets the scanner see the scan was accepted.
 *
 * ponytail: fixed hold. If measured drop-off between scan and store install ever justifies it,
 * shorten it — `client.held_ms` on every scan row is exactly the measurement to shorten it
 * against.
 */
const HOLD_MS = 900;

/**
 * The hold when this page is carrying a claim: long enough that the tap is what normally
 * happens, short enough that nobody is stranded.
 *
 * Safari only permits a clipboard write inside a user gesture, so on iOS the scanner's tap is
 * the carrier — an auto-hand-off at 900ms would mean nobody ever taps and every install is
 * organic. This is the bail-out for someone who put the phone down: they still reach the
 * store, simply unattributed, which is a true answer rather than a failure.
 */
const CARRY_HOLD_MS = 9000;

/** The hand-off itself: card away, store tile forward. Runs after the hold, then it navigates. */
const EXIT_MS = 340;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Laid fibre, as a data URI rather than a file: one request fewer on a page whose whole job
 * is to get out of the way. `feTurbulence` at 5.5% multiplied is the same tile the console
 * uses, so a scanner who later sees the portal is looking at the same stock.
 */
const FIBRE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23f)' opacity='.5'/%3E%3C/svg%3E\")";

/** Which listing this scan is being handed to. Only the shape matters here, not the platform. */
export type Store = 'ios' | 'android' | 'web';

/**
 * The destination's own mark, drawn rather than fetched.
 *
 * Real brand colours, against the house duotone rule: this tile's whole job is instant
 * recognition of where the next tap lands, and a recoloured store badge is not the store badge.
 * The geometry is authored rather than traced — unmistakable at 62px, and not passed off as the
 * vendors' official asset.
 */
const MARKS: Record<Store, { heading: string; title: string; svg: string }> = {
  ios: {
    heading: 'Opening the App Store',
    title: 'App Store',
    // The stylised "A": two legs from a rounded apex, a crossbar, and the short descender tick
    // that keeps it from reading as a plain letter.
    svg: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff"
       stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12.3 5.9 5.75 17.3"/><path d="M12.3 5.9 18.85 17.3"/>
    <path d="M7.5 14.35h9.6"/><path d="M9.1 17.3 8.15 18.95"/>
  </svg>`,
  },
  android: {
    heading: 'Opening Google Play',
    title: 'Google Play',
    // Four facets folded about the spine: left, top, bottom, and the rhombus at the tip. Each
    // one is a flat gradient, which is what gives the mark its fold without a single filter.
    svg: `<svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
    <defs>
      <linearGradient id="pl" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#00A0FF"/><stop offset="1" stop-color="#00E3FF"/>
      </linearGradient>
      <linearGradient id="pt" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#00E176"/><stop offset="1" stop-color="#00C55B"/>
      </linearGradient>
      <linearGradient id="pb" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#C31162"/><stop offset="1" stop-color="#FF3A44"/>
      </linearGradient>
      <linearGradient id="pr" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFE000"/><stop offset="1" stop-color="#FF9C00"/>
      </linearGradient>
    </defs>
    <path class="fl" fill="url(#pl)" d="M4.2 2.2 13.4 12 4.2 21.8Z"/>
    <path class="ft" fill="url(#pt)" d="M4.2 2.2 18 9.35 13.4 12Z"/>
    <path class="fb" fill="url(#pb)" d="M4.2 21.8 18 14.65 13.4 12Z"/>
    <path class="fr" fill="url(#pr)" d="M18 9.35 20.9 11c.7.4.7 1.6 0 2l-2.9 1.65L13.4 12Z"/>
  </svg>`,
  },
  web: {
    // Filled in by the caller with the publisher's own name: "Opening their site" reads as
    // nowhere, and this tile is the one case where the destination has no name of its own.
    heading: '',
    title: 'Website',
    svg: `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff"
       stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/>
    <path d="M12 3.6c2.4 2.4 3.5 5.4 3.5 8.4s-1.1 6-3.5 8.4c-2.4-2.4-3.5-5.4-3.5-8.4s1.1-6 3.5-8.4Z"/>
  </svg>`,
  },
};

interface InterstitialCopy {
  /** the publisher's org name — the destination this scan routes to */
  destination: string;
  /** where the Continue link and the scripted redirect both point */
  go: string;
  nonce: string;
  /** which listing the scan resolves to; picks the tile, the headline and the title */
  store: Store;
  /**
   * Whether the scanner's tap has to carry the claim to the clipboard — iOS with no App Clip.
   * It changes the timings as much as the copy: every automatic exit has to sit behind the
   * tap, or the page leaves before anyone can press anything.
   */
  carry?: boolean;
}

export function interstitialHtml({
  destination,
  go,
  nonce,
  store,
  carry = false,
}: InterstitialCopy): string {
  const href = esc(go);
  const hold = carry ? CARRY_HOLD_MS : HOLD_MS;
  // The no-script fallback must outlast the scripted one, or the two race and the slower path
  // wins on a fast phone. `+3s` keeps that true for both holds.
  const refresh = Math.ceil(hold / 1000) + 3;
  const dest = esc(destination);
  const mark = MARKS[store] ?? MARKS.web;
  const heading = mark.heading || `Opening ${destination}`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(heading)} — scan accepted</title>
<!-- No-script and script-error fallback. Deliberately longer than the scripted hold so the
     two never race: script wins whenever it runs at all. -->
<meta http-equiv="refresh" content="${refresh};url=${href}">
<style nonce="${nonce}">
/* The Committed Stock Rule: this world does not follow the OS theme, so every inherited
   value is restated. A half-inherited dark palette here is thermal ink on a dark ground —
   invisible type on the one screen a real scanner ever sees. */
:root{
  color-scheme:light;
  --paper:#e7ddc9; --stock:#faf6ee; --stock-sunk:#f3ecdd;
  --ink:#1a1712; --ink-soft:#4e483a; --ink-mute:#6f6757;
  --rule:#d8cbb2; --rule-soft:#e6dcc7;
  --blue:#1c39bb; --blue-lit:#2a4ae0; --blue-deep:#142a8c;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  --hold:${hold}ms; --exit:${EXIT_MS}ms;
}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100svh; background:var(--paper); color:var(--ink);
  font:400 15px/1.6 var(--sans); letter-spacing:-.006em;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  display:grid; place-items:center;
  /* Notched phones are the entire audience here, so the safe area is padding, not a guess. */
  padding:clamp(16px,5vw,40px);
  padding-top:max(clamp(16px,5vw,40px),env(safe-area-inset-top));
  padding-bottom:max(clamp(16px,5vw,40px),env(safe-area-inset-bottom));
  overflow:hidden; /* the hand-off scales the card past its resting box */
}
/* The desk has its own grain, coarser than the card's. */
body::before{
  content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
  background-image:${FIBRE}; background-size:180px; opacity:.05; mix-blend-mode:multiply;
}
/* The pool of light the card is lying in. Transparent across the middle on purpose: the
   perforation notches are punched in var(--paper) and must match the desk exactly where they
   sit, so the falloff only ever starts outside the card. */
body::after{
  content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
  background:radial-gradient(116% 80% at 50% 32%,transparent 44%,rgba(26,23,18,.15) 100%);
}

/* ---------- the pass ---------- */
.pass{
  position:relative; z-index:1; isolation:isolate;
  width:100%; max-width:400px;
  /* Raking light rather than a flat fill — the same source the inset hairlines below already
     imply, so the stock reads as lit paper instead of a swatch. Static: a moving specular on a
     400px card is a full repaint every frame on the cheap Androids that scan most of these. */
  background:linear-gradient(168deg,#fdfaf4,var(--stock) 44%,#f4eee0);
  border-radius:14px;
  /* Lying on the desk: two inset hairlines for a lit top edge and a shaded bottom one, a
     tight contact pair, and a long negative-spread cast. Never a lift, never coloured. */
  box-shadow:
    0 1px 0 #fff inset, 0 -1px 0 rgba(26,23,18,.05) inset,
    0 1px 2px rgba(26,23,18,.05),
    0 10px 18px -14px rgba(26,23,18,.3),
    0 44px 64px -42px rgba(26,23,18,.55);
}
.pass::before{
  content:""; position:absolute; inset:0; z-index:-1; border-radius:inherit;
  background-image:${FIBRE}; background-size:140px; opacity:.055; mix-blend-mode:multiply;
}
.coupon{padding:clamp(26px,7vw,34px) clamp(22px,6vw,30px) clamp(22px,6vw,28px)}

/* Every section of this world opens on a trim rule whose first 26px is the registration
   tick, struck in validation ink. */
.trim{height:1px; background:rgba(26,23,18,.26); position:relative; margin-bottom:22px}
.trim::before{content:""; position:absolute; left:0; top:0; width:26px; height:1px; background:var(--blue)}

/* ---------- the route: code plate → store tile ---------- */
.head{display:flex; align-items:center; gap:12px; margin-bottom:22px}

.plate{
  position:relative; width:62px; height:62px; flex:none; border-radius:6px;
  background:var(--stock-sunk); border:1px solid var(--rule);
  display:grid; place-items:center; overflow:hidden;
}
.plate svg{display:block; color:var(--ink)}
/* The validation loop: the reader crossing the plate. Same idiom as the console's scan
   sweep, and the plate's only looping element. The beam has a trail behind its leading edge,
   which is what separates a reader crossing glass from a div sliding down. */
.sweep{
  position:absolute; left:0; right:0; height:14px; top:0;
  background:linear-gradient(180deg,rgba(28,57,187,0),rgba(28,57,187,.16) 62%,var(--blue) 100%);
  opacity:0;
}

/* The route is drawn as printed furniture — a perforated hairline, the same one the console
   uses for a scale ceiling — with three units of traffic on it. At rest they are three dots
   spaced along the line, which is a legible diagram of a redirect on its own. */
.route{position:relative; flex:1; min-width:24px; height:16px}
.route::before{
  content:""; position:absolute; left:0; right:0; top:50%; height:1px; transform:translateY(-50%);
  background:repeating-linear-gradient(90deg,var(--rule) 0 4px,transparent 4px 9px);
}
.route i{
  position:absolute; top:50%; width:5px; height:5px; margin:-2.5px 0 0 -2.5px; border-radius:50%;
  background:var(--blue); opacity:.3;
}
.route i:nth-child(1){left:20%}
.route i:nth-child(2){left:50%}
.route i:nth-child(3){left:80%}

/* The destination's tile. A real app icon: squircle-ish radius, a lit top edge, a contact
   shadow and a long cast — the one object on this page that is not printed, because it is a
   picture of software rather than of stationery. */
/* The tile casts its own light onto the stock around it. This is the one object on the page
   that is emissive rather than printed, and the bloom is what says so — it is also the thing
   that grows into the hand-off, so the last frame before the store is the destination's own
   colour filling the screen rather than a card fading out. */
.dest{position:relative; flex:none}
.dest::before{
  content:""; position:absolute; inset:-30%; z-index:0; border-radius:50%; pointer-events:none;
  background:radial-gradient(closest-side,var(--bloom),transparent 74%);
  filter:blur(8px); opacity:.55;
}
.tile{
  position:relative; z-index:1; width:62px; height:62px; flex:none; border-radius:15px;
  display:grid; place-items:center; overflow:hidden;
  box-shadow:
    0 1px 0 rgba(255,255,255,.45) inset, 0 0 0 1px rgba(26,23,18,.08),
    0 1px 2px rgba(26,23,18,.16), 0 14px 24px -14px rgba(26,23,18,.6);
}
.tile svg{display:block; position:relative; z-index:1}
.tile.ios{background:linear-gradient(155deg,#28b8ff,#0a63f5)}
.tile.android{background:linear-gradient(155deg,#fff,#e9edf4)}
.tile.web{background:linear-gradient(155deg,#39415a,#161b26)}
/* The bloom is the tile's own light, so it is the tile's own colour — the same reason the
   marks are not recoloured into press blue. */
.dest.ios{--bloom:rgba(30,124,255,.62)}
.dest.android{--bloom:rgba(0,186,110,.42)}
.dest.web{--bloom:rgba(70,86,128,.5)}
/* Specular pass across the glass. Parked off the left edge so it is invisible at rest. */
.tile::after{
  content:""; position:absolute; inset:-30%; z-index:2; pointer-events:none;
  background:linear-gradient(112deg,transparent 40%,rgba(255,255,255,.5) 50%,transparent 60%);
  transform:translateX(-130%);
}

/* ---------- type ---------- */
h1{
  margin:0 0 10px; font-family:var(--sans);
  font-size:clamp(27px,7.4vw,33px); font-weight:800; line-height:1.06; letter-spacing:-.032em;
  /* Letterpress relief — struck into the stock under a light from above. A relief, never a
     glow, and never coloured. */
  text-shadow:0 1px 0 #fff, 0 -1px 0 rgba(26,23,18,.14);
  text-wrap:balance;
}
.lede{margin:0; color:var(--ink-soft); font-size:15px; line-height:1.55; max-width:34ch}

/* The Stamped Field Rule: a 10px caps label at .14em, its value in monospace beneath.
   Never a sentence, never a colon. */
.fields{display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:16px 12px; margin:24px 0 0}
.label{font-size:10px; font-weight:700; line-height:1.2; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-mute); margin-bottom:4px}
.value{font-family:var(--mono); font-size:13px; line-height:1.4; letter-spacing:-.01em; color:var(--ink); word-break:break-word}
.value.ok{color:var(--blue); display:flex; align-items:center; gap:5px}
.value.ok svg{flex:none}

/* ---------- perforation + stub ---------- */
.perf{position:relative; height:1px; margin:26px 0 0;
  background:repeating-linear-gradient(90deg,var(--rule) 0 5px,transparent 5px 11px)}
/* Notches filled with the page ground, so the card reads as physically punched — with the
   stock's cut edge shadowed on the side the light comes from. */
.perf::before,.perf::after{
  content:""; position:absolute; top:50%; width:22px; height:22px; border-radius:50%;
  background:var(--paper); transform:translateY(-50%);
  box-shadow:inset 1px 1px 2px rgba(26,23,18,.14);
}
.perf::before{left:-11px}
.perf::after{right:-11px}

.stub{padding:20px clamp(22px,6vw,30px) clamp(22px,6vw,26px); position:relative}
.track{height:3px; border-radius:999px; background:var(--rule-soft); overflow:hidden;
  box-shadow:inset 0 1px 1px rgba(26,23,18,.07)}
/* The gradient is painted before the scaleX, so the lit end stays pinned to the bar's leading
   edge for the whole feed — the rule has a head, the way a printer's does. */
.bar{display:block; height:100%; width:100%; transform-origin:left center; transform:scaleX(0);
  background:linear-gradient(90deg,var(--blue-deep),var(--blue) 55%,var(--blue-lit) 94%,#7f97ff)}
.note{margin:14px 0 0; font-size:11.5px; line-height:1.45; color:var(--ink-mute)}

/* ---------- the manual key ---------- */
.go{
  display:flex; align-items:center; justify-content:center; gap:8px;
  margin-top:18px; padding:13px 20px; border-radius:8px;
  background:linear-gradient(180deg,var(--blue-lit),var(--blue) 56%,var(--blue-deep));
  color:#fff; text-decoration:none;
  font-size:15px; font-weight:600; letter-spacing:-.006em;
  /* Seated key: a lit top bevel, a printed edge under the control, and a short cast onto the
     stub. All three collapse on press, so the key travels rather than just tinting. */
  box-shadow:
    0 1px 0 rgba(255,255,255,.24) inset,
    0 1px 0 var(--blue-deep), 0 2px 3px rgba(20,42,140,.26),
    0 10px 18px -10px rgba(20,42,140,.5);
  /* filter rather than background: a gradient does not interpolate, and a key that snaps
     colour on press is the one place on this page a scanner would feel the seam. */
  transition:filter .12s linear, transform .06s linear, box-shadow .06s linear;
}
.go:hover{filter:brightness(1.08)}
.go:active{transform:translateY(1px);
  box-shadow:0 1px 0 rgba(255,255,255,.24) inset, 0 0 0 var(--blue-deep)}
.go:focus-visible{outline:2px solid var(--blue); outline-offset:3px}

/* Landscape on a short phone: the card must never need scrolling to reach the key. */
@media (max-height:560px){
  .coupon{padding-top:20px; padding-bottom:18px}
  .head{margin-bottom:14px}
  .plate,.tile{width:48px; height:48px}
  .tile{border-radius:12px}
  .fields{margin-top:18px; gap:12px}
  h1{font-size:24px}
  .lede{display:none}
}

/* ---------- the authored moment: the stub is read ----------
   One rehearsed sequence, ~560ms end to end, exponential ease-out. Everything is fully
   legible with animation off — these rules only ever animate *to* the resting state. */
@media (prefers-reduced-motion:no-preference){
  /* The card is dropped onto the desk, not blurred into focus: a filter on a 400px surface is
     the one uncomposited frame budget item on this page, and the first paint is exactly where
     a mid-range handset cannot afford it. The small elements below still get the blur. */
  .pass{animation:settle .42s cubic-bezier(.16,1,.3,1) both}
  .plate{animation:land .34s cubic-bezier(.16,1,.3,1) .04s both}
  /* The sweep runs twice inside the hold and stops — a loop nobody is left to watch is
     the kind of animation this system's motion rules exist to forbid. */
  .sweep{animation:sweep .62s cubic-bezier(.5,0,.5,1) .1s 2}
  /* The tile is the last thing to arrive and it arrives from depth, because it is the only
     object here that is not on the desk. */
  .tile{animation:seat .42s cubic-bezier(.16,1,.3,1) .16s both}
  /* The light arrives with the object that emits it, one beat behind the seat so it reads as
     the tile switching on rather than a glow that was always there. */
  .dest::before{animation:bloom .52s cubic-bezier(.16,1,.3,1) .22s both}
  .tile::after{animation:glint 1.15s cubic-bezier(.4,0,.2,1) .34s 2}
  /* Traffic on the route, in the direction the scan is about to travel. Two passes, ending
     as the hand-off takes over from it. */
  .route i{animation:travel .8s cubic-bezier(.55,0,.45,1) 2}
  .route i:nth-child(1){animation-delay:.20s}
  .route i:nth-child(2){animation-delay:.33s}
  .route i:nth-child(3){animation-delay:.46s}
  h1{animation:strike .38s cubic-bezier(.16,1,.3,1) .1s both}
  .lede{animation:land .3s cubic-bezier(.16,1,.3,1) .18s both}
  /* Stamped in sequence, the way the press lays plates. */
  .f1{animation:stamp .26s cubic-bezier(.16,1,.3,1) .24s both}
  .f2{animation:stamp .26s cubic-bezier(.16,1,.3,1) .32s both}
  .f3{animation:stamp .26s cubic-bezier(.16,1,.3,1) .40s both}
  .perf,.stub{animation:land .3s cubic-bezier(.16,1,.3,1) .3s both}
  /* Honest progress: the rule feeds for exactly the hold, so it completes as the hand-off
     begins rather than looping past it like an indeterminate bar. Linear, because it is
     measuring elapsed time and an eased one would misreport it. */
  .bar{animation:feed var(--hold) linear .06s both}

  /* ---------- the hand-off ----------
     Set by script the moment the destination is committed to, from either trigger. The card
     is finished with, so it recedes; the tile is what the reader is going to, so it comes
     forward and holds full strength until the stock around it has gone. Standard ease-in-out,
     not the arrival curve — this is a departure, and it should read as one. */
  body.leaving .pass{animation:recede var(--exit) cubic-bezier(.4,0,.2,1) forwards}
  body.leaving .tile{animation:launch var(--exit) cubic-bezier(.4,0,.2,1) forwards}
  /* The bloom opens past the card's edge while the stock is still at full opacity, so the
     dominant thing in the last frames is the destination's own colour. */
  body.leaving .dest::before{animation:flare var(--exit) cubic-bezier(.4,0,.2,1) forwards}
  body.leaving .route i{animation:rush .26s cubic-bezier(.5,0,1,1) forwards}
  body.leaving .route i:nth-child(2){animation-delay:.04s}
  body.leaving .route i:nth-child(3){animation-delay:.08s}
  body.leaving .bar{animation:none; transform:scaleX(1)}
}
@keyframes land{from{opacity:0; transform:translateY(9px); filter:blur(6px)}
  to{opacity:1; transform:none; filter:none}}
/* Dropped flat onto the desk. Transform and opacity only — this one runs on the whole card. */
@keyframes settle{from{opacity:0; transform:translateY(14px) scale(.986)}
  to{opacity:1; transform:none}}
/* The display line struck by a bottom-up wipe — the second plate of the press run. */
@keyframes strike{from{opacity:0; clip-path:inset(100% 0 0 0); transform:translateY(4px)}
  to{opacity:1; clip-path:inset(0 0 0 0); transform:none}}
@keyframes stamp{from{opacity:0; transform:translateY(5px) scale(.985)}
  to{opacity:1; transform:none}}
/* Starts with the beam's head just inside the top edge and its trail off-plate, ends with the
   head off the bottom — so the plate is never showing a stopped bar of colour. */
@keyframes sweep{0%{opacity:0; top:-14px} 14%{opacity:1} 86%{opacity:1} 100%{opacity:0; top:100%}}
@keyframes feed{from{transform:scaleX(0)} to{transform:scaleX(1)}}
/* Seated from above and behind, the way an icon settles onto a home screen. */
@keyframes seat{from{opacity:0; transform:scale(.78) translateY(-6px)} to{opacity:1; transform:none}}
@keyframes glint{0%{transform:translateX(-130%)} 55%,100%{transform:translateX(130%)}}
@keyframes bloom{from{opacity:0; transform:scale(.5)} to{opacity:.55; transform:none}}
@keyframes flare{to{opacity:1; transform:scale(2.4)}}
/* Stretched at speed and round again at either end: a unit of traffic, not a sliding dot. */
@keyframes travel{0%{opacity:0; transform:none} 18%{opacity:1}
  54%{transform:translateX(24px) scaleX(2.4)}
  82%{opacity:1} 100%{opacity:0; transform:translateX(46px) scaleX(1)}}
@keyframes rush{to{opacity:0; transform:translateX(80px) scaleX(2.4)}}
/* Opacity holds through the first half so the tile is never dimmed by its own parent while
   it is the thing being looked at. */
@keyframes recede{0%{opacity:1; transform:none}
  55%{opacity:1}
  100%{opacity:0; transform:scale(.94) translateY(-14px)}}
@keyframes launch{to{transform:scale(1.5) translateY(-8px)}}
</style></head>
<body>
<main class="pass">
  <div class="coupon">
    <div class="trim"></div>

    <div class="head">
      <div class="plate" aria-hidden="true">
        <!-- A QR finder pattern: the mark the camera actually locked onto a moment ago.
             Drawn, not an icon font, so it inherits ink and needs no request. -->
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="2.4">
          <rect x="1.2" y="1.2" width="11" height="11" rx="1.6"/>
          <rect x="21.8" y="1.2" width="11" height="11" rx="1.6"/>
          <rect x="1.2" y="21.8" width="11" height="11" rx="1.6"/>
          <rect x="5.6" y="5.6" width="2.2" height="2.2" stroke-width="2.2"/>
          <rect x="26.2" y="5.6" width="2.2" height="2.2" stroke-width="2.2"/>
          <rect x="5.6" y="26.2" width="2.2" height="2.2" stroke-width="2.2"/>
          <path d="M21.8 21.8h4M30 21.8h2.8M21.8 26.6h2.6M28 26.6h4.8M21.8 31.4h6M31 31.4h1.8"
                stroke-linecap="round" stroke-width="2.2"/>
        </svg>
        <span class="sweep"></span>
      </div>

      <div class="route" aria-hidden="true"><i></i><i></i><i></i></div>

      <div class="dest ${store}">
        <div class="tile ${store}" role="img" aria-label="${esc(mark.title)}">${mark.svg}</div>
      </div>
    </div>

    <h1>${esc(heading).replace(/ ([^ ]+)$/, '&nbsp;$1')}</h1>
    <p class="lede">${
      store === 'web'
        ? 'Your scan was accepted. Your welcome bonus is waiting on the other side.'
        : 'Your scan was accepted. Install the app and your welcome bonus is waiting inside it.'
    }</p>

    <div class="fields">
      <div class="f1">
        <div class="label">Scan</div>
        <div class="value ok">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 7.4 5.4 11 12 3.4"/>
          </svg>Accepted
        </div>
      </div>
      <div class="f2">
        <div class="label">Destination</div>
        <div class="value">${dest}</div>
      </div>
      <div class="f3">
        <div class="label">Issued</div>
        <!-- Filled by script from the device clock. Static fallback is the honest one: with
             no script we genuinely do not know this device's local time. -->
        <div class="value" id="issued">—</div>
      </div>
    </div>
  </div>

  <div class="perf" aria-hidden="true"></div>

  <div class="stub">
    <div class="track" aria-hidden="true"><span class="bar"></span></div>
    <a class="go" href="${href}">
      Continue
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 1.6v8.6M4.4 6.8 8 10.4l3.6-3.6M2 11.4v1.4a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6v-1.4"/>
      </svg>
    </a>
    <p class="note">${
      carry
        ? 'Continue keeps this scan linked to your install. Nothing to enter, nothing to redeem.'
        : 'No code to enter. Nothing to copy. Your bonus is handled inside the app.'
    }</p>
  </div>
</main>

<script nonce="${nonce}">
(function(){
  var GO = ${JSON.stringify(go)}, HOLD = ${hold}, EXIT = ${EXIT_MS};
  var CARRY = ${carry ? 'true' : 'false'};
  var t0 = Date.now();

  // Local clock, printed as a field. Purely presentational — the row this page actually
  // writes is timestamped server-side, where a device cannot lie about it.
  try{
    var d = new Date();
    var p = function(n){ return (n<10?'0':'') + n; };
    document.getElementById('issued').textContent = p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  }catch(e){}

  var mq = function(s){ try{ return !!(window.matchMedia && window.matchMedia(s).matches); }catch(e){ return false; } };
  var reduced = mq('(prefers-reduced-motion: reduce)');

  /**
   * The carrier.
   *
   * Safari permits writeText only inside a user gesture, which is exactly why the Continue
   * key is a real control on this page rather than decoration. What lands on the clipboard is
   * the same URL this page is about to navigate to: an opaque claim id on our own origin,
   * inert without the publisher's server-side API key, and the honest description of where
   * this scan just went if the scanner ever pastes it anywhere.
   *
   * Wrapped and ignored on failure. A refused clipboard is an unattributed install, which is
   * a true outcome; a thrown one would strand the scanner on a page whose only job is to
   * leave, which is not.
   */
  var carried = false;
  var carry = function(){
    if(carried || !CARRY) return;
    carried = true;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(GO);
    }catch(e){}
  };

  // The href is left exactly as the server rendered it: if anything here throws, or the tap
  // lands before this script finishes, the anchor is still a real link to a real URL.
  var link = document.querySelector('.go');

  var gone = false;
  var leave = function(via){
    if(gone) return;
    gone = true;
    var url = GO + '?via=' + via + '&held=' + (Date.now() - t0);
    // Reduced motion means there is no sequence left to watch, so nothing is held for.
    if(reduced){
      // replace(), not assign(): coming back from the store must not land here again.
      location.replace(url);
      return;
    }
    document.body.className = 'leaving';
    setTimeout(function(){ location.replace(url); }, EXIT);
  };

  // The tap is one event, not two competing navigations: it carries, then it hands off.
  if(link) link.addEventListener('click', function(ev){
    ev.preventDefault();
    carry();
    leave('tap');
  });

  // The bail-out. On a carrying page this is deliberately long — see CARRY_HOLD_MS — and it
  // does NOT carry: a clipboard write outside a gesture is refused by Safari anyway, and
  // writing to someone's clipboard when they never touched the page would be rude even if it
  // worked. Reduced motion still gets its short hold on a non-carrying page, but never skips
  // past the tap on one that is carrying.
  setTimeout(function(){ leave('auto'); }, reduced && !CARRY ? 120 : HOLD);
})();
</script>
</body></html>`;
}
