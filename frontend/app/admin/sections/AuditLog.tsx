'use client';
import { when } from '@/lib/fmt';
import { Table } from '../Table';
import { auditCols } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading'>;

export function AuditLog({ d, loading }: Props) {
  return (
    <Table
      loading={loading}
      rows={d.audit ?? []}
      empty="No admin actions recorded."
      cols={[
        { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
        { h: 'Actor', sort: (x) => x.actor_name ?? '', get: (x) => x.actor_name ?? 'system' },
        ...auditCols,
      ]}
    />
  );
}
