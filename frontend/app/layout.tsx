import { Archivo, Inter } from 'next/font/google';
import { UI } from '@/lib/ui';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth'],
  variable: '--font-archivo',
});

const CONTRACT = `
THESIS: a QR reward campaign is a printed spending instrument, so the page is the instrument
itself — a boarding pass with coupon, tear line and scannable stub. It refuses the SaaS hero
plus icon-card grid, and refuses claiming trust it has no customers to prove.
OWN-WORLD: buff ticket stock (#e7ddc9 ground, #faf6ee card), thermal-black ink, process blue
#1c39bb for validation, ochre #a35c00 for value held back, green #0a6b4a for value posted.
Archivo expanded for display, Inter for text, mono for every printed field. Perforated rules,
notched edges, stamped caps labels. No gradients, no glass, no rounded-card grid.
STORY: a promoter learns coins only leave their budget after a publisher vouches for a signup,
sees the two fares and the money controls, and starts a campaign.
FIRST VIEWPORT: full-width pass. Left coupon carries routing fields, the display headline, the
lede and both CTAs (primary bottom-left of the coupon). Right stub carries the printed code with
a repeating scan sweep and its ticket fields. The posting board sits directly beneath.
FORM: printed ticket strip; candidate 6 of the grounded list; seed key ec0cae7e.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, and DESIGN.md
`;

export const metadata = {
  title: 'QR Reward Platform',
  description:
    'Run QR reward campaigns with publishers — scans, redemptions and budgets in one place.',
};

export const viewport = { themeColor: '#e7ddc9' };

/* The paper grain: the ground is stock, not a screen. On the landing page the same
   layer becomes a desk — the grain over a slow, uneven wash of the stock's own tone.
   `has-[.lp]` is the old `body:has(.lp)` rule, spelled as a variant. */
const GRAIN =
  "before:content-[''] before:pointer-events-none before:fixed before:inset-0 before:z-0 " +
  'before:bg-[image:var(--grain)] before:bg-[length:140px_140px] before:opacity-[.08] ' +
  'before:[mix-blend-mode:multiply] has-[.lp]:before:opacity-[.10] ' +
  'has-[.lp]:before:bg-[image:var(--grain),radial-gradient(120%_80%_at_18%_-10%,color-mix(in_srgb,#ffffff_46%,transparent),transparent_62%),radial-gradient(90%_70%_at_92%_8%,color-mix(in_srgb,#1a1712_16%,transparent),transparent_58%)] ' +
  'has-[.lp]:before:bg-[length:140px_140px,cover,cover]';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${archivo.variable}`}>
      <body
        className={`min-h-dvh bg-paper font-sans text-[15px] leading-[1.55] tracking-[-0.006em] text-ink antialiased ${GRAIN}`}
      >
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${CONTRACT}-->` }} />
        {children}
        <UI />
      </body>
    </html>
  );
}
