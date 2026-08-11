'use client';
import { useEffect, useRef, useState } from 'react';
import CodeMark from './CodeMark';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

/**
 * The pass, and something to scan it with.
 *
 * The card renders complete on the server and is fully legible with no motion and no
 * pointer — everything below is additive. Three things are layered on top:
 *
 *  1. A tilt. The card sits in a perspective stage and leans toward the pointer, because it
 *     is a printed object and printed objects have a front and a back.
 *  2. A draggable scanner. Drop it on the code and a scan actually resolves: the plate
 *     sweeps, the ring lands, the status flips, the phone turns over to the store listing,
 *     and a redemption posts to the board below.
 *  3. The ambient loop that was already here, which stops the moment the reader takes the
 *     controls — a demo that keeps playing over you is noise.
 *
 * The drag is run from a rAF loop rather than straight out of the pointermove handler, and
 * that is the whole difference between this feeling like a held object and feeling like a
 * dragged sticker. Three things need a frame clock that pointer events cannot give:
 *
 *   - Lag. The phone eases toward the pointer instead of being pinned to it. A few frames of
 *     trailing is what reads as mass.
 *   - Lean. The tilt is derived from how far BEHIND the pointer the phone currently is, so a
 *     flick tips it and holding still levels it out. Out of a move handler this is impossible
 *     to unwind: when the finger stops, no more events arrive and the lean would freeze at
 *     whatever angle it was last flicked to.
 *   - The magnet. Over the code the phone is pulled to the plate's centre rather than to the
 *     pointer, so the drop is forgiving and the scan happens square.
 */

/** One-shot signal to ActivityBoard. There is no state for the two islands to keep in step,
 *  so this is an event rather than a store. */
export const SCAN_EVENT = 'lp:scan';

/** Past this, a pointerup is a drag that ended, not a click. */
const CLICK_SLOP = 5;

/** How long the phone rests on the code after a scan, and how long the card stays resolved.
 *  The phone has to still be there while the sweep runs — a scanner that leaves before the
 *  thing it scanned reacts is the single clearest way to make this read as fake. */
