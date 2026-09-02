'use client';
import Link from 'next/link';
import {
  Brand,
  Coupon,
  Fields,
  Pass,
  PassStamp,
  Serial,
  Stub,
  passLede,
  passNote,
  passPage,
  passTitle,
} from '@/lib/pass';
import { btn, btnGhost } from '@/lib/tw';

/**
 * The hole `not-found.tsx` left open. A mistyped URL was already caught and printed as an
 * instrument; a render error was not, and still dropped the user into Next's unstyled default.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <Brand />
          <PassStamp>SPOILED</PassStamp>
          <h1 className={passTitle}>This page did not print</h1>
          <p className={passLede}>Something went wrong rendering it. Nothing was lost.</p>
          <p className={passNote}>
            Trying again re-runs just this page. If it keeps failing, the record it was reading
            may be in a state the console does not expect yet.
          </p>
          <div className="mt-5.5 flex flex-wrap gap-2">
            <button className={btn} onClick={reset}>
              Try again
            </button>
            <Link className={btnGhost} href="/dashboard">
              Back to the console
            </Link>
          </div>
        </Coupon>
        <Stub>
          <Fields
            items={[
              ['Status', 'Render failed'],
              // `digest` is what a server-side error is reduced to in production; the message
              // itself is withheld there on purpose, so print whichever one exists.
              ['Reference', (error as { digest?: string }).digest ?? (error.message.slice(0, 40) || '—')],
            ]}
          />
          <Serial items={['No charge']} />
        </Stub>
      </Pass>
    </main>
  );
}
