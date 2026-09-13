'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import type { QrCode } from '@/lib/types';
import type { Style } from '@/lib/qr';
import { btn, card, code as codeChip, codeTab, cx, field, label as labelClass } from '@/lib/tw';

/** The codes this campaign has issued, and the form that mints another with the current design. */
export function CodeList({
  campaignId,
  qrs,
  sel,
  onSelect,
  style,
  busy,
  act,
  reload,
}: {
  campaignId: string;
  qrs: QrCode[];
  sel: QrCode | null;
  onSelect: (q: QrCode) => void;
  style: Style;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  reload: (keepSelId?: string) => Promise<void>;
}) {
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [maxUses, setMaxUses] = useState('');

  return (
    <div className={cx(card, 'mt-3')}>
      <div className="flex flex-wrap gap-2">
        {qrs.map((q) => (
          <button key={q.id} className={codeTab(q.id === sel?.id, q.voided)} onClick={() => onSelect(q)}>
            <code className={codeChip}>/{q.code}</code>
            {/* Only machine-issued codes carry a reference — the promoter's own PNR or order
             * number, from `POST /v1/issue`. Shown here so this same list, unavoidably shared
             * with studio-designed poster codes, is where a promoter finds one specific ticket. */}
            {q.issued_ref && <span className="text-[10.5px] text-ink-soft">{q.issued_ref}</span>}
            <span className="text-[10.5px] font-bold tracking-widest uppercase">
              {q.voided ? 'voided' : `${q.uses ?? 0} scans`}
            </span>
          </button>
        ))}
      </div>

      <details className="mt-4 border-t-2 border-line-soft pt-1 [&[open]>summary]:text-ink">
        <summary className="cursor-pointer list-none px-0 pt-2.5 pb-0.5 text-[13.5px] font-semibold text-accent-text hover:underline hover:underline-offset-[3px] [&::-webkit-details-marker]:hidden">
          + New QR code
        </summary>
        <div className="flex flex-wrap items-end gap-3.5">
          <div className="flex-[1_1_160px]">
            <label className={labelClass}>Expires in (days, 0 = never)</label>
            <input
              className={field}
              type="number"
              min={0}
              max={3650}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(+e.target.value)}
            />
          </div>
          <div className="flex-[1_1_160px]">
            <label className={labelClass}>Max scans (blank = unlimited)</label>
            <input
              className={field}
              type="number"
              min={1}
              placeholder="unlimited"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <button
            className={cx(btn, 'mt-3.5')}
            disabled={busy}
            onClick={() =>
              act(async () => {
                const q = await api<QrCode>(`/v1/campaigns/${campaignId}/qr-codes`, {
                  method: 'POST',
                  body: JSON.stringify({
                    style,
                    expires_in_days: expiresInDays,
                    max_uses: maxUses ? +maxUses : null,
                  }),
                });
                await reload(q.id);
                toast.success(`Code /${q.code} created with the current design.`);
              })
            }
          >
            {busy ? 'Creating…' : 'Create code'}
          </button>
        </div>
      </details>
    </div>
  );
}
