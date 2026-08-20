'use client';
import { confirmDialog, promptDialog } from '@/lib/ui';
import { when } from '@/lib/fmt';
import { link as linkClass } from '@/lib/tw';
import { Actions, Table } from '../Table';
import { pill, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading' | 'busy' | 'patch' | 'post'>;

export function Organizations({ d, loading, busy, patch, post }: Props) {
  const { item } = rowControls(busy);

  return (
    <Table
      loading={loading}
      rows={d.orgs ?? []}
      cols={[
        { h: 'Name', get: (x) => x.name },
        { h: 'Type', sort: (x) => x.type, get: (x) => pill(x.type) },
        { h: 'Email', get: (x) => x.email },
        {
          h: 'Landing URL',
          sort: (x) => x.landing_url ?? '',
          get: (x) =>
            x.landing_url ? (
              <a className={linkClass} href={x.landing_url} target="_blank" rel="noreferrer">
                {x.landing_url}
              </a>
            ) : (
              '—'
            ),
        },
        {
          h: 'API key',
          sort: (x) => x.has_api_key,
          get: (x) =>
            x.type !== 'publisher' ? '—' : x.has_api_key ? 'set' : <span className="text-bad">missing</span>,
        },
        { h: 'Campaigns', num: true, get: (x) => x.campaigns },
        { h: 'Coins', num: true, get: (x) => x.coin_balance ?? '—' },
        { h: 'Joined', get: (x) => when(x.created_at), sort: (x) => x.created_at },
        { h: 'Status', get: (x) => pill(x.suspended ? 'suspended' : 'active'), sort: (x) => x.suspended },
        {
          h: '',
          get: (x) => (
            <Actions>
              {item(x.suspended ? 'Reinstate' : 'Suspend', () =>
                patch(
                  `/v1/admin/orgs/${x.id}`,
                  { suspended: !x.suspended },
                  x.suspended ? 'Reinstated' : 'Suspended',
                ),
              )}
              {item('Rename', async () => {
                const name = await promptDialog({
                  title: `Rename ${x.name}`,
                  inputLabel: 'Organization name',
                  input: x.name,
                  confirmText: 'Rename',
                });
                if (name && name !== x.name) patch(`/v1/admin/orgs/${x.id}`, { name }, 'Renamed');
              })}
              {x.type === 'publisher' && (
                <>
                  {item('Set landing URL', async () => {
                    const landing_url = await promptDialog({
                      title: `Landing URL for ${x.name}`,
                      body: 'Where a scanned user is redirected. Must be https.',
                      inputLabel: 'URL',
                      input: x.landing_url ?? '',
                      confirmText: 'Save',
                    });
                    if (landing_url) patch(`/v1/admin/orgs/${x.id}`, { landing_url }, 'Landing URL updated');
                  })}
                  {item('Rotate API key', async () => {
                    const go = await confirmDialog({
                      title: `Rotate the API key for ${x.name}?`,
                      body: 'The old key stops working immediately, and their backend will fail until they deploy the new one.',
                      confirmText: 'Rotate key',
                      danger: true,
                    });
                    if (go) post(`/v1/admin/orgs/${x.id}/rotate-key`, {});
                  })}
                </>
              )}
              {item(
                'Offboard org',
                async () => {
                  const reason = await promptDialog({
                    title: `Offboard ${x.name}?`,
                    body: 'Suspends the org, revokes its API key and ends every campaign it takes part in. Recorded in the audit log.',
                    inputLabel: 'Reason',
                    input: '',
                    confirmText: 'Offboard',
                    danger: true,
                  });
                  if (reason !== null) post(`/v1/admin/orgs/${x.id}/offboard`, { reason }, 'Org offboarded');
                },
                true,
              )}
            </Actions>
          ),
        },
      ]}
    />
  );
}
