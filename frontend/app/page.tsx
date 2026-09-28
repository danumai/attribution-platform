import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import Landing from './landing/Landing';

export const metadata = {
  title: 'QR Reward Platform — pay for signups, not scans',
  description:
    'Print a QR code anywhere. Coins leave your campaign budget only after a partner publisher confirms a real signup — guest rate until they verify the user, full rate once they do.',
};

// Decide from the session cookie — the same thing middleware checks — so a signed-in visitor goes
// to the portal and anyone else sees the landing. A localStorage check here disagreed with
// middleware whenever the cookie was missing, bouncing / → /dashboard → /login.
export default function Home() {
  const session = getSession();
  if (session) redirect(session.org.type === 'admin' ? '/admin' : '/dashboard');
  return <Landing />;
}
