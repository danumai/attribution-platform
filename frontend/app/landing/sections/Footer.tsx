import Link from 'next/link';
import * as lp from '@/lib/lp';

export default function Footer() {
  return (
    <footer className={`${lp.foot} ${lp.wrap}`}>
      <span>QR Reward Platform</span>
      <span>
        Activity shown on this page is example data, not live traffic. ·{' '}
        <Link href="/login">Sign in</Link>
      </span>
    </footer>
  );
}