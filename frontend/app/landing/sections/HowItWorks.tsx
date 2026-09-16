import JourneyTrigger from '../JourneyTrigger';
import JourneyFlow from '../JourneyFlow';
import SectionHead from './SectionHead';
import { LEGS } from './Content';
import * as lp from '@/lib/lp';

export default function HowItWorks() {
  return (
    <section className={`${lp.section} ${lp.wrap}`}>
      <SectionHead
        eyebrow="How it works"
        title="One scan, four checkpoints."
        sub="Nothing is charged to you until the fourth. Every stage is a checkpoint the scan has to clear, and the money only moves at the end."
      >
        <JourneyTrigger />
      </SectionHead>
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
  );
}