'use client';
import { api } from '@/lib/api';
import { Empty, SkeletonTable } from '@/lib/ui';
import type { Partnership } from '@/lib/types';
import { num } from '@/lib/fmt';
import {
  btn,
  btnTiny,
  cx,
  muted,
  pill,
  sectionHead,
  table,
  tableWrap,
  td,
  tdNum,
  th,
  thNum,
  tr,
} from '@/lib/tw';
import { newPartnership, proposeRates } from '../dialogs';
import type { SectionProps } from '../types';

export function Partnerships({ d, isPromoter, loaded, act }: SectionProps) {
  const { partnerships, publishers } = d;

  /** The decision buttons on one row. Which side sees which is the whole rule: a publisher is
   *  the one being paid, so accepting is its own; a promoter can only ask. */
  const decisions = (p: Partnership) => (
    <>
      {!isPromoter && p.status === 'pending' && (
        <button
          className={cx(btnTiny, 'my-0.5')}
          onClick={() =>
            act(
              () => api(`/v1/partnerships/${p.id}/accept`, { method: 'POST' }),
              `Partnership with ${p.promoter_name} is active.`,
            )
          }
        >
          Accept
        </button>
      )}
      {isPromoter && p.status === 'active' && (
        <button className={cx(btnTiny, 'my-0.5')} onClick={() => proposeRates(p, act)}>
          {p.proposed_coin_rate === null ? 'Propose rates' : 'Revise proposal'}
        </button>
      )}
      {!isPromoter && p.proposed_coin_rate !== null && (
        <span className="flex flex-wrap gap-2">
          <button
            className={cx(btnTiny, 'my-0.5')}
            onClick={() =>
              act(
                () => api(`/v1/partnerships/${p.id}/rates/accept`, { method: 'POST' }),
                `Now earning ${num(p.proposed_coin_rate ?? 0)} coins per verified signup from ${p.promoter_name}.`,
              )
            }
          >
            Accept {num(p.proposed_guest_rate ?? 0)} / {num(p.proposed_coin_rate)}
          </button>
          <button
            className={cx(btnTiny, 'my-0.5')}
            onClick={() =>
              act(
                () => api(`/v1/partnerships/${p.id}/rates/decline`, { method: 'POST' }),
                `Declined — you keep earning ${num(p.coin_rate)} per verified signup.`,
              )
            }
          >
            Decline
          </button>
        </span>
      )}
    </>
  );

  return (
    <>
      <h2 className={sectionHead}>All partnerships</h2>
      {!loaded ? (
        <SkeletonTable className="mt-3" cols={5} />
      ) : partnerships.length === 0 ? (
        <Empty
          className="mt-3"
          title="No partnerships yet"
          body={
            isPromoter
              ? 'A campaign can only spend against an active partnership, so this is the first step.'
              : 'They appear here when a promoter asks to work with you.'
          }
          action={
            isPromoter ? (
              <button
                className={btn}
                onClick={() => newPartnership(publishers, act)}
                disabled={publishers.length === 0}
              >
                Request a partnership
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Promoter</th>
                <th className={th}>Publisher</th>
                <th className={thNum}>Guest / full</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {partnerships.map((p) => (
                <tr className={tr} key={p.id}>
                  <td className={td}>{p.promoter_name}</td>
                  <td className={td}>{p.publisher_name}</td>
                  <td className={tdNum}>
                    {num(p.guest_rate)} / {num(p.coin_rate)}
                    {/* Repeat purchases are priced separately and are not part of the
                        guest/full split, so they get their own line rather than a third
                        number in a pair that reads as one tier of the other. */}
                    <div className={cx(muted, 'tabular-nums')}>
                      {num(p.engagement_rate)} per repeat purchase
                    </div>
                    {/* The rates in force stay the headline; the proposal is printed under
                        them, because nothing is paid at a proposal. */}
                    {p.proposed_coin_rate !== null && (
                      <div className={cx(muted, 'tabular-nums')}>
                        asking {num(p.proposed_guest_rate ?? 0)} / {num(p.proposed_coin_rate)}
                        {' · '}
                        {num(p.proposed_engagement_rate ?? 0)} repeat
                      </div>
                    )}
                  </td>
                  <td className={td}>
                    <span className={pill(p.status)}>{p.status}</span>
                  </td>
                  <td className={td}>{decisions(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
