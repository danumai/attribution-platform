import { Archivo, Inter } from 'next/font/google';
import { UI } from '@/lib/ui';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth'],
  variable: '--font-display',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${archivo.variable}`}>
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${CONTRACT}-->` }} />
        {children}
        <UI />
      </body>
    </html>
  );
}
