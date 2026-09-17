'use client';
import { useEffect, useState } from 'react';
import type { Redemption } from '@/lib/types';
import { ago, num, when } from '@/lib/fmt';
import { table, tableWrap, td, tdNum, th, thNum, tr } from '@/lib/tw';

/** `ago()` reads `Date.now()`, which differs between the server render and client hydration —
 *  render the server-matching absolute stamp first, then swap to relative time after mount. */
function RelativeTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => when(iso));
  useEffect(() => setText(ago(iso)), [iso]);
  return <span title={new Date(iso).toLocaleString()}>{text}</span>;
}

/** Newest first, and never more rows than the caller asked for. */
export function RedemptionTable({ rows }: { rows: Redemption[] }) {
  return (
    <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th className={th}>Campaign</th>
            <th className={th}>Publisher user</th>
            <th className={thNum}>Coins</th>
            <th className={th}>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr className={tr} key={x.id}>
              <td className={td}>{x.campaign_name}</td>
              <td className={td}>{x.publisher_user_ref}</td>
              <td className={tdNum}>{num(x.coins)}</td>
              <td className={td}>
                <RelativeTime iso={x.created_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
