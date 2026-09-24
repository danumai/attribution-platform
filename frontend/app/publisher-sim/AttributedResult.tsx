import {
  Coupon,
  Fields,
  Pass,
  PassStamp,
  Serial,
  Stub,
  passLede,
  passPage,
  passTitle,
} from '@/lib/pass';
import { alertErr, btn, card, cx, muted, pillNeutral } from '@/lib/tw';
import { num } from '@/lib/fmt';
import { PublisherBrand } from './PublisherBrand';

export function AttributedResult({
  result,
  busy,
  err,
  onConfirm,
}: {
  result: any;
  busy: boolean;
  err: string;
  onConfirm: () => void;
}) {
  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <PublisherBrand />
          <PassStamp posted>POSTED</PassStamp>
          <h1 className={passTitle}>
            {/* `bonus_label` is now the summary of whichever offers apply to *this* claim, so
                the engagement case no longer needs its own wording — the API already scoped it. */}
            {result.bonus_label ??
              (result.kind === 'engagement' ? 'Purchase reward applied' : 'Joining bonus applied')}
          </h1>
          {/* What the publisher's app would actually act on. `type` is this publisher's own
              word for the kind of thing it grants — the platform stores and echoes it and
              never fulfils any of it. */}
          {result.bonuses?.length > 0 && (
            <ul className={`${muted} mt-2 space-y-0.5`}>
              {result.bonuses.map((b: any, i: number) => (
                <li key={i}>
                  <span className={pillNeutral}>{b.type}</span> {b.label}
                  {b.value !== undefined && ` — grants ${num(b.value)}${b.unit ? ` ${b.unit}` : ''}`}
                </li>
              ))}
            </ul>
          )}

          <p className={passLede}>
            Granted by this publisher under its own new-user policy. The platform recorded the
            install against <strong>{result.campaign_name}</strong> and charged the promoter a{' '}
            {num(result.fee)}-credit marketing fee — the user&apos;s bonus and the promoter&apos;s
            fee are separate things.
          </p>

          {result.pending_fee > 0 && (
            <div className={`${card} mt-3`}>
              <p>
                <strong>{num(result.pending_fee)} credits</strong> of the fee are held back until
                this publisher confirms the user cleared its verification bar.
              </p>
              <p className={muted}>
                Holds until {new Date(result.confirm_deadline).toLocaleDateString()}.
              </p>
              <button className={cx(btn, 'mt-3.5')} disabled={busy} onClick={onConfirm}>
                {busy ? 'Confirming…' : 'Confirm this user is verified'}
              </button>
              {err && <div className={`${alertErr} mt-3.5`}>{err}</div>}
            </div>
          )}
        </Coupon>
        <Stub>
          <Fields
            items={[
              ['Attribution', result.attribution_id],
              ['Matched by', result.match_method],
              ['Fee charged', num(result.fee)],
              ...(result.pending_fee > 0
                ? ([['Held back', num(result.pending_fee)]] as [string, string][])
                : []),
            ]}
          />
          <Serial items={[result.pending_fee > 0 ? 'Part held' : 'Posted']} />
        </Stub>
      </Pass>
    </main>
  );
}
