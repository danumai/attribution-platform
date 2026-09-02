'use client';
import { useEffect, useState } from 'react';
import { SCAN_EVENT } from './ScanStub';
import * as lp from '@/lib/lp';

type Tier = 'guest' | 'verified';
type Event = {
  id: number;
  promoter: string;
  campaign: string;
  publisher: string;
  ref: string;
  tier: Tier;
  coins: number;
};

// Illustrative, not live traffic. Shapes mirror what /v1/redemptions actually returns.
const POOL: Omit<Event, 'id'>[] = [
  { promoter: 'Air Dhaka', campaign: 'Inflight Wi-Fi Promo', publisher: 'BanglaReels', ref: 'reader_8841', tier: 'guest', coins: 10 },
  { promoter: 'Meridian Retail', campaign: 'Receipt Rewards', publisher: 'BanglaReels', ref: 'reader_1197', tier: 'verified', coins: 55 },
  { promoter: 'Northline Airways', campaign: 'Boarding Pass Bonus', publisher: 'DramaBox', ref: 'viewer_2290', tier: 'guest', coins: 8 },
  { promoter: 'Air Dhaka', campaign: 'Inflight Wi-Fi Promo', publisher: 'BanglaReels', ref: 'reader_8841', tier: 'verified', coins: 40 },
  { promoter: 'Northline Airways', campaign: 'Boarding Pass Bonus', publisher: 'DramaBox', ref: 'viewer_5537', tier: 'verified', coins: 60 },
  { promoter: 'Meridian Retail', campaign: 'Receipt Rewards', publisher: 'DramaBox', ref: 'sub_7702', tier: 'guest', coins: 12 },
  { promoter: 'Air Dhaka', campaign: 'Lounge Access Drop', publisher: 'BanglaReels', ref: 'reader_4416', tier: 'guest', coins: 10 },
  { promoter: 'Northline Airways', campaign: 'Boarding Pass Bonus', publisher: 'BanglaReels', ref: 'reader_9903', tier: 'verified', coins: 40 },
];

/* The row a reader's own scan posts. Guest tier at the guest rate, because that is exactly
   what a fresh scan settles at before anyone has verified who they are. */
const OWN_SCAN: Omit<Event, 'id'> = {
  promoter: 'Your campaign',
  campaign: 'Your first printed code',
  publisher: 'BanglaReels',
  ref: 'reader_0001',
  tier: 'guest',
  coins: 10,
};

const VISIBLE = 5;
const INTERVAL_MS = 2800;

export default function ActivityBoard() {
  const [events, setEvents] = useState<Event[]>(() =>
    POOL.slice(0, VISIBLE).map((e, i) => ({ ...e, id: i })),
  );

// The scan the reader just performed on the pass above — the payoff for dragging the phone onto
// the code is that the row which posts is theirs, by name.
  useEffect(() => {
    const post = () =>
      setEvents((prev) => [{ ...OWN_SCAN, id: Date.now() }, ...prev].slice(0, VISIBLE));
    addEventListener(SCAN_EVENT, post);
    return () => removeEventListener(SCAN_EVENT, post);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let n = VISIBLE;
    const id = setInterval(() => {
      const next = POOL[n % POOL.length];
      setEvents((prev) => [{ ...next, id: n }, ...prev].slice(0, VISIBLE));
      n += 1;
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const total = events.reduce((n, e) => n + e.coins, 0);

  return (
    <div className={lp.board}>
      <div className={lp.boardHead}>
        <span className={lp.boardTitle}>Redemptions posting</span>
        <span className={lp.tag}>Example data</span>
      </div>
      <p className={lp.srOnly}>
        Each row is one scan that resolved: the campaign it came from, the publisher that
        verified the user, and the coins debited from the promoter&rsquo;s budget. Guest rows are
        partial rewards awaiting verification.
      </p>
      <ul className={lp.boardRows} aria-hidden="true">
        {events.map((e) => (
// Only rows that actually posted animate. The first VISIBLE are the board's initial state and
// arrive with it; ids beyond that are the ones the reader caused.
          <li className={lp.cx(lp.boardRow, e.id >= VISIBLE && 'lp-board-post')} key={e.id}>
            <span className={lp.tier(e.tier)}>{e.tier}</span>
            <span className={lp.boardMeta}>
              <b>{e.campaign}</b>
              <span>
                {e.promoter} <span className="text-accent-text">→</span> {e.publisher} · {e.ref}
              </span>
            </span>
            <span className={lp.boardCoins}>+{e.coins}</span>
          </li>
        ))}
      </ul>
      <div className={lp.boardFoot}>
        <span>Debited from campaign budgets · this view</span>
        {/* Keyed on the total so a changed figure is a new element and re-inks. A running
            total that silently swaps digits is the one number on the board a reader would
            otherwise never notice moving. */}
        <b className="animate-ink" key={total}>
          {total} coins
        </b>
      </div>
    </div>
  );
}
