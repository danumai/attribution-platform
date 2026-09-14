import { Schibsted_Grotesk, JetBrains_Mono } from 'next/font/google';
import { UI } from '@/components/ui/index';
import './globals.css';

const sans = Schibsted_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-schibsted',
});

// Figures are mono everywhere in this theme, so the stack has to resolve to the same face on every
// OS — the system stack renders as SF Mono / Consolas / DejaVu.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export const metadata = {
  title: 'QR Reward Platform',
  description:
    'Run QR reward campaigns with publishers — scans, redemptions and budgets in one place.',
};

/* One scheme, so one colour — and no pre-paint boot script to restore a stored
   choice, because there is no choice left to store. */
export const viewport = { themeColor: '#ECE9E4' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-[15px] leading-[1.55] tracking-[-0.011em] text-ink antialiased">
        {children}
        <UI />
      </body>
    </html>
  );
}
