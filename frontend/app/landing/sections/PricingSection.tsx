import SectionHead from './SectionHead';
import Settlement from '../Settlement';
import BudgetPlanner from '../BudgetPlanner';
import * as lp from '@/lib/lp';

export default function PricingSection() {
  return (
    <section className={`${lp.section} ${lp.wrap}`}>
      <SectionHead
        eyebrow="Pricing model"
        title="Two rates for the same signup."
        sub="A publisher can hand coins to anyone who signs up, but you should not pay full price for a stranger. So a scan settles at one of two rates you set yourself — and the difference is held, not lost."
      />
      <div className={lp.classes}>
        <article className={lp.fareCard(false)}>
          <div className={lp.fareTop}>
            <h3 className={lp.fareTitle}>Guest</h3>
            <span className={lp.tierGuest}>held</span>
          </div>
          <p className={`${lp.fareAmount} text-warn-lit`}>
            <span className="lp-num relative" style={{ '--to': 10 } as React.CSSProperties}>
              10
            </span>{' '}
            <small>of 50 coins</small>
          </p>
          <div className={lp.fareMeter}>
            <i className="w-1/5 bg-warn-lit" />
            {/* the 40 held coins, hatched — still on the meter, just not spent */}
            <i className={lp.meterHeld} />
          </div>
          <p className={lp.fareBody}>
            Somebody scanned and signed up, but the publisher has not vouched for who they are.
            They get the guest rate now, and the remaining 40 coins sit as{' '}
            <code className={lp.codeInline}>pending_coins</code> against a deadline.
          </p>
          <p className={lp.fareFoot}>Grace window set per partnership · default 7 days</p>
        </article>

        <article className={lp.fareCard(true)}>
          <div className={lp.fareTop}>
            <h3 className={lp.fareTitle}>Verified</h3>
            <span className={lp.tierVerified}>posted</span>
          </div>
          <p className={`${lp.fareAmount} text-ok`}>
            <span className="lp-num relative" style={{ '--to': 50 } as React.CSSProperties}>
              50
            </span>{' '}
            <small>of 50 coins</small>
          </p>
          <div className={lp.fareMeter}>
            <i className="w-full bg-ok" />
          </div>
          <p className={lp.fareBody}>
            The publisher cleared the user against its own bar and said so. The held-back
            difference is released in a single idempotent call, so a retry cannot pay the same
            person twice.
          </p>
          <p className={lp.fareFoot}>
            Released after the deadline? Refused — the budget keeps the difference.
          </p>
        </article>
      </div>

      {/* The cards state the split; this is the split happening. The held 40 coins are
          a duration, and a duration is the one thing the two cards cannot show. */}
      <Settlement />

      {/* The two rates argue in the abstract. This is the same argument with the reader's
          own numbers in it — the only place on the page they can steer anything. */}
      <BudgetPlanner />
    </section>
  );
}