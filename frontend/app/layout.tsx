import { Schibsted_Grotesk, JetBrains_Mono } from 'next/font/google';
import { UI } from '@/lib/ui';
import './globals.css';

const sans = Schibsted_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-schibsted',
});

/* Figures are mono everywhere in this theme, so the stack has to resolve to the same
   face on every OS — the system stack renders as SF Mono / Consolas / DejaVu and a
   strip of numbers stops looking designed. Two weights, latin only. */
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

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E7E2DA' },
    { media: '(prefers-color-scheme: dark)', color: '#2B2825' },
  ],
};

/* Runs before first paint so a light-mode reader never sees a dark flash. It has to be
   an inline string rather than a module: anything bundled arrives after the first
   paint, which is the whole problem it exists to solve. */
const BOOT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-[15px] leading-[1.55] tracking-[-0.011em] text-ink antialiased">
        {children}
        <UI />
      </body>
    </html>
  );
}
