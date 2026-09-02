'use client';
import Link from 'next/link';
import { Empty, SkeletonCard } from '@/lib/ui';
import { num, offerLine } from '@/lib/fmt';
import { btn, btnGhost, card, cx, fact, meterInk, pill, sectionHead, stampCaps } from '@/lib/tw';
import { editCampaign, newCampaign } from '../dialogs';
import type { SectionProps } from '../types';

type Props = SectionProps & { canCreateCampaign: boolean };

export function Campaigns({ d, isPromoter, loaded, act, go, canCreateCampaign }: Props) {
  const { campaigns, partnerships } = d;
  const activePartnerships = partnerships.filter((p) => p.status === 'active');

  return (
    <>
      <h2 className={sectionHead}>Campaigns</h2>
      {!loaded && <SkeletonCard className="mt-3" />}
      {loaded && campaigns.length === 0 && (
        <Empty
          className="mt-3"
          title="No campaigns yet"
          body={
            isPromoter
              ? 'A campaign spends against an active partnership. Once you have one, this is where the codes come from.'
              : 'They appear here once a promoter you partner with starts one.'
          }
          action={
            canCreateCampaign ? (
              <button className={btn} onClick={() => newCampaign(activePartnerships, act)}>
                New campaign
              </button>
            ) : isPromoter ? (
              <button className={btnGhost} onClick={() => go('partnerships')}>
                Request a partnership first
              </button>
            ) : undefined
          }
        />
      )}
      {campaigns.map((c) => {
        // What the promoter actually has to know: how many more signups this budget can still
        // pay for. Zero is the moment scans stop granting coins.
        const covers = c.coin_rate > 0 ? Math.floor(c.budget / c.coin_rate) : 0;
        // An open repricing is not the rate: it pays nobody until the publisher accepts, so it
        // is printed beside the number in force rather than instead of it.
        const proposed = partnerships.find((x) => x.id === c.partnership_id)?.proposed_coin_rate;
        return (
          <div className={cx(card, 'mt-3 grid gap-4')} key={c.id}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <b className="text-base font-[650] tracking-[-0.018em]">{c.name}</b>{' '}
                <span className={cx(pill(c.status), 'ml-2')}>{c.status}</span>
                <div className="mt-0.75 text-[12.5px] text-mut tabular-nums">
                  {c.promoter_name} → {c.publisher_name}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {isPromoter && (
                  <>
                    {/* Funding lives inside Edit now: the budget is one of the numbers on the
                        card, and a second dialog that only tops it up asked for the same money
                        in a different unit. */}
                    <button className={btnGhost} onClick={() => editCampaign(c, partnerships, act)}>
                      Edit
                    </button>
                    <Link className={btn} href={`/campaigns/${c.id}`}>
                      QR codes &amp; stats
                    </Link>
                  </>
                )}
                {!isPromoter && (
                  <Link className={btn} href={`/campaigns/${c.id}`}>
                    Stats
                  </Link>
                )}
              </div>
            </div>

            {/* The facts are one group, so they sit together at the left rather than spreading
                across the card — a 1fr grid pushed them a third of a screen apart.

                No meter here: this listing carries the budget still remaining but not the total
                ever funded, so a bar would have to invent its own ceiling. The real burn-down
                lives on the campaign page, where the stats endpoint gives both halves. */}
            <dl className="flex flex-wrap gap-x-11 gap-y-3.5 border-t border-line-soft pt-3.5">
              {(
                [
                  [
                    'Rate',
                    num(c.coin_rate),
                    proposed ? `coins / signup — ${num(proposed)} awaiting approval` : 'coins / signup',
                    'text-ink',
                  ],
                  ['Budget', num(c.budget), 'coins', 'text-ink'],
                  ['Covers', num(covers), 'more signups', meterInk(covers)],
                ] as const
              ).map(([k, v, unit, ink]) => (
                <div className="min-w-24" key={k}>
                  <dt className={stampCaps}>{k}</dt>
                  <dd className={cx(fact, ink)}>
                    {v}{' '}
                    <small className="font-sans text-xs font-normal tracking-normal text-mut">
                      {unit}
                    </small>
                  </dd>
                </div>
              ))}
            </dl>

            {/* What this campaign promises the scanner — the publisher's own offer, picked out
                of its list when the campaign was created. Printed here because it is the half
                of the deal the money columns above cannot show, and the half a poster carries. */}
            <p className="-mt-1 text-[12.5px] leading-[1.5] text-mut">
              {c.publisher_bonuses?.length
                ? `Promises: ${offerLine(c.publisher_bonuses)}`
                : `${c.publisher_name} declares no offer for this kind of campaign — nothing to print.`}
            </p>
          </div>
        );
      })}
    </>
  );
}
