'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Shell, type NavItem } from '@/lib/shell';
import { Analytics, Audience } from '@/lib/audience';
import type { CampaignStats, OrgType, QrCode } from '@/lib/types';
import { toast } from '@/components/ui/toast';
import { DEFAULT_STYLE, Style, renderPreview } from '@/lib/qr';
import { card, cx, link, muted, sectionHead } from '@/lib/tw';
import { offerLine } from '@/lib/fmt';
import { CodeList } from './CodeList';
import { Performance } from './Performance';
import { Studio } from './Studio';

/** Long enough that dragging a slider does not fire a render per pixel. */
const RENDER_DEBOUNCE_MS = 220;

function styleOf(q: QrCode | null): Style {
  return { ...DEFAULT_STYLE, ...(q?.style ?? {}) };
}

export function CampaignClient({
  org,
  campaignId,
  initialStats,
  initialQrs,
  audience,
  days,
}: {
  org: { id: string; name: string; type: OrgType };
  campaignId: string;
  initialStats: CampaignStats;
  initialQrs: QrCode[];
  audience: Analytics;
  days: number;
}) {
  const router = useRouter();
  const [stats, setStats] = useState(initialStats);
  const [qrs, setQrs] = useState(initialQrs);
  const [sel, setSel] = useState<QrCode | null>(initialQrs[0] ?? null);
  const [style, setStyle] = useState<Style>(styleOf(initialQrs[0] ?? null));
  const [saved, setSaved] = useState<Style>(styleOf(initialQrs[0] ?? null));
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState('');
  const [renderErr, setRenderErr] = useState('');
  const [rendering, setRendering] = useState(false);

  /** Point the editor at a code, and reset both the working plate and its saved baseline. */
  const select = useCallback((q: QrCode) => {
    setSel(q);
    const st = styleOf(q);
    setStyle(st);
    setSaved(st);
  }, []);

  const reload = useCallback(
    async (keepSelId?: string) => {
      try {
        const [s, q] = await Promise.all([
          api<CampaignStats>(`/v1/campaigns/${campaignId}/stats`),
          api<QrCode[]>(`/v1/campaigns/${campaignId}/qr-codes`),
        ]);
        setStats(s);
        setQrs(q);
        const pick = q.find((x) => x.id === keepSelId) ?? q[0] ?? null;
        if (pick) select(pick);
        else setSel(null);
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [campaignId, select],
  );

  const setDays = (d: number) => {
    const qs = d === 30 ? '' : `?days=${d}`;
    router.push(`/campaigns/${campaignId}${qs}`);
  };

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setRendering(true);
    const t = setTimeout(async () => {
      try {
        const out = await renderPreview(sel.id, style);
        if (!cancelled) {
          setSvg(out);
          setRenderErr('');
        }
      } catch (e: any) {
        if (!cancelled) setRenderErr(e.message);
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sel, style]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const isPromoter = org.type === 'promoter';
  const items: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'overview', href: '/dashboard' },
    { id: 'partnerships', label: 'Partnerships', icon: 'partnerships', href: '/dashboard/partnerships' },
    { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', href: '/dashboard/campaigns' },
    { id: 'redemptions', label: 'Redemptions', icon: 'redemptions', href: '/dashboard/redemptions' },
    ...(isPromoter
      ? []
      : [{ id: 'settings', label: 'Settings', icon: 'settings' as const, href: '/dashboard/settings' }]),
  ];
  const backToCampaigns = (
    <Link className={link} href="/dashboard/campaigns">
      ← All campaigns
    </Link>
  );

  return (
    <Shell
      org={org}
      active="campaigns"
      items={items}
      title={stats.name ?? 'Campaign'}
      lede={isPromoter ? 'Its numbers, its codes and how they print.' : 'How this campaign is performing.'}
      actions={backToCampaigns}
    >
      <h2 className={sectionHead}>Performance</h2>
      <Performance stats={stats} audience={audience} />

      {/* The numbers above say how much this campaign did. This says where to spend the next
          print run — which is the decision the promoter actually came here to make. */}
      <h2 className={sectionHead}>Audience</h2>
      <Audience data={audience} days={days} onDays={setDays} scoped />

      {!isPromoter && (
        <p className={cx(muted, 'mt-4.5')}>QR design is managed by the promoter on this campaign.</p>
      )}

      {isPromoter && (
        <>
          <h2 className={sectionHead}>QR codes</h2>
          {/* What the poster is allowed to promise. The publisher declares it and grants it out
              of its own pocket — coins, a subscription, a discount — and it is not part of the
              rate you pay, so it is printed here rather than beside the money. */}
          <p className={cx(muted, 'mt-3')}>
            {stats.publisher_bonuses?.length
              ? `The publisher gives every rewarded user: ${offerLine(stats.publisher_bonuses)}. That is what the artwork can promise.`
              : 'The publisher has not declared what it gives the user yet — ask before printing a promise.'}
          </p>
          <CodeList
            campaignId={campaignId}
            qrs={qrs}
            sel={sel}
            onSelect={select}
            style={style}
            busy={busy}
            act={act}
            reload={reload}
          />

          {!sel ? (
            <div className={cx(card, 'mt-3')}>
              <p className={muted}>No codes yet — create one above and the design studio opens here.</p>
            </div>
          ) : (
            <>
              <h2 className={sectionHead}>Design studio</h2>
              <Studio
                sel={sel}
                style={style}
                setStyle={setStyle}
                saved={saved}
                setSaved={setSaved}
                svg={svg}
                renderErr={renderErr}
                rendering={rendering}
                busy={busy}
                act={act}
                reload={reload}
              />
            </>
          )}
        </>
      )}
    </Shell>
  );
}
