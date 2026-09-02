'use client';
import { promptDialog, toast } from '@/lib/ui';
import { when } from '@/lib/fmt';
import { menuItem } from '@/lib/tw';
import { Actions, Table } from '../Table';
import { pill, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading' | 'busy' | 'patch'>;

export function QrCodes({ d, loading, busy, patch }: Props) {
  const { item } = rowControls(busy);

  return (
    <Table
      loading={loading}
      rows={d.qrCodes ?? []}
      empty="No codes issued."
      cols={[
        { h: 'Code', sort: (x) => x.code, get: (x) => <code>{x.code}</code> },
        // Set only on codes minted by `POST /v1/issue` — a promoter's own PNR or order number.
        // Studio-designed codes carry none, and search already covers this column for free.
        { h: 'Ticket ref', sort: (x) => x.issued_ref ?? '', get: (x) => x.issued_ref ?? '—' },
        { h: 'Campaign', get: (x) => x.campaign_name ?? '' },
        { h: 'Scans', num: true, sort: (x) => x.scans ?? 0, get: (x) => x.scans ?? 0 },
        { h: 'Uses', sort: (x) => x.uses, get: (x) => `${x.uses}${x.max_uses ? ` / ${x.max_uses}` : ' / ∞'}` },
        { h: 'Expires', sort: (x) => x.expires_at ?? '', get: (x) => (x.expires_at ? when(x.expires_at) : 'never') },
        { h: 'Created', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
        { h: 'State', sort: (x) => x.voided, get: (x) => pill(x.voided ? 'suspended' : 'active') },
        {
          h: '',
          get: (x) => (
            <Actions>
              <a className={menuItem()} href={x.scan_url} target="_blank" rel="noreferrer">
                Open the scan URL
              </a>
              {item('Copy scan URL', () => {
                navigator.clipboard.writeText(x.scan_url);
                toast.success('Scan URL copied');
              })}
              {item('Set expiry', async () => {
                const v = await promptDialog({
                  title: `Expiry for /${x.code}`,
                  body: 'ISO timestamp, or leave blank for a code that never expires.',
                  inputLabel: 'Expires at',
                  input: x.expires_at ? new Date(x.expires_at).toISOString() : '',
                  confirmText: 'Save',
                });
                if (v !== null) patch(`/v1/admin/qr-codes/${x.id}`, { expires_at: v.trim() || null }, 'Expiry updated');
              })}
              {item('Set max uses', async () => {
                const v = await promptDialog({
                  title: `Use limit for /${x.code}`,
                  body: 'Leave blank for unlimited scans.',
                  inputLabel: 'Max uses',
                  input: String(x.max_uses ?? ''),
                  confirmText: 'Save',
                });
                if (v !== null) patch(`/v1/admin/qr-codes/${x.id}`, { max_uses: v.trim() ? +v : null }, 'Max uses updated');
              })}
              {item(
                x.voided ? 'Restore this code' : 'Void this code',
                () =>
                  patch(
                    `/v1/admin/qr-codes/${x.id}`,
                    { voided: !x.voided },
                    x.voided ? 'Code restored' : 'Code voided',
                  ),
                !x.voided,
              )}
            </Actions>
          ),
        },
      ]}
    />
  );
}
