import { Inter } from 'next/font/google';
import { UI } from '@/lib/ui';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata = {
  title: 'QR Reward Platform',
  description:
    'Run QR reward campaigns with publishers — scans, redemptions and budgets in one place.',
};

export const viewport = { themeColor: '#f7f8fa' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-paper font-sans text-[15px] leading-[1.55] tracking-[-0.011em] text-ink antialiased">
        {children}
        <UI />
      </body>
    </html>
  );
}
