'use client';
import type { Redemption } from '@/lib/types';
import { ago, num } from '@/lib/fmt';
import { table, tableWrap, td, tdNum, th, thNum, tr } from '@/lib/tw';

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
              <td className={td} title={new Date(x.created_at).toLocaleString()}>
                {ago(x.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
