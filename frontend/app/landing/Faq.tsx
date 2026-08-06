import * as lp from '@/lib/lp';

/* Native <details>: the browser owns the toggle, the keyboard, the a11y semantics and — where
 * ::details-content is supported — the open/close animation too (see landing.css). No JS, and
 * the whole thing is readable and expandable with scripting off. */

const QA = [
  {
    q: 'When exactly do I get charged?',
    a: 'Only when a publisher confirms a signup that traces back to one of your scans. A scan on its own costs nothing — neither does an install that never signs up, or a signup the publisher cannot match to a scan.',
  },
  {
    q: 'What stops a photographed code from draining the budget?',
    a: 'Four things, stacked: the funded budget is a hard ceiling, codes expire (30 days by default), a code can be capped at max_uses, and you can void a whole print run so every future scan on it is refused.',
  },
  {
    q: 'Does this survive App Store review?',
    a: 'The QR unlocks nothing. It opens a store listing, and the install is matched afterwards server-to-server — no token, key or code ever travels into the app, which is what keeps it clear of App Store guideline 3.1.1.',
  },
  {
    q: 'How is an install matched on iOS, without a referrer?',
    a: 'By a short-window device match: the scan is fingerprinted coarsely at redirect time, and the publisher’s claim call is matched against it inside a narrow window. Android uses the Play install referrer, which is exact.',
  },
  {
    q: 'What does the publisher have to build?',
    a: 'One server call. When a scanned user signs up, POST to the Partner API; call it again when the user clears your own verification bar. Both are idempotent, so a retry cannot pay for the same person twice.',
  },
  {
    q: 'What happens to the held coins if verification never comes?',
    a: 'They stay with your budget. The release call is refused after the grace window closes — 7 days by default, set per partnership — so an unverified user costs you the guest rate and nothing more.',
  },
];

export default function Faq() {
  return (
    <div className={lp.faq}>
      {QA.map((item) => (
        <details className={lp.faqItem} key={item.q}>
          <summary className={lp.faqQ}>
            {item.q}
            <span className={lp.faqMark} aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
                   strokeLinecap="round">
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
            </span>
          </summary>
          <div className={lp.faqA}>
            <p>{item.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
