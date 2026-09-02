import {
  Brand,
  Coupon,
  Fields,
  Pass,
  PassStamp,
  Serial,
  Stub,
  passLede,
  passNote,
  passPage,
  passTitle,
} from '@/lib/pass';

// A dead end confuses people and looks like a broken QR (Epic 4/8) — say what happened.
const REASONS: Record<string, { title: string; body: string; stamp: string }> = {
  invalid: {
    title: 'We don’t recognise this code',
    body: 'It may have been mistyped, or the sticker may not be a genuine partner code.',
    stamp: 'VOID',
  },
  expired: {
    title: 'This code has expired',
    body: 'The promotion behind it has passed its end date.',
    stamp: 'EXPIRED',
  },
  used_up: {
    title: 'This code has already been used',
    body: 'Each code can only be claimed a limited number of times.',
    stamp: 'CLAIMED',
  },
  voided: {
    title: 'This code was cancelled',
    body: 'The promoter withdrew this batch of codes.',
    stamp: 'VOID',
  },
  paused: {
    title: 'This offer is paused',
    body: 'The promoter has paused it for now — try again later.',
    stamp: 'ON HOLD',
  },
// Reached both when a budget has been spent down and when one was never funded, so the copy
// cannot claim rewards were "given out".
  budget: {
    title: 'This offer has no rewards available',
    body: 'There are none to give out on this campaign right now.',
    stamp: 'CLAIMED',
  },
  partnership_inactive: {
    title: 'This offer is on hold',
    body: 'The partnership behind this campaign is not active right now.',
    stamp: 'ON HOLD',
  },
  no_destination: {
    title: 'This offer has nowhere to send you',
    body: 'The partner behind it has not finished setting up their app or website.',
    stamp: 'ON HOLD',
  },
  rate_limited: {
    title: 'Too many attempts',
    body: 'Please wait a minute and scan again.',
    stamp: 'HELD',
  },
};

const FALLBACK = {
  title: 'This offer has ended',
  body: 'The campaign behind this QR code is no longer running.',
  stamp: 'VOID',
};

export const metadata = { title: 'This code did not go through — QR Reward Platform' };

export default function Ended({ searchParams }: { searchParams: { reason?: string } }) {
  const reason = searchParams.reason ?? '';
  const r = REASONS[reason] ?? FALLBACK;
  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <Brand />
          <PassStamp>{r.stamp}</PassStamp>
          <h1 className={passTitle}>{r.title}</h1>
          <p className={passLede}>{r.body}</p>
          <p className={passNote}>
            Nothing was charged and no account was created. If you scanned this from printed
            artwork, the promoter behind it is the one who can reissue a working code.
          </p>
        </Coupon>
        <Stub>
          <Fields
            items={[
              ['Status', 'Not honoured'],
              ['Reason code', reason || 'ended'],
            ]}
          />
          <Serial items={['No charge']} />
        </Stub>
      </Pass>
    </main>
  );
}
