import Link from 'next/link';
import * as lp from '@/lib/lp';
import { TicketMark, SIGNUP_PROMOTER } from './Content';

export default function Nav() {
  return (
    <nav className={lp.nav}>
      <div className={lp.navInner}>
        <Link href="/" className={lp.mark}>
          <TicketMark />
          QR Reward Platform
        </Link>
        <div className="flex items-center gap-2.5">
          {/* the nav cannot hold a wordmark and two actions on a phone;
              signing in lives in the page */}
          <Link href="/login" className={`${lp.btnGhost} max-[480px]:hidden`}>
            Sign in
          </Link>
          <Link href={SIGNUP_PROMOTER} className={lp.btn}>
            Start a campaign
          </Link>
        </div>
      </div>
      <span className={lp.navProgress} aria-hidden="true" />
    </nav>
  );
}