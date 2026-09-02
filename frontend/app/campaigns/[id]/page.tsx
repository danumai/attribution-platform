'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, org as getOrg, token } from '@/lib/api';
import { NavItem, Shell } from '@/lib/shell';
import { Analytics, Audience } from '@/lib/audience';
import type { CampaignStats, QrCode } from '@/lib/types';
import { LoadError, SkeletonStrip, toast } from '@/lib/ui';
import { DEFAULT_STYLE, Style, renderPreview } from '@/lib/qr';
import { card, cx, link, muted, sectionHead } from '@/lib/tw';
import { offerLine } from '@/lib/fmt';
import { CodeList } from './CodeList';
import { Performance } from './Performance';
import { Studio } from './Studio';

/** Long enough that dragging a slider does not fire a render per pixel. */
const RENDER_DEBOUNCE_MS = 220;

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const r = useRouter();
  const [me, setMe] = useState<ReturnType<typeof getOrg>>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  // Set when a load fails. Without it, `!stats` is indistinguishable from "still loading",
  // so a network blip left the page shimmering forever with no way back.
  const [loadErr, setLoadErr] = useState('');
  const [qrs, setQrs] = useState<QrCode[]>([]);
  const [sel, setSel] = useState<QrCode | null>(null);
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [saved, setSaved] = useState<Style>(DEFAULT_STYLE);
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState('');
  const [renderErr, setRenderErr] = useState('');
  const [rendering, setRendering] = useState(false);
  const [audience, setAudience] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);

  /** Point the editor at a code, and reset both the working plate and its saved baseline. */
  const select = useCallback((q: QrCode) => {
    setSel(q);
    const st = { ...DEFAULT_STYLE, ...(q.style ?? {}) };
    setStyle(st);
    setSaved(st);
  }, []);

  const load = useCallback(
    async (keepSelId?: string) => {
      try {
        const [s, q] = await Promise.all([
          api<CampaignStats>(`/v1/campaigns/${id}/stats`),
          api<QrCode[]>(`/v1/campaigns/${id}/qr-codes`),
        ]);
        setStats(s);
        setLoadErr('');
        setQrs(q);
        const pick = q.find((x) => x.id === keepSelId) ?? q[0] ?? null;
        if (pick) select(pick);
        else setSel(null);
      } catch (e: any) {
        setLoadErr(e.message);
        toast.error(e.message);
      }
    },
    [id, select],
  );

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    setMe(getOrg());
    load();
  }, [r, load]);

  // Its own effect, keyed on the window: changing the reporting window must not re-fetch the
  // QR codes and reset the style editor out from under an unsaved edit.
  useEffect(() => {
    if (!token()) return;
    api<Analytics>(`/v1/campaigns/${id}/analytics?days=${days}`)
      .then(setAudience)
      .catch((e: any) => toast.error(e.message));
  }, [id, days]);

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

  if (!me) return null;

  const isPromoter = me.type === 'promoter';
  const items: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'overview', href: '/dashboard' },
    { id: 'partnerships', label: 'Partnerships', icon: 'partnerships', href: '/dashboard?s=partnerships' },
    { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', href: '/dashboard?s=campaigns' },
    { id: 'redemptions', label: 'Redemptions', icon: 'redemptions', href: '/dashboard?s=redemptions' },
    ...(isPromoter
      ? []
      : [{ id: 'settings', label: 'Settings', icon: 'settings' as const, href: '/dashboard?s=settings' }]),
  ];
  const backToCampaigns = (
    <Link className={link} href="/dashboard?s=campaigns">
      ← All campaigns
    </Link>
  );

  // The shell arrives with the rail intact while the campaign's numbers are in flight — a blank
  // page is indistinguishable from a broken one. A *failed* load is a third state: it must say
  // so and offer a way back, not shimmer forever.
  if (!stats)
    return (
      <Shell org={me} active="campaigns" items={items} title="Campaign" actions={backToCampaigns}>
        <h2 className={sectionHead}>Performance</h2>
        {loadErr ? <LoadError message={loadErr} onRetry={() => load()} /> : <SkeletonStrip className="mt-3" />}
      </Shell>
    );

  return (
    <Shell
      org={me}
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
            campaignId={id}
            qrs={qrs}
            sel={sel}
            onSelect={select}
            style={style}
            busy={busy}
            act={act}
            reload={load}
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
                reload={load}
              />
            </>
          )}
        </>
      )}
    </Shell>
  );
}
