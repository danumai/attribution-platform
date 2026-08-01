// A dead end confuses people and looks like a broken QR (Epic 4/8) — say what happened.
const REASONS: Record<string, { title: string; body: string }> = {
  invalid: {
    title: 'We don’t recognise this code',
    body: 'It may have been mistyped, or the sticker may not be a genuine partner code.',
  },
  expired: {
    title: 'This code has expired',
    body: 'The promotion behind it has passed its end date.',
  },
  used_up: {
    title: 'This code has already been used',
    body: 'Each code can only be claimed a limited number of times.',
  },
  voided: {
    title: 'This code was cancelled',
    body: 'The promoter withdrew this batch of codes.',
  },
  paused: {
    title: 'This offer is paused',
    body: 'The promoter has paused it for now — try again later.',
  },
  budget: {
    title: 'This offer is fully claimed',
    body: 'Every reward in this campaign has been given out.',
  },
  rate_limited: {
    title: 'Too many attempts',
    body: 'Please wait a minute and scan again.',
  },
};

export default function Ended({ searchParams }: { searchParams: { reason?: string } }) {
  const r = REASONS[searchParams.reason ?? ''] ?? {
    title: 'This offer has ended',
    body: 'The campaign behind this QR code is no longer running.',
  };
  return (
    <main style={{ maxWidth: 420, textAlign: 'center', paddingTop: 80 }}>
      <h1>{r.title}</h1>
      <p className="muted">{r.body}</p>
    </main>
  );
}
