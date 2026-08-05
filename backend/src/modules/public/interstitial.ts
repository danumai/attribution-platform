/**
 * The one screen an actual scanner sees.
 *
 * Everything else in this product is a console for the two businesses on either side of a
 * campaign. This page is for the person who just pointed a camera at a printed code, and it
 * exists for a functional reason before an aesthetic one: iOS has no install-referrer channel,
 * so the only moment we can read this device's timezone, screen geometry and locale is right
 * here, in a browser, before the App Store takes the session away.
 *
 * Design world is DESIGN.md's "printed instrument", and it fits the moment exactly — the
 * scanner is holding the printed artifact this page is dressed as, seconds after scanning it.
 * So the page is the stub being validated: press-blue reader sweep across the code plate,
 * stamped caps labels over monospace values, a punched perforation, and a progress rule that
 * feeds for exactly as long as the hold lasts. No spinner, because a spinner would be the one
 * element here that measures nothing.
 *
 * Three constraints shape the implementation and are worth stating, because each one rules
 * out something that would otherwise be the obvious choice:
 *
 *   Self-contained.  CSP is `default-src 'none'` everywhere in this API. This page relaxes it
 *                    to a nonce for its own inline style and script and `data:` for the fibre
 *                    tile, and loads nothing over the network. No webfont — Archivo would be
 *                    a blocking request on a page that lives about a second, so the display
 *                    line is set in the system grotesque at the same weight and tracking.
 *
 *   Front-loaded.    The authored sequence has ~600ms before the redirect fires. A 1.4s
 *                    reveal like the landing page's would be half-seen. Everything lands
 *                    inside the first 500ms and the loop carries the remainder.
 *
 *   Legible at rest. Under `prefers-reduced-motion`, and with script blocked entirely, every
 *                    word is on screen and the store link still works. Nothing here is hidden
 *                    by default and revealed by animation.
 */

/**
 * How long the page is held before it forwards.
 *
 * Not decoration. Two things need it: `sendBeacon` has to get the signals away before the
 * document is discarded, and a `location.replace` fired in the same tick as page load is
 * unreliable inside in-app webviews — Instagram and TikTok both swallow it. A beat also
 * means the scanner sees their scan was accepted rather than a flash of buff card.
 *
 * ponytail: fixed hold. If measured drop-off between scan and store install ever justifies
 * it, shorten it — but the signals must still be away before the document goes.
 */
export const HOLD_MS = 900;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Laid fibre, as a data URI rather than a file: one request fewer on a page whose whole job
 * is to get out of the way. `feTurbulence` at 5.5% multiplied is the same tile the console
 * uses, so a scanner who later sees the portal is looking at the same stock.
 */
const FIBRE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23f)' opacity='.5'/%3E%3C/svg%3E\")";

export interface InterstitialCopy {
  /** the publisher's org name — the destination this scan routes to */
  destination: string;
  /** where the Continue link and the scripted redirect both point */
  go: string;
  nonce: string;
}

export function interstitialHtml({ destination, go, nonce }: InterstitialCopy): string {
  const href = esc(go);
  const dest = esc(destination);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Opening the App Store — scan accepted</title>
<!-- No-script and script-error fallback. Deliberately longer than the scripted hold so the
     two never race: script wins whenever it runs at all. -->
<meta http-equiv="refresh" content="3;url=${href}">
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
  --hold:${HOLD_MS}ms;
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
}
/* The desk has its own grain, coarser than the card's. */
body::before{
  content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
  background-image:${FIBRE}; background-size:180px; opacity:.05; mix-blend-mode:multiply;
}

