'use client';
import { useEffect, useRef, useState } from 'react';
import CodeMark from './CodeMark';

// The validation loop is a looping animation, so it only runs while the stub is
// actually on screen. Nothing here gates content — the stub renders complete on
// the server and the observer only toggles motion.
export default function ScanStub() {
  const ref = useRef<HTMLElement>(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setRun(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <aside className="lp-stub" ref={ref} data-run={run ? '' : undefined}>
      <div className="lp-code">
        <CodeMark />
        <span className="lp-scan" aria-hidden="true" />
        <span className="lp-code-ring" aria-hidden="true" />
      </div>
      <dl className="lp-stub-fields">
        <div className="lp-field">
          <dt>Code</dt>
          <dd>7f3a·c19e·4b02</dd>
        </div>
        <div className="lp-field">
          <dt>Expires</dt>
          <dd>30 days</dd>
        </div>
        <div className="lp-field">
          <dt>Uses</dt>
          <dd>Unlimited</dd>
        </div>
        <div className="lp-field">
          <dt>Status</dt>
          <dd className="lp-status">
            <span className="lp-status-idle">awaiting scan</span>
            <span className="lp-status-done">redeemed</span>
          </dd>
        </div>
      </dl>
      <p className="lp-serial">
        <span>Ser. 7f3a-c19e</span>
        <span>Rev 04</span>
        <span>Press 01</span>
      </p>
    </aside>
  );
}
