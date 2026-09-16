import Link from 'next/link';
import SectionHead from './SectionHead';
import { PATHS } from './Content';
import * as lp from '@/lib/lp';

export default function AudiencePaths() {
  return (
    <section className={`${lp.section} ${lp.wrap}`}>
      <SectionHead
        eyebrow="Which side are you on"
        title="Two accounts, one ledger."
        sub="A promoter funds and prints. A publisher delivers and verifies. Every coin that moves between them is one entry on the same double-entry ledger."
      />
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
  );
}