/* ---------- the pass ---------- */
.pass{
  position:relative; z-index:1; isolation:isolate;
  width:100%; max-width:400px;
  background:var(--stock); border-radius:14px;
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

/* ---------- code plate + reader ---------- */
.plate{
  position:relative; width:62px; height:62px; border-radius:6px;
  background:var(--stock-sunk); border:1px solid var(--rule);
  display:grid; place-items:center; overflow:hidden; margin-bottom:20px;
}
.plate svg{display:block; color:var(--ink)}
/* The validation loop: the reader crossing the plate. Same idiom as the console's scan
   sweep, and the only looping element on the page. */
.sweep{
  position:absolute; left:0; right:0; height:2px; top:0;
  background:var(--blue); box-shadow:0 0 0 1px rgba(28,57,187,.18);
  opacity:0;
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
/* Notches filled with the page ground, so the card reads as physically punched. */
.perf::before,.perf::after{
  content:""; position:absolute; top:50%; width:22px; height:22px; border-radius:50%;
  background:var(--paper); transform:translateY(-50%);
}
.perf::before{left:-11px}
.perf::after{right:-11px}

.stub{padding:20px clamp(22px,6vw,30px) clamp(22px,6vw,26px); position:relative}
.track{height:3px; border-radius:999px; background:var(--rule-soft); overflow:hidden}
.bar{display:block; height:100%; width:100%; background:var(--blue); transform-origin:left center; transform:scaleX(0)}
.note{margin:14px 0 0; font-size:11.5px; line-height:1.45; color:var(--ink-mute)}

/* ---------- the manual key ---------- */
.go{
  display:flex; align-items:center; justify-content:center; gap:8px;
  margin-top:18px; padding:13px 20px; border-radius:8px;
  background:var(--blue); color:#fff; text-decoration:none;
  font-size:15px; font-weight:600; letter-spacing:-.006em;
  /* Seated key: a printed edge under the control, collapsing on press. */
  box-shadow:0 1px 0 var(--blue-deep), 0 1px 2px rgba(20,42,140,.28);
  transition:background .12s linear, transform .06s linear, box-shadow .06s linear;
}
.go:hover{background:var(--blue-lit)}
.go:active{transform:translateY(1px); box-shadow:0 0 0 var(--blue-deep)}
.go:focus-visible{outline:2px solid var(--blue); outline-offset:3px}

/* Landscape on a short phone: the card must never need scrolling to reach the key. */
@media (max-height:560px){
  .coupon{padding-top:20px; padding-bottom:18px}
  .plate{width:48px; height:48px; margin-bottom:14px}
  .fields{margin-top:18px; gap:12px}
  h1{font-size:24px}
  .lede{display:none}
}

/* ---------- the authored moment: the stub is read ----------
   One rehearsed sequence, ~500ms end to end, exponential ease-out. Everything is fully
   legible with animation off — these rules only ever animate *to* the resting state. */
@media (prefers-reduced-motion:no-preference){
  .pass{animation:land .34s cubic-bezier(.16,1,.3,1) both}
  .plate{animation:land .34s cubic-bezier(.16,1,.3,1) .04s both}
  /* The sweep runs twice inside the hold and stops — a loop nobody is left to watch is
     the kind of animation this system's motion rules exist to forbid. */
  .sweep{animation:sweep .62s cubic-bezier(.5,0,.5,1) .1s 2}
  h1{animation:strike .38s cubic-bezier(.16,1,.3,1) .1s both}
  .lede{animation:land .3s cubic-bezier(.16,1,.3,1) .18s both}
  /* Stamped in sequence, the way the press lays plates. */
  .f1{animation:stamp .26s cubic-bezier(.16,1,.3,1) .24s both}
  .f2{animation:stamp .26s cubic-bezier(.16,1,.3,1) .32s both}
  .f3{animation:stamp .26s cubic-bezier(.16,1,.3,1) .40s both}
  .perf,.stub{animation:land .3s cubic-bezier(.16,1,.3,1) .3s both}
  /* Honest progress: the rule feeds for exactly the hold, so it completes as the redirect
     fires rather than looping past it like an indeterminate bar. Linear, because it is
     measuring elapsed time and an eased one would misreport it. */
  .bar{animation:feed var(--hold) linear .06s both}
}
@keyframes land{from{opacity:0; transform:translateY(9px); filter:blur(6px)}
  to{opacity:1; transform:none; filter:none}}
/* The display line struck by a bottom-up wipe — the second plate of the press run. */
@keyframes strike{from{opacity:0; clip-path:inset(100% 0 0 0); transform:translateY(4px)}
  to{opacity:1; clip-path:inset(0 0 0 0); transform:none}}
@keyframes stamp{from{opacity:0; transform:translateY(5px) scale(.985)}
  to{opacity:1; transform:none}}
@keyframes sweep{0%{opacity:0; top:2%} 12%{opacity:1} 88%{opacity:1} 100%{opacity:0; top:98%}}
@keyframes feed{from{transform:scaleX(0)} to{transform:scaleX(1)}}
</style></head>
<body>
<main class="pass">
  <div class="coupon">
    <div class="trim"></div>

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

    <h1>Opening the App&nbsp;Store</h1>
    <p class="lede">Your scan was accepted. Install the app and your welcome bonus is waiting inside it.</p>

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
    <p class="note">No code to enter. Nothing to copy. Your bonus is handled inside the app.</p>
  </div>
</main>

<script nonce="${nonce}">
(function(){
  var GO = ${JSON.stringify(go)}, HOLD = ${HOLD_MS};

  // Local clock, printed as a field. Purely presentational — the row this page actually
  // writes is timestamped server-side, where a device cannot lie about it.
  try{
    var d = new Date();
    var p = function(n){ return (n<10?'0':'') + n; };
    document.getElementById('issued').textContent = p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  }catch(e){}

  // The three signals this page exists to collect. Each in its own try: an older WebView
  // without Intl must not cost us the screen geometry, and a throw here would strand the
  // scanner on a page whose only job is to leave.
  var q = [];
  try{ var z = Intl.DateTimeFormat().resolvedOptions().timeZone; if(z) q.push('tz='+encodeURIComponent(z)); }catch(e){}
  try{
    var w = screen.width, h = screen.height, r = window.devicePixelRatio || 1;
    // Orientation-normalised at the source: a phone held sideways at scan time and upright
    // at first open is the same phone, and w×h unsorted would say otherwise.
    if(w && h) q.push('sc='+encodeURIComponent(Math.min(w,h)+'x'+Math.max(w,h)+'@'+r));
  }catch(e){}
  try{ if(navigator.language) q.push('lang='+encodeURIComponent(navigator.language)); }catch(e){}
  var url = GO + (q.length ? '?' + q.join('&') : '');

  // Someone who taps Continue has opted out of waiting — let the anchor navigate and cancel
  // the timer, rather than having a scheduled replace() fire over the top of their tap.
  var done = false;
  var link = document.querySelector('.go');
  if(link){
    link.setAttribute('href', url);
    link.addEventListener('click', function(){ done = true; });
  }

  // Reduced motion means there is no sequence left to watch, so there is nothing to hold
  // for beyond getting the signals away. Go almost immediately.
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(function(){
    // replace(), not assign(): coming back from the App Store must not land here again.
    if(!done) location.replace(url);
  }, reduced ? 120 : HOLD);
})();
</script>
</body></html>`;
}
