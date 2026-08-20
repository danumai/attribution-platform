'use client';
import { Empty, SkeletonTable } from '@/lib/ui';
import { hint, sectionHead } from '@/lib/tw';
import { RedemptionTable } from '../RedemptionTable';
import type { SectionProps } from '../types';

export function Redemptions({ d, loaded }: Pick<SectionProps, 'd' | 'loaded'>) {
  const { redemptions } = d;

  return (
    <>
      <h2 className={sectionHead}>Redemptions</h2>
      {!loaded ? (
        <SkeletonTable className="mt-3" rows={8} />
      ) : redemptions.length === 0 ? (
        <Empty
          className="mt-3"
          title="No rewards granted yet"
          body="A redemption is recorded the moment a publisher vouches for a signup that came from one of your codes."
        />
      ) : (
        <>
          <RedemptionTable rows={redemptions} />
          {/* the endpoint returns the newest 100 — say so rather than implying this is all */}
          {redemptions.length >= 100 && <p className={hint}>Showing the 100 most recent redemptions.</p>}
        </>
      )}
    </>
  );
}
