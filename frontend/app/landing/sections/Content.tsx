/**
 * Static content for the landing page — copy, structured data, and the one small icon it needs.
 * Pulled out of Landing.tsx so that file stays composition-only: import sections, lay them out.
 */

export function TicketMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h17A1.5 1.5 0 0 1 22 6.5v3a2.5 2.5 0 0 0 0 5v3a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5v-3a2.5 2.5 0 0 0 0-5v-3Zm13.5.75v1.5h1.5v-1.5h-1.5Zm0 3.5v1.5h1.5v-1.5h-1.5Zm0 3.5v1.5h1.5v-1.5h-1.5Z" />
    </svg>
  );
}

export const LEGS = [
  {
    no: '01',
    title: 'Print the code',
    body: 'Design the QR in the portal — colors, quiet zone, error correction, your logo — and export it as print-ready SVG for a boarding pass, receipt, seatback card or poster.',
    meta: 'SVG · vector · press-ready',
  },
  {
    no: '02',
    title: 'Someone scans it',
    body: 'The platform checks the code is live, unexpired, under its use cap and inside budget, then sends the phone straight to the publisher’s store listing. Nothing redeemable travels with it. A blocked scan says which rule stopped it.',
    meta: 'GET /r/{code} → App Store · Play',
  },
  {
    no: '03',
    title: 'The install is matched',
    body: 'After the user signs up in the app, the publisher’s server asks whether that install traces back to a scan — by Play install referrer on Android, by a short-window device match on iOS. Server to server, no code ever touches the app.',
    meta: 'POST /v1/attribution/claim',
  },
  {
    no: '04',
    title: 'The fee posts from budget',
    body: 'One database transaction moves the agreed marketing fee out of your campaign budget and into the publisher’s account. Double-entry, append-only. Whatever the publisher gives its new user is its own bonus, on its own terms.',
    meta: 'Ledger · double-entry',
  },
];

export const SIGNUP_PROMOTER = '/login?mode=signup&type=promoter';
export const SIGNUP_PUBLISHER = '/login?mode=signup&type=publisher';

export const PATHS = [
  {
    key: 'promoter',
    title: 'For promoters',
    body: 'You have somewhere to print — a boarding pass, a receipt, a poster — and you want installs you only pay for when they are real.',
    points: [
      'Fund a budget; it is the hard ceiling on spend',
      'Design and export print-ready codes',
      'Void a print run that leaks, instantly',
      'Watch the budget draw down per confirmed signup',
    ],
    href: SIGNUP_PROMOTER,
    label: 'Start a campaign',
    primary: true,
    icon: <path d="M4 4v13M4 5h11l-2.2 3.2L15 11.5H4" />,
  },
  {
    key: 'publisher',
    title: 'For publishers',
    body: 'You have the audience and your own bar for what counts as a real user. Bring both, and set your own price for a verified signup.',
    points: [
      'Set where scans land — Play, App Store, or web',
      'Confirm signups through the Partner API',
      'Verify on your own terms, at your own bar',
      'Earn the agreed fee straight from the budget',
    ],
    href: SIGNUP_PUBLISHER,
    label: 'Join as a publisher',
    primary: false,
    icon: <path d="M8.5 6.5h-2a3.5 3.5 0 1 0 0 7h2M11.5 6.5h2a3.5 3.5 0 1 1 0 7h-2M7 10h6" />,
  },
];

export const RULES = [
  {
    term: 'Budget is the ceiling',
    val: 'Hard stop',
    body: 'A campaign spends only what you funded. When the budget runs dry, scans stop earning fees instead of quietly overdrawing.',
  },
  {
    term: 'The QR unlocks nothing',
    val: 'By design',
    body: 'A scan carries no token, key or code into the app — it opens a store listing, and the install is matched afterwards server-to-server. There is no path here that could unlock in-app content, which is what keeps it clear of App Store 3.1.1.',
  },
  {
    term: 'Codes expire',
    val: 'Default 30 days',
    body: 'Every code is time-bound at creation. Set your own window, or zero for a code that never expires.',
  },
  {
    term: 'Codes can be use-bound',
    val: 'max_uses',
    body: 'Unlimited by default, or single-use for a one-per-customer print run. The claim is atomic, so two simultaneous scans cannot both win the last use.',
  },
  {
    term: 'Void a print run',
    val: 'Promoter action',
    body: 'A batch goes missing or gets photographed and reposted — void those codes and every future scan on them is refused.',
  },
  {
    term: 'You can tighten, never loosen',
    val: 'Admin override',
    body: 'Shortening an expiry or lowering a cap is self-service. Extending one is a platform-admin action that lands in the audit log, so nobody quietly widens a money control.',
  },
  {
    term: 'Suspension is immediate',
    val: 'Not at token expiry',
    body: 'Offboarding an organization kills its live sessions and revokes its API key on the spot, rather than waiting for a session to time out.',
  },
];