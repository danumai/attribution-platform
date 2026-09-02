'use client';
import { useEffect, useRef, useState } from 'react';
import CodeMark from './CodeMark';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

/**
 * The pass, and something to scan it with. The card renders complete on the server and is fully
 * legible with no motion and no pointer — everything below is additive.
 */

/** One-shot signal to ActivityBoard. There is no state for the two islands to keep in step,
 *  so this is an event rather than a store. */
export const SCAN_EVENT = 'lp:scan';

/** Past this, a pointerup is a drag that ended, not a click. */
const CLICK_SLOP = 5;

// How long the phone rests on the code after a scan, and how long the card stays resolved. The
// phone has to still be there while the sweep runs.
const UNPIN_MS = 2400;
const RESET_MS = 4600;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// How high the chassis is carried, in px of translateZ: high while it is being flown around, low
// once it is over the code and coming in to land.
const LIFT = 38;
const LAND = 10;

const rest = () => ({ x: 0, y: 0, tx: 0, ty: 0, rx: 0, ry: 0, rz: 0, z: 0 });

export default function ScanStub() {
  const { ref: stageRef, inView } = useInView<HTMLDivElement>();
  const card = useRef<HTMLElement>(null);
  const phone = useRef<HTMLButtonElement>(null);
  const plate = useRef<HTMLDivElement>(null);

  const chassis = useRef<HTMLSpanElement>(null);

  const [scanned, setScanned] = useState(false);
  const [held, setHeld] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [over, setOver] = useState(false);
  /* the reader has driven it at least once, so the ambient loop steps aside */
  const [driven, setDriven] = useState(false);

// x/y are what is currently applied; tx/ty are what the pointer is asking for; rx/ry/rz are how
// the chassis is tipped and z is how far off the card it is carried.
  const st = useRef(rest());
  const grab = useRef({ x: 0, y: 0, moved: false });
  const overNow = useRef(false);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
// Read once rather than per frame: matchMedia in a rAF loop is a needless style query, and
// neither preference changes mid-drag.
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

// Where the phone would sit with no transform on it. The button is only ever translated — the
// tipping happens on the chassis inside it.
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
// off the code first, then out of the resolved state, so the reader watches it lift away from a
// card that is still showing `redeemed`
      window.setTimeout(() => {
        setPinned(false);
        st.current = rest();
        requestAnimationFrame(() => {
          if (phone.current) phone.current.style.transform = '';
          if (chassis.current) chassis.current.style.transform = '';
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
// Written straight to the element rather than through a custom property: a variable set here
// would be inherited by every field, code cell and status line inside the card.
    el.style.transform = `rotate3d(${-y}, ${x}, 0, ${Math.hypot(x, y) * 9}deg)`;
  };
  const untilt = () => {
    if (card.current) card.current.style.transform = '';
  };

  /* --- the drag loop --- */
  const tick = () => {
    raf.current = requestAnimationFrame(tick);
    const el = phone.current;
    const ch = chassis.current;
    const pl = plate.current;
    if (!el || !ch || !pl) return;
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

// The residual gap IS the lean, spent in three axes rather than one flat spin — the difference
// between a card being slid around and a slab being carried.
    const lx = gx - s.x;
    const ly = gy - s.y;
    s.ry += (clamp(lx * 0.7, -22, 22) - s.ry) * 0.16;
    s.rx += (clamp(-ly * 0.7, -18, 18) - s.rx) * 0.16;
    s.rz += (clamp(lx * 0.14, -5, 5) - s.rz) * 0.16;
    /* carried high off the card, then coming down as it finds the code */
    s.z += ((hit ? LAND : LIFT) - s.z) * 0.18;

    el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
    ch.style.transform =
      `translateZ(${s.z}px) rotateX(${s.rx}deg) rotateY(${s.ry}deg) rotate(${s.rz}deg)`;

    if (hit !== overNow.current) {
      overNow.current = hit;
      setOver(hit);
    }
  };

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { x: e.clientX, y: e.clientY, moved: false };
    st.current = rest();
    setHeld(true);
    setPinned(false);
// The loop stops at the grab, not at the drop: once a hand is on the scanner, a demo still
// cycling underneath it is two scans arguing over one code.
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
// Levels off and comes to rest just above the card — a slab set down on paper, not one dropped
// flush into it. Empty on a miss.
    let toChassis = '';
    if (hit) {
// Land square on the code and stay there. The phone is narrower than the plate, so the sweep
// still runs either side of it.
      const h = homeCentre(el);
      const p = plate.current!.getBoundingClientRect();
      const s = st.current;
      s.x = p.left + p.width / 2 - h.x;
      s.y = p.top + p.height / 2 - h.y;
      s.rx = s.ry = s.rz = 0;
      s.z = 6;
      to = `translate3d(${s.x}px, ${s.y}px, 0)`;
      toChassis = 'translateZ(6px)';
    } else {
      st.current = rest();
    }

    setHeld(false);
    setPinned(hit);
    overNow.current = false;
    setOver(false);

// One frame late, deliberately: which transition carries the phone is selected by
// data-held/data-pinned, and those must be set before the transform that reads them.
    requestAnimationFrame(() => {
      el.style.transform = to;
      if (chassis.current) chassis.current.style.transform = toChassis;
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
        data-over={over ? '' : undefined}
        aria-label="Scan the code with this phone"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          if (!grab.current.moved) fire();
        }}
      >
        <span className={lp.phoneBody} ref={chassis}>
          <span className={lp.phoneKey} style={{ left: -2, top: '26%', height: '9%' }} aria-hidden="true" />
          <span className={lp.phoneKey} style={{ left: -2, top: '38%', height: '9%' }} aria-hidden="true" />
          <span className={lp.phoneKey} style={{ right: -2, top: '30%', height: '14%' }} aria-hidden="true" />

          <span className={lp.phoneScreen}>
            <span className={lp.phoneFace}>
              <span className={lp.phoneIsland} aria-hidden="true">
                <span className={lp.phoneLens} />
              </span>
              {/* the frame closes on the code as it comes over it, and the code resolves
                  inside it — a camera that has found something, rather than a camera icon */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                   strokeLinecap="round" className={lp.phoneReticle} aria-hidden="true">
                <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
              </svg>
              <span className={lp.phonePeek} aria-hidden="true">
                <CodeMark />
              </span>
              <span className={lp.phoneVfScan} />
              <span className={lp.phoneCap}>{over ? 'Locked' : 'Camera'}</span>
            </span>
            {/* the payoff: the same 10 coins the guest-tier row posts to the board below */}
            <span className={lp.phoneFaceBack} aria-hidden="true">
              <span className={lp.phoneBurst} />
              <span className={lp.phoneAppIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4.5 4.5L19 7" />
                </svg>
              </span>
              <span className={lp.phoneWon}>Reward unlocked</span>
              <span className={lp.phoneCoins}>+10 coins</span>
              <span className={lp.phoneGet}>Get the app</span>
            </span>
          </span>
          <span className={lp.phoneGloss} aria-hidden="true" />
        </span>

        <span className={lp.phoneHint}>
          {scanned ? 'redeemed' : over ? 'release to scan' : held ? 'drop on the code' : 'drag onto the code'}
        </span>
      </button>
    </div>
  );
}
