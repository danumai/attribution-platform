import Compare from './Compare';
import Proof from './Proof';
import Faq from './Faq';
import Nav from './sections/Nav';
import Hero from './sections/Hero';
import HowItWorks from './sections/HowItWorks';
import PricingSection from './sections/PricingSection';
import AudiencePaths from './sections/AudiencePaths';
import MoneyControls from './sections/MoneyControls';
import ClosingCta from './sections/ClosingCta';
import Footer from './sections/Footer';
import SectionHead from './sections/SectionHead';
import * as lp from '@/lib/lp';
import './landing.css';

export default function Landing() {
  return (
    /* `lp` and the other lp-* names are motion hooks for landing.css, not styling */
    <div className="lp max-w-none overflow-x-clip p-0 text-ink">
      <Nav />

      <main className="m-0 max-w-none p-0">
        <Hero />

        <HowItWorks />

        <PricingSection />

        {/* The planner leaves the reader holding a number. This is the section that tells them
            what that number is worth against the two things they are actually choosing between. */}
        <section className={`${lp.section} ${lp.wrap}`}>
          <SectionHead
            eyebrow="How this differs"
            title="Priced on the signup, not the click."
            sub="Every row below is about what a pricing model bills you for and what it can prove. None of it is a claim about any particular network’s conduct."
          />
          <Compare />
        </section>

        {/* Both sides of the marketplace, given equal weight. The publisher used to appear only
            as a footnote in the closing panel, which is a strange way to treat half the market. */}
        <AudiencePaths />

        <section className={`${lp.section} ${lp.wrap}`}>
          <SectionHead
            eyebrow="Who scans land in"
            title="The apps on the other side of the code."
            sub="A scan is only worth funding if it ends somewhere the person actually wanted to go. Publishers bring the destination; you bring the print run."
          />
          <Proof />
        </section>

        <MoneyControls />

        {/* The six things that get asked before anyone funds a budget. Answering them here
            is cheaper than answering them one email at a time. */}
        <section className={`${lp.section} ${lp.wrap}`}>
          <SectionHead
            eyebrow="Before you fund"
            title="The questions that come first."
            sub="Six answers about what you are charged for, what stops a leaked print run, and what each side has to build."
          />
          <Faq />
        </section>

        <ClosingCta />
      </main>

      <Footer />
    </div>
  );
}