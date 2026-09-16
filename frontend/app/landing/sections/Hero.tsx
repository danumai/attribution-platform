import Link from 'next/link';
import ScanStub from '../ScanStub';
import ActivityBoard from '../ActivityBoard';
import Metrics from '../Metrics';
import * as lp from '@/lib/lp';
import { SIGNUP_PROMOTER, SIGNUP_PUBLISHER } from './Content';

export default function Hero() {
  return (
    <header className={`${lp.hero} ${lp.wrap}`}>
      <div className={lp.heroWash} aria-hidden="true" />
      <div className={lp.pass}>
        <div className={lp.coupon}>
          <dl className={lp.routing}>
            {([
              ['Funded by', 'Promoter'],
              ['Verified by', 'Publisher'],
              ['Settled in', 'Coins'],
            ] as const).map(([dt, dd]) => (
              <div className={`lp-field ${lp.field}`} key={dt}>
                <dt className={lp.fieldTerm}>{dt}</dt>
                <dd className={lp.fieldValue}>{dd}</dd>
              </div>
            ))}
          </dl>

          <h1 className={lp.h1}>
            Pay for signups,
            <br />
            not for <em>scans</em>.
          </h1>

          <p className={lp.lede}>
            Print a QR code on anything. When someone scans it they land inside a partner
            publisher&rsquo;s app, and coins leave your campaign budget{' '}
            <b>only after that publisher confirms a real signup</b> — at the guest rate until
            they verify the person, at your full rate once they do.
          </p>

          <div className={lp.cta}>
            <Link href={SIGNUP_PROMOTER} className={`${lp.btn} ${lp.btnLg}`}>
              Start a campaign
            </Link>
            <Link href={SIGNUP_PUBLISHER} className={`${lp.btnGhost} ${lp.btnLg}`}>
              Join as a publisher
            </Link>
          </div>
          <p className={lp.ctaNote}>
            Fund a budget, print a code, and watch it draw down. No spend until a scan converts.
          </p>
        </div>

        <ScanStub />
      </div>

      <ActivityBoard />
      <Metrics />
    </header>
  );
}