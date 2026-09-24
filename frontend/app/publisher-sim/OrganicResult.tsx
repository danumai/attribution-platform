import {
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
import { PublisherBrand } from './PublisherBrand';

export function OrganicResult({ result }: { result: any }) {
  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <PublisherBrand />
          <PassStamp>ORGANIC</PassStamp>
          <h1 className={passTitle}>Account created</h1>
          <p className={passLede}>
            This install was not attributable to a campaign
            {result.reason ? ` (${result.reason})` : ''}, so no promoter was charged.
          </p>
          <p className={passNote}>
            An unattributed install is a normal answer, not an error. Most installs are organic —
            the platform only bills a promoter when it can name the campaign that earned one.
          </p>
        </Coupon>
        <Stub>
          <Fields
            items={[
              ['Attributed', 'No'],
              ['Reason', result.reason ?? 'no match'],
              ['Promoter charged', '0'],
            ]}
          />
          <Serial items={['Organic']} />
        </Stub>
      </Pass>
    </main>
  );
}
