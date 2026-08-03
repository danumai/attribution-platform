import Link from 'next/link';
import {
  Brand,
  Coupon,
  Fields,
  Pass,
  PassStamp,
  Perf,
  Serial,
  Stub,
  passLede,
  passNote,
  passPage,
  passTitle,
} from '@/lib/pass';
import { btn } from '@/lib/tw';

/** A mistyped URL used to fall out of the world into Next's unstyled default.
 *  It is the same instrument as every other surface, printed with no reference. */
export default function NotFound() {
  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <Brand />
          <PassStamp>NO REF</PassStamp>
          <h1 className={passTitle}>There is nothing filed here</h1>
          <p className={passLede}>
            The address you followed does not match any page in this workspace.
          </p>
          <p className={passNote}>
            If you arrived from a link inside the console, the record it pointed at may have been
            removed since.
          </p>
          <Link className={`${btn} mt-5.5`} href="/">
            Back to the start
          </Link>
        </Coupon>
        <Perf />
        <Stub>
          <Fields
            items={[
              ['Status', '404'],
              ['Record', 'Not found'],
            ]}
          />
          <Serial items={['No charge', 'Rev 01']} />
        </Stub>
      </Pass>
    </main>
  );
}
