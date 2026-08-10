import Link from 'next/link';
import ActivityBoard from './ActivityBoard';
import ScanStub from './ScanStub';
import JourneyFlow from './JourneyFlow';
import JourneyTrigger from './JourneyTrigger';
import BudgetPlanner from './BudgetPlanner';
import Faq from './Faq';
import * as lp from '@/lib/lp';
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

const PATHS = [
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
    /* `lp` and the other lp-* names are motion hooks for landing.css, not styling */
    <div className="lp max-w-none overflow-x-clip p-0 text-ink">
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

      <main className="m-0 max-w-none p-0">
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
        </header>

        <section className={`${lp.section} ${lp.wrap}`}>
          <div className={lp.sectionHead}>
            <span className={lp.eyebrow}>How it works</span>
            <h2 className={lp.h2}>One scan, four checkpoints.</h2>
            <p className={lp.sub}>
              Nothing is charged to you until the fourth. Every stage is a checkpoint the scan has
              to clear, and the money only moves at the end.
            </p>
            <JourneyTrigger />
          </div>
          <JourneyFlow />
          <div className={lp.strip}>
            {LEGS.map((l) => (
              <article className={lp.leg} key={l.no}>
                <span className={lp.legNo}>{l.no}</span>
                <h3 className={lp.legTitle}>{l.title}</h3>
                <p className={lp.legBody}>{l.body}</p>
                <code className={lp.legMeta}>{l.meta}</code>
              </article>
            ))}
          </div>
        </section>

        <section className={`${lp.section} ${lp.wrap}`}>
          <div className={lp.sectionHead}>
            <span className={lp.eyebrow}>Pricing model</span>
            <h2 className={lp.h2}>Two rates for the same signup.</h2>
            <p className={lp.sub}>
              A publisher can hand coins to anyone who signs up, but you should not pay full price
              for a stranger. So a scan settles at one of two rates you set yourself — and the
              difference is held, not lost.
            </p>
          </div>
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

          {/* The two rates argue in the abstract. This is the same argument with the reader's
              own numbers in it — the only place on the page they can steer anything. */}
          <BudgetPlanner />
        </section>

        {/* Both sides of the marketplace, given equal weight. The publisher used to appear only
            as a footnote in the closing panel, which is a strange way to treat half the market. */}
        <section className={`${lp.section} ${lp.wrap}`}>
          <div className={lp.sectionHead}>
            <span className={lp.eyebrow}>Which side are you on</span>
            <h2 className={lp.h2}>Two accounts, one ledger.</h2>
            <p className={lp.sub}>
              A promoter funds and prints. A publisher delivers and verifies. Every coin that moves
              between them is one entry on the same double-entry ledger.
            </p>
          </div>
          <div className={lp.paths}>
            {PATHS.map((p) => (
              <article className={lp.path} key={p.key}>
                <span className={lp.pathMark} aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
                       strokeLinecap="round" strokeLinejoin="round">
                    {p.icon}
                  </svg>
                </span>
                <h3 className={lp.pathTitle}>{p.title}</h3>
                <p className={lp.pathBody}>{p.body}</p>
                <ul className={lp.pathList}>
                  {p.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
                <div className={lp.pathFoot}>
                  <Link href={p.href} className={p.primary ? lp.btn : lp.btnGhost}>
                    {p.label}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={`${lp.section} ${lp.wrap}`}>
          <div className={lp.sectionHead}>
            <span className={lp.eyebrow}>Money controls</span>
            <h2 className={lp.h2}>The controls on a code you can&rsquo;t recall.</h2>
            <p className={lp.sub}>
              A code in the wild is a spending instrument you cannot take back. These are the
              controls that keep a lost print run from becoming a lost budget.
            </p>
          </div>
          <dl className={lp.rules}>
            {RULES.map((r) => (
              <div className={lp.rule} key={r.term}>
                <dt className={lp.ruleTerm}>{r.term}</dt>
                <dd className={lp.ruleBody}>{r.body}</dd>
                <dd className={lp.ruleVal}>{r.val}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The six things that get asked before anyone funds a budget. Answering them here
            is cheaper than answering them one email at a time. */}
        <section className={`${lp.section} ${lp.wrap}`}>
          <div className={lp.sectionHead}>
            <span className={lp.eyebrow}>Before you fund</span>
            <h2 className={lp.h2}>The questions that come first.</h2>
            <p className={lp.sub}>
              Six answers about what you are charged for, what stops a leaked print run, and
              what each side has to build.
            </p>
          </div>
          <Faq />
        </section>

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
      </main>

      <footer className={`${lp.foot} ${lp.wrap}`}>
        <span>QR Reward Platform</span>
        <span>
          Activity shown on this page is example data, not live traffic. ·{' '}
          <Link href="/login">Sign in</Link>
        </span>
      </footer>
    </div>
  );
}
