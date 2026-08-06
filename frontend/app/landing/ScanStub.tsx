'use client';
import CodeMark from './CodeMark';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

// The validation loop is a looping animation, so it only runs while the stub is
// actually on screen. Nothing here gates content — the stub renders complete on
// the server and the observer only toggles motion.
export default function ScanStub() {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <aside className={lp.stub} ref={ref} data-run={inView ? '' : undefined}>
      <div className={lp.codePlate}>
        <CodeMark />
        <span className={lp.scanSweep} aria-hidden="true" />
        <span className={lp.codeRing} aria-hidden="true" />
      </div>
      <dl className={lp.stubFields}>
        {([
          ['Code', '7f3a·c19e'],
          ['Expires', '30 days'],
          ['Uses', 'Unlimited'],
        ] as const).map(([dt, dd]) => (
          <div className={`lp-field ${lp.field}`} key={dt}>
            <dt className={lp.fieldTerm}>{dt}</dt>
            <dd className={lp.fieldValue}>{dd}</dd>
          </div>
        ))}
        <div className={`lp-field ${lp.field}`}>
          <dt className={lp.fieldTerm}>Status</dt>
          <dd className={lp.status}>
            <span className={lp.statusIdle}>awaiting scan</span>
            <span className={lp.statusDone}>redeemed</span>
          </dd>
        </div>
      </dl>
    </aside>
  );
}
