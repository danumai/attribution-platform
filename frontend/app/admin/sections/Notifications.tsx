'use client';
import { when } from '@/lib/fmt';
import { btnGhost, cx, muted } from '@/lib/tw';
import { Table } from '../Table';
import { auditCols, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading' | 'busy' | 'post'>;

/**
 * The unread end of the audit log — same rows, same shape. What makes it a separate tab is that
 * leaving it is an action.
 */
export function Notifications({ d, loading, busy, post }: Props) {
  const { link } = rowControls(busy);
  const rows = d.notifications ?? [];

  return (
    <>
      {rows.length > 0 && (
        <div className="mt-3 flex justify-end">
          <button
            className={btnGhost}
            disabled={busy}
            onClick={() => post('/v1/admin/notifications/ack', {}, 'Inbox cleared.')}
          >
            Mark all handled
          </button>
        </div>
      )}
      <Table
        loading={loading}
        rows={rows}
        empty="Nothing from a tenant is waiting — every budget change has been seen."
        cols={[
          { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
          {
            h: 'Who',
            sort: (x) => x.actor_name ?? '',
            get: (x) => (
              <>
                {x.actor_name ?? 'system'}
                {x.actor_type && <span className={cx(muted, 'ml-1.5')}>{x.actor_type}</span>}
              </>
            ),
          },
          ...auditCols,
          {
            h: '',
            get: (x) =>
              link('Mark handled', () =>
                post('/v1/admin/notifications/ack', { ids: [x.id] }, 'Marked handled.'),
              ),
          },
        ]}
      />
    </>
  );
}
