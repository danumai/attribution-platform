import Link from 'next/link';
import ActivityBoard from './ActivityBoard';
import ScanStub from './ScanStub';
import JourneyFlow from './JourneyFlow';
import JourneyTrigger from './JourneyTrigger';
import HeroGlow from './HeroGlow';
import './landing.css';

const SIGNUP_PROMOTER = '/login?mode=signup&type=promoter';
const SIGNUP_PUBLISHER = '/login?mode=signup&type=publisher';

function TicketMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h17A1.5 1.5 0 0 1 22 6.5v3a2.5 2.5 0 0 0 0 5v3a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5v-3a2.5 2.5 0 0 0 0-5v-3Zm13.5.75v1.5h1.5v-1.5h-1.5Zm0 3.5v1.5h1.5v-1.5h-1.5Zm0 3.5v1.5h1.5v-1.5h-1.5Z" />
    </svg>
  );
}

const LEGS = [
  {
    no: 'Coupon 01',
    title: 'Print the code',
    body: 'Design the QR in the portal — colors, quiet zone, error correction, your logo — and export it as print-ready SVG for a boarding pass, receipt, seatback card or poster.',
    meta: 'SVG · vector · press-ready',
  },
  {
    no: 'Coupon 02',
    title: 'Someone scans it',
    body: 'The platform checks the code is live, unexpired, under its use cap and inside budget, then sends the phone straight to the publisher’s store listing. Nothing redeemable travels with it. A blocked scan says which rule stopped it.',
    meta: 'GET /r/{code} → App Store · Play',
  },
  {
    no: 'Coupon 03',
    title: 'The install is matched',
    body: 'After the user signs up in the app, the publisher’s server asks whether that install traces back to a scan — by Play install referrer on Android, by a short-window device match on iOS. Server to server, no code ever touches the app.',
    meta: 'POST /v1/attribution/claim',
  },
  {
    no: 'Coupon 04',
    title: 'The fee posts from budget',
    body: 'One database transaction moves the agreed marketing fee out of your campaign budget and into the publisher’s account. Double-entry, append-only. Whatever the publisher gives its new user is its own bonus, on its own terms.',
    meta: 'Ledger · double-entry',
  },
];

