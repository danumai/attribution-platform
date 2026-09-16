import Link from 'next/link';
import * as lp from '@/lib/lp';
import { SIGNUP_PROMOTER, SIGNUP_PUBLISHER } from './Content';

export default function ClosingCta() {
  return (
    <section className={`${lp.close} ${lp.wrap}`}>
      <div className={lp.cx('lp-enter', lp.closePass)}>
        <div className={lp.closeMain}>
          <h2 className={lp.h2}>Ready to print?</h2>
          <p className={lp.sub}>
            Create a promoter account, request a partnership with a publisher, fund a campaign,
            and design your first code. The budget you fund is the most you can ever spend.
          </p>
          <div className={lp.cta}>
            <Link href={SIGNUP_PROMOTER} className={`${lp.btn} ${lp.btnLg}`}>
              Start a campaign
            </Link>
            <Link href="/login" className={`${lp.btnGhost} ${lp.btnLg}`}>
              Sign in
            </Link>
          </div>
        </div>

        <aside className={lp.closeStub}>
          <span className={lp.fieldTerm}>Publishers</span>
          <p>
            Bring your own audience and your own verification. Set a landing URL, take a
            partnership, and call the Partner API when a scanned user signs up.
          </p>
          <Link href={SIGNUP_PUBLISHER} className={lp.btnGhost}>
            Join as a publisher
          </Link>
        </aside>
      </div>
    </section>
  );
}