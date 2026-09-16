import SectionHead from './SectionHead';
import { RULES } from './Content';
import * as lp from '@/lib/lp';

export default function MoneyControls() {
  return (
    <section className={`${lp.section} ${lp.wrap}`}>
      <SectionHead
        eyebrow="Money controls"
        title="The controls on a code you can’t recall."
        sub="A code in the wild is a spending instrument you cannot take back. These are the controls that keep a lost print run from becoming a lost budget."
      />
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
  );
}