const RULES = [
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

export default function Landing() {
  return (
    <div className="lp">
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-mark">
            <TicketMark />
            QR Reward Platform
          </Link>
          <div className="lp-nav-actions">
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign in
            </Link>
            <Link href={SIGNUP_PROMOTER} className="lp-btn">
              Start a campaign
            </Link>
          </div>
        </div>
        <span className="lp-nav-progress" aria-hidden="true" />
      </nav>

      <main>
      <header className="lp-hero lp-wrap">
        <HeroGlow />
        <div className="lp-pass lp-pass-shell lp-stocked lp-cropped">
          <div className="lp-coupon">
            <dl className="lp-routing">
              <div className="lp-field">
                <dt>Funded by</dt>
                <dd>Promoter</dd>
              </div>
              <div className="lp-field">
                <dt>Verified by</dt>
                <dd>Publisher</dd>
              </div>
              <div className="lp-field">
                <dt>Settled in</dt>
                <dd>Coins</dd>
              </div>
            </dl>

            <h1 className="lp-h1">
              Pay for signups,
              <br />
              not for <em>scans</em>.
            </h1>

            <p className="lp-lede">
              Print a QR code on anything. When someone scans it they land inside a partner
              publisher&rsquo;s app, and coins leave your campaign budget{' '}
              <b>only after that publisher confirms a real signup</b> — at the guest rate until
              they verify the person, at your full rate once they do.
            </p>

            <div className="lp-cta">
              <Link href={SIGNUP_PROMOTER} className="lp-btn lp-btn-lg">
                Start a campaign
              </Link>
              <Link href={SIGNUP_PUBLISHER} className="lp-btn lp-btn-ghost lp-btn-lg">
                Join as a publisher
              </Link>
            </div>
            <p className="lp-cta-note">
              Fund a budget, print a code, and watch it draw down. No spend until a scan converts.
            </p>
          </div>

          <div className="lp-perf" aria-hidden="true">
            <span className="lp-notch" />
          </div>

          <ScanStub />
        </div>

        <ActivityBoard />
      </header>

      <section className="lp-section lp-wrap">
        <hr className="lp-trim" />
        <div className="lp-section-head">
          <h2 className="lp-h2">One scan, four coupons.</h2>
          <p className="lp-sub">
            Nothing is charged to you until the fourth. Every stage is a checkpoint the scan has to
            clear, and the money only moves at the end of the strip.
          </p>
          <JourneyTrigger />
        </div>
        <JourneyFlow />
        <div className="lp-strip lp-stocked">
          {LEGS.map((l) => (
            <article className="lp-leg" key={l.no}>
              <span className="lp-leg-no">{l.no}</span>
              <h3>{l.title}</h3>
              <p>{l.body}</p>
              <code>{l.meta}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-wrap">
        <hr className="lp-trim" />
        <div className="lp-section-head">
          <h2 className="lp-h2">Two fares for the same seat.</h2>
          <p className="lp-sub">
            A publisher can hand coins to anyone who signs up, but you should not pay full price
            for a stranger. So a scan settles at one of two rates you set yourself — and the
            difference is held, not lost.
          </p>
        </div>
        <div className="lp-classes">
          <article className="lp-class lp-class-guest lp-stocked lp-enter">
            <div className="lp-class-top">
              <h3>Guest</h3>
              <span className="lp-tier lp-tier-guest">held</span>
            </div>
            <span className="lp-stamp" aria-hidden="true">Held</span>
            <p className="lp-amount">
              <span className="lp-num" style={{ '--to': 10 } as React.CSSProperties}>
                10
              </span>{' '}
              <small>of 50 coins</small>
            </p>
            <div className="lp-meter">
              <i />
            </div>
            <p>
              Somebody scanned and signed up, but the publisher has not vouched for who they are.
              They get the guest rate now, and the remaining 40 coins sit as{' '}
              <code>pending_coins</code> against a deadline.
            </p>
            <p className="lp-class-foot">
              Grace window set per partnership · default 7 days
            </p>
          </article>

          <article className="lp-class lp-class-verified lp-stocked lp-enter">
            <div className="lp-class-top">
              <h3>Verified</h3>
              <span className="lp-tier lp-tier-verified">posted</span>
            </div>
            <span className="lp-stamp" aria-hidden="true">Posted</span>
            <p className="lp-amount">
              <span className="lp-num" style={{ '--to': 50 } as React.CSSProperties}>
                50
              </span>{' '}
              <small>of 50 coins</small>
            </p>
            <div className="lp-meter">
              <i />
            </div>
            <p>
              The publisher cleared the user against its own bar and said so. The held-back
              difference is released in a single idempotent call, so a retry cannot pay the same
              person twice.
            </p>
            <p className="lp-class-foot">
              Released after the deadline? Refused — the budget keeps the difference.
            </p>
          </article>
        </div>
      </section>

      <section className="lp-section lp-wrap">
        <hr className="lp-trim" />
        <div className="lp-section-head">
          <h2 className="lp-h2">Fare rules, printed on the back.</h2>
          <p className="lp-sub">
            A code in the wild is a spending instrument you cannot recall. These are the controls
            that keep a lost print run from becoming a lost budget.
          </p>
        </div>
        <dl className="lp-rules lp-stocked">
          {RULES.map((r) => (
            <div className="lp-rule lp-enter" key={r.term}>
              <dt>{r.term}</dt>
              <dd>{r.body}</dd>
              <dd className="lp-rule-val">{r.val}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="lp-close lp-wrap">
        <hr className="lp-trim" />
        <div className="lp-close-pass lp-pass-shell lp-stocked lp-cropped lp-enter">
          <div className="lp-close-main">
            <h2 className="lp-h2">Ready to print?</h2>
            <p className="lp-sub">
              Create a promoter account, request a partnership with a publisher, fund a campaign,
              and design your first code. The budget you fund is the most you can ever spend.
            </p>
            <div className="lp-cta">
              <Link href={SIGNUP_PROMOTER} className="lp-btn lp-btn-lg">
                Start a campaign
              </Link>
              <Link href="/login" className="lp-btn lp-btn-ghost lp-btn-lg">
                Sign in
              </Link>
            </div>
          </div>

          <div className="lp-perf" aria-hidden="true">
            <span className="lp-notch" />
          </div>

          <aside className="lp-close-stub">
            <span className="lp-label">Publishers</span>
            <p>
              Bring your own audience and your own verification. Set a landing URL, take a
              partnership, and call the Partner API when a scanned user signs up.
            </p>
            <Link href={SIGNUP_PUBLISHER} className="lp-btn lp-btn-ghost">
              Join as a publisher
            </Link>
          </aside>
        </div>
      </section>
      </main>

      <footer className="lp-foot lp-wrap">
        <span className="lp-foot-press">QR Reward Platform · Stock 04 · Press 01</span>
        <span>
          Activity shown on this page is example data, not live traffic. ·{' '}
          <Link href="/login">Sign in</Link>
        </span>
      </footer>
    </div>
  );
}