const UNPIN_MS = 2400;
const RESET_MS = 4600;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function ScanStub() {
  const { ref: stageRef, inView } = useInView<HTMLDivElement>();
  const card = useRef<HTMLElement>(null);
  const phone = useRef<HTMLButtonElement>(null);
  const plate = useRef<HTMLDivElement>(null);

  const [scanned, setScanned] = useState(false);
  const [held, setHeld] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [over, setOver] = useState(false);
  /* the reader has driven it at least once, so the ambient loop steps aside */
  const [driven, setDriven] = useState(false);

  /* x/y are what is currently applied; tx/ty are what the pointer is asking for; r and s are
     the lean and the lift. Kept in a ref because they change every frame and none of them is
     something React should be re-rendering over. */
  const st = useRef({ x: 0, y: 0, tx: 0, ty: 0, r: 0, s: 1 });
  const grab = useRef({ x: 0, y: 0, moved: false });
  const overNow = useRef(false);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
  /* Read once rather than per frame: matchMedia in a rAF loop is a needless style query, and
     neither preference changes mid-drag in any way worth tracking. */
  const canTilt = useRef(false);

  useEffect(() => {
    canTilt.current =
      matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  /** Where the phone would sit with no transform on it. Rotation and scale are both about
   *  the element's own centre, so the centre of the measured box is unaffected by either and
   *  subtracting the applied translation is enough. */
  const homeCentre = (el: HTMLElement) => {
    const c = el.getBoundingClientRect();
    return { x: c.left + c.width / 2 - st.current.x, y: c.top + c.height / 2 - st.current.y };
  };

  const fire = () => {
    setDriven(true);
    setScanned(true);
    dispatchEvent(new CustomEvent(SCAN_EVENT));
    timers.current.forEach(clearTimeout);
    timers.current = [
      /* off the code first, then out of the resolved state — so the reader watches it lift
         away from a card that is still showing `redeemed`, rather than both at once */
      window.setTimeout(() => {
        setPinned(false);
        st.current = { x: 0, y: 0, tx: 0, ty: 0, r: 0, s: 1 };
        requestAnimationFrame(() => {
          if (phone.current) phone.current.style.transform = '';
        });
      }, UNPIN_MS),
      window.setTimeout(() => setScanned(false), RESET_MS),
    ];
  };

  /* --- the card's tilt --- */
  const tilt = (e: React.PointerEvent) => {
    const el = card.current;
    if (!el || held || !canTilt.current) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    /* Written straight to the element rather than through a custom property: a variable set
       here would be inherited by every field, code cell and status line inside the card and
       recalculate all of them on each pointermove. */
    el.style.transform = `rotate3d(${-y}, ${x}, 0, ${Math.hypot(x, y) * 9}deg)`;
  };
  const untilt = () => {
    if (card.current) card.current.style.transform = '';
  };

  /* --- the drag loop --- */
  const tick = () => {
    raf.current = requestAnimationFrame(tick);
    const el = phone.current;
    const pl = plate.current;
    if (!el || !pl) return;
    const s = st.current;

    const h = homeCentre(el);
    const p = pl.getBoundingClientRect();
    const wx = h.x + s.tx;
    const wy = h.y + s.ty;
    const hit = wx > p.left && wx < p.right && wy > p.top && wy < p.bottom;

    /* over the code, the goal stops being the pointer and becomes the plate's centre */
    const gx = hit ? p.left + p.width / 2 - h.x : s.tx;
    const gy = hit ? p.top + p.height / 2 - h.y : s.ty;

    s.x += (gx - s.x) * 0.42;
    s.y += (gy - s.y) * 0.42;
    /* the residual gap IS the lean: large while being flicked, zero once it has caught up */
    s.r += (clamp((gx - s.x) * 0.5, -14, 14) - s.r) * 0.16;
    /* held high off the card, then settling as it finds the target */
    s.s += ((hit ? 1.02 : 1.08) - s.s) * 0.2;

    el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.r}deg) scale(${s.s})`;

    if (hit !== overNow.current) {
      overNow.current = hit;
      setOver(hit);
    }
  };

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { x: e.clientX, y: e.clientY, moved: false };
    st.current = { x: 0, y: 0, tx: 0, ty: 0, r: 0, s: 1 };
    setHeld(true);
    setPinned(false);
    /* The loop stops at the grab, not at the drop: once a hand is on the scanner, a demo
       still cycling underneath it is two scans arguing over one code. */
    setDriven(true);
    untilt();
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };

  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!held) return;
    const dx = e.clientX - grab.current.x;
    const dy = e.clientY - grab.current.y;
    if (Math.hypot(dx, dy) > CLICK_SLOP) grab.current.moved = true;
    /* the handler only records the ask; the frame loop decides where the phone actually is */
    st.current.tx = dx;
    st.current.ty = dy;
  };

  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!held) return;
    cancelAnimationFrame(raf.current);
    const el = e.currentTarget;
    const hit = overNow.current && !!plate.current;

    let to = '';
    if (hit) {
      /* Land square on the code and stay there. The phone is narrower than the plate, so the
         sweep still runs either side of it — the scanner is on the code while the code reacts
         to being scanned, which is the entire point of dropping it there. */
      const h = homeCentre(el);
      const p = plate.current!.getBoundingClientRect();
      const s = st.current;
      s.x = p.left + p.width / 2 - h.x;
      s.y = p.top + p.height / 2 - h.y;
      s.r = 0;
      s.s = 1;
      to = `translate3d(${s.x}px, ${s.y}px, 0)`;
    } else {
      st.current = { x: 0, y: 0, tx: 0, ty: 0, r: 0, s: 1 };
    }

    setHeld(false);
    setPinned(hit);
    overNow.current = false;
    setOver(false);

    /* One frame late, deliberately. Which transition carries the phone — the settle onto the
       code or the spring home — is selected by data-held/data-pinned, and those are React's
       to write. Applying the transform in this same tick would run it while `data-held` is
       still on the element, where transform has no transition at all, and the phone would
       teleport instead of travelling. */
    requestAnimationFrame(() => {
      el.style.transform = to;
    });
    if (hit) fire();
  };

  return (
    <div
      className={lp.stubStage}
      ref={stageRef}
      onPointerMove={tilt}
      onPointerLeave={untilt}
      data-run={inView && !driven ? '' : undefined}
      data-scanned={scanned ? '' : undefined}
    >
      <aside className={lp.stub} ref={card}>
        <div className={lp.codePlate} ref={plate} data-armed={over ? '' : undefined}>
          <CodeMark />
          <span className={lp.scanSweep} aria-hidden="true" />
          <span className={lp.codeRing} aria-hidden="true" />
        </div>
        <dl className={lp.stubFields}>
          {([
            ['Code', '7f3a·c19e'],
            ['Expires', '30 days'],
            ['Uses', 'Unlimited'],
          ] as const).map(([dt, dd]) => (
            <div className={`lp-field ${lp.field}`} key={dt}>
              <dt className={lp.fieldTerm}>{dt}</dt>
              <dd className={lp.fieldValue}>{dd}</dd>
            </div>
          ))}
          <div className={`lp-field ${lp.field}`}>
            <dt className={lp.fieldTerm}>Status</dt>
            <dd className={lp.status}>
              <span className={lp.statusIdle}>awaiting scan</span>
              <span className={lp.statusDone}>redeemed</span>
            </dd>
          </div>
        </dl>
      </aside>

      {/* A button, not a div: dragging is the nice way to do this, but pressing Enter has to
          resolve the same scan for anyone who is not dragging anything. The click is
          suppressed after a real drag so a drop does not fire it twice. */}
      <button
        ref={phone}
        type="button"
        className={lp.phone}
        data-held={held ? '' : undefined}
        data-pinned={pinned ? '' : undefined}
        aria-label="Scan the code with this phone"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          if (!grab.current.moved) fire();
        }}
      >
        <span className={lp.phoneScreen}>
          <span className={lp.phoneFace}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                 strokeLinecap="round" className="size-4 text-mut" aria-hidden="true">
              <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            </svg>
            <span className={lp.phoneCap}>{over ? 'Reading' : 'Camera'}</span>
          </span>
          <span className={lp.phoneFaceBack} aria-hidden="true">
            <span className="size-4 rounded-md bg-accent" />
            <span className={lp.phoneCap}>Get the app</span>
          </span>
        </span>
        <span className={lp.phoneHint}>
          {scanned ? 'redeemed' : over ? 'release to scan' : held ? 'drop on the code' : 'drag onto the code'}
        </span>
      </button>
    </div>
  );
}
