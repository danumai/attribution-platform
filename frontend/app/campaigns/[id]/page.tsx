'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { API, api, org as getOrg, token } from '@/lib/api';
import { toast } from '@/lib/ui';

type Style = {
  dark?: string;
  light?: string;
  size?: number;
  margin?: number;
  ecc?: 'L' | 'M' | 'Q' | 'H';
  logo?: string;
  logoScale?: number;
};

const PRESETS: { name: string; style: Style }[] = [
  { name: 'Classic', style: { dark: '#000000', light: '#ffffff', margin: 2, ecc: 'M' } },
  { name: 'Midnight', style: { dark: '#0f172a', light: '#f8fafc', margin: 3, ecc: 'Q' } },
  { name: 'Indigo', style: { dark: '#3730a3', light: '#ffffff', margin: 3, ecc: 'Q' } },
  { name: 'Forest', style: { dark: '#14532d', light: '#f0fdf4', margin: 3, ecc: 'Q' } },
  { name: 'Crimson', style: { dark: '#7f1d1d', light: '#fff1f2', margin: 3, ecc: 'Q' } },
  { name: 'Transparent', style: { dark: '#111827', light: '#0000', margin: 2, ecc: 'Q' } },
];

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const r = useRouter();
  const [me, setMe] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [qrs, setQrs] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [style, setStyle] = useState<Style>(PRESETS[0].style);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([
        api(`/v1/campaigns/${id}/stats`),
        api(`/v1/campaigns/${id}/qr-codes`),
      ]);
      setStats(s);
      setQrs(q);
      setSel((cur: any) => cur ?? q[0] ?? null);
      if (!sel && q[0]) setStyle({ ...PRESETS[0].style, ...q[0].style });
    } catch (e: any) {
      toast.error(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    setMe(getOrg());
    load();
  }, [r, load]);

  const previewUrl = useMemo(() => {
    if (!sel) return '';
    return `${API}/v1/qr-codes/${sel.id}/image?format=svg&style=${encodeURIComponent(
      JSON.stringify(style),
    )}&t=${sel.id}`;
  }, [sel, style]);

  function onLogo(e: any) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200_000) return toast.error('Logo must be under 200KB.');
    const fr = new FileReader();
    fr.onload = () => setStyle({ ...style, logo: String(fr.result), ecc: 'H', logoScale: style.logoScale ?? 0.2 });
    fr.readAsDataURL(file);
  }

  async function act(fn: () => Promise<any>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me || !stats) return null;
  const isPromoter = me.type === 'promoter';

  return (
    <main>
      <div className="topbar">
        <Link href="/dashboard">← Dashboard</Link>
        <span className="muted">{me.name}</span>
      </div>

      <div className="card row" style={{ justifyContent: 'space-around' }}>
        <div className="stat">
          <b>{stats.scans}</b>
          <span className="muted">scans</span>
        </div>
        <div className="stat">
          <b>{stats.redemptions}</b>
          <span className="muted">rewards granted</span>
        </div>
        <div className="stat">
          <b>{stats.coins_granted}</b>
          <span className="muted">coins granted</span>
        </div>
        <div className="stat">
          <b>{stats.budget_remaining}</b>
          <span className="muted">budget left</span>
        </div>
      </div>

      {isPromoter && (
        <>
          <h2>QR codes</h2>
          <div className="card">
            <div className="row">
              {qrs.map((q) => (
                <button
                  key={q.id}
                  className={q.id === sel?.id ? '' : 'ghost'}
                  style={{ margin: 0 }}
                  onClick={() => {
                    setSel(q);
                    setStyle({ ...PRESETS[0].style, ...q.style });
                  }}
                >
                  /{q.code}
                </button>
              ))}
              <button
                className="ghost"
                style={{ margin: 0 }}
                onClick={() =>
                  act(async () => {
                    const q = await api(`/v1/campaigns/${id}/qr-codes`, {
                      method: 'POST',
                      body: JSON.stringify({ style }),
                    });
                    setSel(q);
                    await load();
                  })
                }
              >
                + New QR code
              </button>
            </div>
          </div>

          {sel && (
            <div className="card row" style={{ alignItems: 'flex-start', gap: 24 }}>
              <div style={{ flex: '1 1 300px', minWidth: 280 }}>
                <b>Design</b>
                <label>Presets</label>
                <div className="row" style={{ gap: 6 }}>
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      className="ghost"
                      style={{ margin: 0, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setStyle({ ...style, ...p.style, logo: style.logo })}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>

                <div className="row">
                  <div style={{ flex: 1 }}>
                    <label>Module color</label>
                    <input
                      type="color"
                      value={style.dark ?? '#000000'}
                      onChange={(e) => setStyle({ ...style, dark: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Background</label>
                    <input
                      type="color"
                      value={style.light === '#0000' ? '#ffffff' : style.light ?? '#ffffff'}
                      onChange={(e) => setStyle({ ...style, light: e.target.value })}
                    />
                  </div>
                </div>
                <label>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginRight: 6 }}
                    checked={style.light === '#0000'}
                    onChange={(e) =>
                      setStyle({ ...style, light: e.target.checked ? '#0000' : '#ffffff' })
                    }
                  />
                  Transparent background
                </label>

                <label>Size: {style.size ?? 512}px</label>
                <input
                  type="range"
                  min={128}
                  max={2048}
                  step={64}
                  value={style.size ?? 512}
                  onChange={(e) => setStyle({ ...style, size: +e.target.value })}
                />

                <label>Quiet zone: {style.margin ?? 2} modules</label>
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={style.margin ?? 2}
                  onChange={(e) => setStyle({ ...style, margin: +e.target.value })}
                />

                <label>Error correction {style.logo ? '(forced to H for logo)' : ''}</label>
                <select
                  value={style.ecc ?? 'M'}
                  disabled={!!style.logo}
                  onChange={(e) => setStyle({ ...style, ecc: e.target.value as any })}
                >
                  <option value="L">L — 7% recovery, densest</option>
                  <option value="M">M — 15% recovery</option>
                  <option value="Q">Q — 25% recovery</option>
                  <option value="H">H — 30% recovery, print-safe</option>
                </select>

                <label>Center logo (PNG/JPEG/SVG, under 200KB)</label>
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={onLogo} />
                {style.logo && (
                  <>
                    <label>Logo size: {Math.round((style.logoScale ?? 0.2) * 100)}% of width</label>
                    <input
                      type="range"
                      min={10}
                      max={25}
                      value={Math.round((style.logoScale ?? 0.2) * 100)}
                      onChange={(e) => setStyle({ ...style, logoScale: +e.target.value / 100 })}
                    />
                    <button
                      className="ghost"
                      onClick={() => setStyle({ ...style, logo: undefined, logoScale: undefined })}
                    >
                      Remove logo
                    </button>
                  </>
                )}

                <div className="row">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api(`/v1/qr-codes/${sel.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ style }),
                        });
                        toast.success('Design saved to this QR code.');
                        await load();
                      })
                    }
                  >
                    {busy ? 'Saving…' : 'Save design'}
                  </button>
                  <a
                    href={`${API}/v1/qr-codes/${sel.id}/image?format=svg&style=${encodeURIComponent(
                      JSON.stringify(style),
                    )}`}
                    download={`qr-${sel.code}.svg`}
                  >
                    <button className="ghost">Download SVG (print)</button>
                  </a>
                  {!style.logo && (
                    <a
                      href={`${API}/v1/qr-codes/${sel.id}/image?format=png&style=${encodeURIComponent(
                        JSON.stringify(style),
                      )}`}
                      download={`qr-${sel.code}.png`}
                    >
                      <button className="ghost">Download PNG</button>
                    </a>
                  )}
                </div>
              </div>

              <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                <div
                  className="qrbox"
                  style={{
                    background:
                      style.light === '#0000'
                        ? 'repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 50%/16px 16px'
                        : '#fff',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="QR preview" />
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  {sel.scan_url}
                </p>
                <p className="muted">Live preview · validated server-side</p>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
