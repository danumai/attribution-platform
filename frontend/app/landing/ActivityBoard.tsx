'use client';
import { useEffect, useState } from 'react';
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

const VISIBLE = 5;
const INTERVAL_MS = 2800;

export default function ActivityBoard() {
  const [events, setEvents] = useState<Event[]>(() =>
    POOL.slice(0, VISIBLE).map((e, i) => ({ ...e, id: i })),
  );

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

  return (
    <div className={`${lp.board} ${lp.stocked}`}>
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
          <li className={lp.boardRow} key={e.id}>
            <span className={lp.tier(e.tier)}>{e.tier}</span>
            <span className={lp.boardMeta}>
              <b>{e.campaign}</b>
              <span>
                {e.promoter} <span className="text-accent">→</span> {e.publisher} · {e.ref}
              </span>
            </span>
            <span className={lp.boardCoins}>+{e.coins}</span>
          </li>
        ))}
      </ul>
      <div className={lp.boardFoot}>
        <span>Debited from campaign budgets · this view</span>
        <b>{events.reduce((n, e) => n + e.coins, 0)} coins</b>
      </div>
    </div>
  );
}
