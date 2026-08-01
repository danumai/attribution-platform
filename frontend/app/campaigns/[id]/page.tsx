'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { API, api, org as getOrg, token } from '@/lib/api';
import { confirmDialog, toast } from '@/lib/ui';
import {
  DEFAULT_STYLE,
  EYE_BALLS,
  EYE_FRAMES,
  FRAMES,
  PRESETS,
  SHAPES,
  Style,
  contrastProblem,
  download,
  isTransparent,
  readLogo,
  renderPreview,
  svgToPng,
} from '@/lib/qr';

/* ---------------- small building blocks ---------------- */

/** Miniature of each module shape, so the picker shows the thing instead of naming it. */
function ShapeIcon({ kind }: { kind: string }) {
  const cells = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c * 7 + 1.5, r * 7 + 1.5] as const));
  return (
    <svg viewBox="0 0 22 22" aria-hidden="true" fill="currentColor">
      {kind === 'bars'
        ? [0, 1, 2].map((c) => <rect key={c} x={c * 7 + 1.5} y={1.5} width={5} height={19} rx={2.5} />)
        : cells.map(([x, y], i) =>
            kind === 'dots' ? (
              <circle key={i} cx={x + 2.5} cy={y + 2.5} r={2.5} />
            ) : kind === 'diamond' ? (
              <path key={i} d={`M${x + 2.5},${y} L${x + 5},${y + 2.5} L${x + 2.5},${y + 5} L${x},${y + 2.5} Z`} />
            ) : (
              <rect key={i} x={x} y={y} width={5} height={5} rx={kind === 'rounded' ? 1.8 : 0} />
            ),
          )}
    </svg>
  );
}

function EyeIcon({ kind, ball }: { kind: string; ball?: boolean }) {
  if (ball)
    return (
      <svg viewBox="0 0 22 22" aria-hidden="true" fill="currentColor">
        {kind === 'circle' ? (
          <circle cx="11" cy="11" r="6" />
        ) : kind === 'diamond' ? (
          <path d="M11,4 L18,11 L11,18 L4,11 Z" />
        ) : (
          <rect x="5" y="5" width="12" height="12" rx={kind === 'rounded' ? 4 : 0} />
        )}
      </svg>
    );
  return (
    <svg viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6">
      {kind === 'circle' ? (
        <circle cx="11" cy="11" r="8" />
      ) : kind === 'leaf' ? (
        <path d="M7,3 H19 V15 A4,4 0 0 1 15,19 H3 V7 A4,4 0 0 1 7,3 Z" />
      ) : (
        <rect x="3" y="3" width="16" height="16" rx={kind === 'rounded' ? 5 : 0} />
      )}
    </svg>
  );
}

/**
 * One 11x11 proof, pulled identically for every preset — same code, different plate — so the
 * only thing that varies between swatches is the thing the preset actually changes.
 * `F` marks the three finder zones, which are drawn as eyes rather than as modules.
 */
const PROOF = [
  'FFF#..#.FFF',
  'FFF.#.#.FFF',
  'FFF##..#FFF',
  '.#..##.#..#',
  '#.##..##.#.',
  '#.#.#..##.#',
  '.#..##..#.#',
  '##.#..#.##.',
  'FFF.#..##.#',
  'FFF#.#.#.#.',
  'FFF#.##..##',
];
const U = 4; // one module, in proof units
const FINDERS = [[0, 0], [8, 0], [0, 8]] as const;

function Finder({ col, row, frame, ball, ink, ballInk }: { col: number; row: number; frame: string; ball: string; ink: string; ballInk: string }) {
  const s = 3 * U;
  const m = s / 2;
  return (
    <g transform={`translate(${col * U} ${row * U})`}>
      {frame === 'circle' ? (
        <circle cx={m} cy={m} r={m - 1} fill="none" stroke={ink} strokeWidth="2" />
      ) : frame === 'leaf' ? (
        <path d={`M3,1 H${s - 1} V${s - 3} A2,2 0 0 1 ${s - 3},${s - 1} H1 V3 A2,2 0 0 1 3,1 Z`} fill="none" stroke={ink} strokeWidth="2" />
      ) : (
        <rect x="1" y="1" width={s - 2} height={s - 2} rx={frame === 'rounded' ? 3.5 : 0} fill="none" stroke={ink} strokeWidth="2" />
      )}
      {ball === 'circle' ? (
        <circle cx={m} cy={m} r="2.4" fill={ballInk} />
      ) : ball === 'diamond' ? (
        <path d={`M${m},${m - 2.7} L${m + 2.7},${m} L${m},${m + 2.7} L${m - 2.7},${m} Z`} fill={ballInk} />
      ) : (
        <rect x={m - 2.4} y={m - 2.4} width="4.8" height="4.8" rx={ball === 'rounded' ? 1.6 : 0} fill={ballInk} />
      )}
    </g>
  );
}

/**
 * A printed proof of the preset, not a colour chip. Module shape, eye treatment, ink and
 * frame are the whole difference between one preset and the next, so the swatch prints all
 * four at a size where they are actually tellable apart.
 */
function PresetProof({ style, id }: { style: Style; id: string }) {
  const { shape = 'square', eyeFrame = 'square', eyeBall = 'square', gradient, frame } = style;
  const ink = gradient ? `url(#${id})` : style.dark ?? '#000';
  const eyeInk = style.eyeColor ?? ink;
  const ballInk = style.eyeBallColor ?? eyeInk;
  const framed = !!frame && frame !== 'none';
  const box = frame === 'box';
  const cells = PROOF.flatMap((row, r) =>
    row.split('').flatMap((ch, c) => (ch === '#' ? [[c * U, r * U] as const] : [])),
  );
  const code = 11 * U;
  // A framed preset prints a rule or a caption strip around the code, so the proof shrinks
  // its plate to make room rather than growing — every swatch on the sheet stays one square.
  const plate = !framed ? undefined : box ? 'translate(5.5 5.5) scale(.75)' : 'translate(4.4 1) scale(.8)';

  return (
    <svg
      className="preset-proof"
      viewBox={`-3 -3 ${code + 6} ${code + 6}`}
      aria-hidden="true"
      style={isTransparent(style.light) ? { background: checker(7) } : undefined}
    >
      {gradient && (
        <defs>
          {gradient.type === 'radial' ? (
            <radialGradient id={id}>
              <stop offset="0%" stopColor={gradient.from} />
              <stop offset="100%" stopColor={gradient.to} />
            </radialGradient>
          ) : (
            <linearGradient id={id} gradientTransform={`rotate(${gradient.angle ?? 45} .5 .5)`}>
              <stop offset="0%" stopColor={gradient.from} />
              <stop offset="100%" stopColor={gradient.to} />
            </linearGradient>
          )}
        </defs>
      )}
      <rect x="-3" y="-3" width={code + 6} height={code + 6} fill={style.light ?? '#fff'} />

      <g transform={plate}>
        {cells.map(([x, y], i) =>
          shape === 'dots' ? (
            <circle key={i} cx={x + U / 2} cy={y + U / 2} r={U / 2 - 0.25} fill={ink} />
          ) : shape === 'diamond' ? (
            <path key={i} d={`M${x + U / 2},${y} L${x + U},${y + U / 2} L${x + U / 2},${y + U} L${x},${y + U / 2} Z`} fill={ink} />
          ) : shape === 'bars' ? (
            // full-height so vertically adjacent modules fuse into one stripe, as the renderer does
            <rect key={i} x={x + 0.75} y={y} width={U - 1.5} height={U} rx="0.5" fill={ink} />
          ) : (
            // a shallow radius — at 1.5 a rounded module is a circle, and `rounded` has to
            // stay tellable apart from `dots` at swatch size
            <rect key={i} x={x} y={y} width={U - 0.3} height={U - 0.3} rx={shape === 'rounded' ? 0.9 : 0} fill={ink} />
          ),
        )}
        {FINDERS.map(([col, row]) => (
          <Finder key={`${col}-${row}`} col={col} row={row} frame={eyeFrame} ball={eyeBall} ink={eyeInk} ballInk={ballInk} />
        ))}
      </g>

      {/* a frame preset prints a rule or a captioned strip around the code — show which */}
      {box && <rect x="2.5" y="2.5" width={code - 5} height={code - 5} fill="none" stroke={style.frameColor ?? ink} strokeWidth="2" />}
      {framed && !box && (
        <>
          <rect x="-3" y="39" width={code + 6} height="8" rx={frame === 'ribbon' ? 2 : 0} fill={style.frameColor ?? ink} />
          <rect x={code / 2 - 11} y="42" width="22" height="2" rx="1" fill={style.frameTextColor ?? '#fff'} opacity=".85" />
        </>
      )}
    </svg>
  );
}

/** The style keys a preset owns — used to tell which preset, if any, is currently on the plate. */
const PRESET_KEYS = ['dark', 'light', 'margin', 'shape', 'eyeFrame', 'eyeBall', 'eyeColor', 'eyeBallColor', 'gradient', 'frame', 'frameText', 'frameColor', 'frameTextColor'] as const;

const samePlate = (a: Style, b: Style) =>
  PRESET_KEYS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

function Choice({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: any) => void;
  render: (v: string) => React.ReactNode;
}) {
  return (
    <div className="swatches" role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          aria-label={o}
          title={o}
          className="chip"
          onClick={() => onChange(o)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

/** Colour well: the picker plus the hex, because a brand colour arrives as a hex string. */
function Color({ label, value, onChange, fallback = '#000000' }: { label: string; value?: string; onChange: (v: string) => void; fallback?: string }) {
  const v = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return (
    <div className="colorwell">
      <label>{label}</label>
      <div className="colorwell-row">
        <input type="color" value={v} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <input
          className="hex"
          value={value ?? fallback}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );
}

/** Drop / paste / browse target for the centre logo. */
function LogoWell({ logo, onPick, onClear }: { logo?: string; onPick: (f: File) => void; onClear: () => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // paste anywhere on the page while the studio is open
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? [])[0];
      if (f) onPick(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPick]);

  if (logo)
    return (
      <div className="logo-well has-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="Selected logo" />
        <div className="logo-well-meta">
          <b>Logo attached</b>
          <span className="muted">~{Math.round((logo.length * 0.75) / 1024)}KB embedded</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="ghost tiny" onClick={() => input.current?.click()}>
              Replace
            </button>
            <button type="button" className="ghost tiny" onClick={onClear}>
              Remove
            </button>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          hidden
          onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
        />
      </div>
    );

  return (
    <div
      className={`logo-well${over ? ' over' : ''}`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      role="button"
      tabIndex={0}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.8" />
        <path d="m3.5 17 4.8-4.6a2 2 0 0 1 2.7 0L20.5 21" />
      </svg>
      <b>Drop a logo, paste, or browse</b>
      <span className="muted">PNG, JPEG or SVG · large images are resized for you</span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        hidden
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </div>
  );
}

/* ---------------- page ---------------- */

const PANELS = ['Style', 'Colour', 'Logo', 'Frame', 'Export'] as const;
type Panel = (typeof PANELS)[number];

/* transparency grid, sized to whatever it sits behind — a backdrop needs a coarser one than
   a 68px swatch, where 18px squares read as content rather than as "nothing here" */
const checker = (px: number) => `repeating-conic-gradient(#e2e2e2 0 25%, #fff 0 50%) 50%/${px}px ${px}px`;
const CHECKER = checker(18);
const BACKDROPS = [
  { name: 'White', css: '#ffffff' },
  { name: 'Paper', css: '#e7ddc9' },
  { name: 'Dark', css: '#1a1712' },
  { name: 'Checker', css: CHECKER },
];

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const r = useRouter();
  const [me, setMe] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [qrs, setQrs] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [saved, setSaved] = useState<Style>(DEFAULT_STYLE);
  const [panel, setPanel] = useState<Panel>('Style');
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState('');
  const [renderErr, setRenderErr] = useState('');
  const [rendering, setRendering] = useState(false);
  const [backdrop, setBackdrop] = useState(BACKDROPS[0]);
  const [exportPx, setExportPx] = useState(1024);
  const [newCode, setNewCode] = useState({ expires_in_days: 30, max_uses: '' });

  const load = useCallback(
    async (keepSelId?: string) => {
      try {
        const [s, q] = await Promise.all([
          api(`/v1/campaigns/${id}/stats`),
          api(`/v1/campaigns/${id}/qr-codes`),
        ]);
        setStats(s);
        setQrs(q);
        const pick = q.find((x: any) => x.id === keepSelId) ?? q[0] ?? null;
        setSel(pick);
        if (pick) {
          const st = { ...DEFAULT_STYLE, ...(pick.style ?? {}) };
          setStyle(st);
          setSaved(st);
        }
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    setMe(getOrg());
    load();
  }, [r, load]);

  // Debounced so dragging a slider does not fire a render per pixel.
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
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sel, style]);

  const previewSrc = useMemo(() => {
    if (!svg) return '';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [svg]);

  const dirty = useMemo(() => JSON.stringify(style) !== JSON.stringify(saved), [style, saved]);
  const warning = useMemo(() => contrastProblem(style), [style]);
  const set = (patch: Partial<Style>) => setStyle((s) => ({ ...s, ...patch }));

  /**
   * A preset is a whole plate, not a patch — every key it owns is replaced rather than merged,
   * so picking a flat preset off a gradient one actually clears the gradient instead of
   * leaving it printed underneath. The logo and the export size belong to the code, not the
   * plate, so they survive the swap.
   */
  const applyPreset = (p: Style) =>
    setStyle((s) => ({
      ...DEFAULT_STYLE,
      ...p,
      gradient: p.gradient ?? null,
      logo: s.logo,
      logoScale: s.logoScale,
      logoPad: s.logoPad,
      logoShape: s.logoShape,
      size: s.size,
      ecc: s.logo ? 'H' : p.ecc,
    }));

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

  async function pickLogo(file: File) {
    try {
      const logo = await readLogo(file);
      set({ logo, ecc: 'H', logoScale: style.logoScale ?? 0.2, logoPad: style.logoPad ?? 0.12, logoShape: style.logoShape ?? 'rounded' });
      setPanel('Logo');
      toast.success('Logo added — error correction raised to H so the code still scans.');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!me || !stats) return null;
  const isPromoter = me.type === 'promoter';
  const gradient = style.gradient ?? null;

  return (
    <main className="wide">
      <div className="topbar">
        <Link href="/dashboard">← Dashboard</Link>
        <span className="muted">{me.name}</span>
      </div>

      <h2>Performance</h2>
      <div className="card row statrow">
        {[
          ['scans', stats.scans],
          ['rewards granted', stats.redemptions],
          ['coins granted', stats.coins_granted],
          ['budget left', stats.budget_remaining],
        ].map(([k, v]) => (
          <div className="stat" key={k as string}>
            <b>{v as number}</b>
            <span className="muted">{k as string}</span>
          </div>
        ))}
      </div>

      {!isPromoter && (
        <p className="muted" style={{ marginTop: 18 }}>
          QR design is managed by the promoter on this campaign.
        </p>
      )}

      {isPromoter && (
        <>
          <h2>QR codes</h2>
          <div className="card">
            <div className="codebar">
              {qrs.map((q) => (
                <button
                  key={q.id}
                  className={`code-tab${q.id === sel?.id ? ' on' : ''}${q.voided ? ' voided' : ''}`}
                  onClick={() => {
                    setSel(q);
                    const st = { ...DEFAULT_STYLE, ...(q.style ?? {}) };
                    setStyle(st);
                    setSaved(st);
                  }}
                >
                  <code>/{q.code}</code>
                  <span className="muted">{q.voided ? 'voided' : `${q.uses ?? 0} scans`}</span>
                </button>
              ))}
            </div>

            <details className="newcode">
              <summary>+ New QR code</summary>
              <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
                <div style={{ flex: '1 1 160px' }}>
                  <label>Expires in (days, 0 = never)</label>
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    value={newCode.expires_in_days}
                    onChange={(e) => setNewCode({ ...newCode, expires_in_days: +e.target.value })}
                  />
                </div>
                <div style={{ flex: '1 1 160px' }}>
                  <label>Max scans (blank = unlimited)</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="unlimited"
                    value={newCode.max_uses}
                    onChange={(e) => setNewCode({ ...newCode, max_uses: e.target.value })}
                  />
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const q = await api(`/v1/campaigns/${id}/qr-codes`, {
                        method: 'POST',
                        body: JSON.stringify({
                          style,
                          expires_in_days: newCode.expires_in_days,
                          max_uses: newCode.max_uses ? +newCode.max_uses : null,
                        }),
                      });
                      await load(q.id);
                      toast.success(`Code /${q.code} created with the current design.`);
                    })
                  }
                >
                  {busy ? 'Creating…' : 'Create code'}
                </button>
              </div>
            </details>
          </div>

          {!sel && (
            <div className="card">
              <p className="muted">No codes yet — create one above and the design studio opens here.</p>
            </div>
          )}

          {sel && (
            <>
              <h2>Design studio</h2>
              <div className="studio">
                <div className="card studio-controls">
                  <div className="tabs" role="tablist">
                    {PANELS.map((p) => (
                      <button key={p} role="tab" aria-selected={p === panel} onClick={() => setPanel(p)}>
                        {p}
                      </button>
                    ))}
                  </div>

                  {panel === 'Style' && (
                    <>
                      <label>Presets</label>
                      <div className="presets" role="group" aria-label="Style presets">
                        {PRESETS.map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            className="preset"
                            aria-pressed={samePlate(style, p.style)}
                            onClick={() => applyPreset(p.style)}
                          >
                            <PresetProof style={p.style} id={`proof-${p.name.replace(/\W+/g, '-')}`} />
                            <span>{p.name}</span>
                          </button>
                        ))}
                      </div>
                      <p className="hint">A preset swaps the whole plate. Your logo and export size stay as they are.</p>

                      <label>Module shape</label>
                      <Choice options={SHAPES} value={style.shape ?? 'square'} onChange={(v) => set({ shape: v })} render={(v) => <ShapeIcon kind={v} />} />

                      <label>Eye frame</label>
                      <Choice options={EYE_FRAMES} value={style.eyeFrame ?? 'square'} onChange={(v) => set({ eyeFrame: v })} render={(v) => <EyeIcon kind={v} />} />

                      <label>Eye centre</label>
                      <Choice options={EYE_BALLS} value={style.eyeBall ?? 'square'} onChange={(v) => set({ eyeBall: v })} render={(v) => <EyeIcon kind={v} ball />} />

                      <label>Quiet zone — {style.margin ?? 2} modules</label>
                      <input type="range" min={0} max={10} value={style.margin ?? 2} onChange={(e) => set({ margin: +e.target.value })} />
                      <p className="hint">Under 2 modules of white space, some scanners lose the edge of the code.</p>

                      <label>
                        Error correction{style.logo ? ' — held at H while a logo covers the centre' : ''}
                      </label>
                      <select value={style.ecc ?? 'M'} disabled={!!style.logo} onChange={(e) => set({ ecc: e.target.value as any })}>
                        <option value="L">L — 7% recovery, densest code</option>
                        <option value="M">M — 15% recovery</option>
                        <option value="Q">Q — 25% recovery</option>
                        <option value="H">H — 30% recovery, print-safe</option>
                      </select>
                    </>
                  )}

                  {panel === 'Colour' && (
                    <>
                      <label>Fill</label>
                      <div className="tabs sub" role="tablist">
                        <button role="tab" aria-selected={!gradient} onClick={() => set({ gradient: null })}>
                          Solid
                        </button>
                        <button
                          role="tab"
                          aria-selected={!!gradient}
                          onClick={() => set({ gradient: gradient ?? { from: style.dark ?? '#1c39bb', to: '#7c1d6f', type: 'linear', angle: 45 } })}
                        >
                          Gradient
                        </button>
                      </div>

                      {!gradient ? (
                        <Color label="Module colour" value={style.dark} onChange={(dark) => set({ dark })} />
                      ) : (
                        <>
                          <div className="row">
                            <Color label="Gradient start" value={gradient.from} onChange={(from) => set({ gradient: { ...gradient, from } })} />
                            <Color label="Gradient end" value={gradient.to} onChange={(to) => set({ gradient: { ...gradient, to } })} />
                          </div>
                          <label>Gradient type</label>
                          <select value={gradient.type ?? 'linear'} onChange={(e) => set({ gradient: { ...gradient, type: e.target.value as any } })}>
                            <option value="linear">Linear</option>
                            <option value="radial">Radial</option>
                          </select>
                          {(gradient.type ?? 'linear') === 'linear' && (
                            <>
                              <label>Angle — {gradient.angle ?? 45}°</label>
                              <input type="range" min={0} max={360} value={gradient.angle ?? 45} onChange={(e) => set({ gradient: { ...gradient, angle: +e.target.value } })} />
                            </>
                          )}
                        </>
                      )}

                      <label>Background</label>
                      <Color label="Background colour" value={isTransparent(style.light) ? '#ffffff' : style.light} fallback="#ffffff" onChange={(light) => set({ light })} />
                      <label>
                        <input type="checkbox" checked={isTransparent(style.light)} onChange={(e) => set({ light: e.target.checked ? '#0000' : '#ffffff' })} />
                        Transparent background — for printing straight onto stock
                      </label>

                      <label>Finder eyes</label>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!style.eyeColor}
                          onChange={(e) => set({ eyeColor: e.target.checked ? style.dark ?? '#000000' : undefined, eyeBallColor: e.target.checked ? style.eyeBallColor : undefined })}
                        />
                        Give the corner eyes their own colour
                      </label>
                      {style.eyeColor && (
                        <div className="row">
                          <Color label="Eye frame" value={style.eyeColor} onChange={(eyeColor) => set({ eyeColor })} />
                          <Color label="Eye centre" value={style.eyeBallColor ?? style.eyeColor} onChange={(eyeBallColor) => set({ eyeBallColor })} />
                        </div>
                      )}
                    </>
                  )}

                  {panel === 'Logo' && (
                    <>
                      <LogoWell logo={style.logo} onPick={pickLogo} onClear={() => set({ logo: undefined, logoScale: undefined, logoPad: undefined, logoShape: undefined })} />
                      {style.logo ? (
                        <>
                          <label>Logo size — {Math.round((style.logoScale ?? 0.2) * 100)}% of the code</label>
                          <input type="range" min={10} max={30} value={Math.round((style.logoScale ?? 0.2) * 100)} onChange={(e) => set({ logoScale: +e.target.value / 100 })} />
                          <p className="hint">Past ~25% you are covering more than error correction can rebuild. Test the printed code before a run.</p>

                          <label>Backdrop</label>
                          <select value={style.logoShape ?? 'rounded'} onChange={(e) => set({ logoShape: e.target.value as any })}>
                            <option value="rounded">Rounded plate</option>
                            <option value="square">Square plate</option>
                            <option value="circle">Circle plate</option>
                            <option value="none">None — logo sits on the modules</option>
                          </select>

                          {style.logoShape !== 'none' && (
                            <>
                              <label>Plate padding — {Math.round((style.logoPad ?? 0.12) * 100)}%</label>
                              <input type="range" min={0} max={40} value={Math.round((style.logoPad ?? 0.12) * 100)} onChange={(e) => set({ logoPad: +e.target.value / 100 })} />
                            </>
                          )}
                        </>
                      ) : (
                        <p className="hint">A centre logo forces error correction to H, so the code survives having its middle covered.</p>
                      )}
                    </>
                  )}

                  {panel === 'Frame' && (
                    <>
                      <label>Frame</label>
                      <select value={style.frame ?? 'none'} onChange={(e) => set({ frame: e.target.value as any, frameText: style.frameText ?? 'SCAN ME' })}>
                        {FRAMES.map((f) => (
                          <option key={f} value={f}>
                            {{ none: 'None', box: 'Outline box', label: 'Box with caption bar', ribbon: 'Caption ribbon' }[f]}
                          </option>
                        ))}
                      </select>
                      {(style.frame ?? 'none') !== 'none' ? (
                        <>
                          <label>Call to action</label>
                          <input value={style.frameText ?? ''} maxLength={40} placeholder="SCAN FOR REWARDS" onChange={(e) => set({ frameText: e.target.value })} />
                          <p className="hint">{(style.frameText ?? '').length}/40 characters. Short lines print larger.</p>
                          <div className="row">
                            <Color label="Frame colour" value={style.frameColor ?? style.dark} onChange={(frameColor) => set({ frameColor })} />
                            <Color label="Caption text" value={style.frameTextColor ?? '#ffffff'} fallback="#ffffff" onChange={(frameTextColor) => set({ frameTextColor })} />
                          </div>
                        </>
                      ) : (
                        <p className="hint">A framed code with a caption converts better on printed material — people need telling what the square does.</p>
                      )}
                    </>
                  )}

                  {panel === 'Export' && (
                    <>
                      <label>Raster size — {exportPx}px</label>
                      <div className="swatches">
                        {[512, 1024, 2048, 4096].map((px) => (
                          <button key={px} type="button" className="chip wide" aria-checked={px === exportPx} role="radio" onClick={() => setExportPx(px)}>
                            {px}
                          </button>
                        ))}
                      </div>
                      <p className="hint">SVG is the one to send to a printer — it stays sharp at any size. PNG is for slides and the web.</p>

                      <div className="row">
                        <button
                          disabled={!svg}
                          onClick={() => {
                            download(new Blob([svg], { type: 'image/svg+xml' }), `qr-${sel.code}.svg`);
                            toast.success('SVG downloaded.');
                          }}
                        >
                          Download SVG
                        </button>
                        <button
                          className="ghost"
                          disabled={!svg}
                          onClick={() =>
                            act(async () => {
                              download(await svgToPng(svg, exportPx), `qr-${sel.code}-${exportPx}.png`);
                              toast.success(`PNG downloaded at ${exportPx}px.`);
                            })
                          }
                        >
                          Download PNG
                        </button>
                      </div>

                      <label>Scan destination</label>
                      <div className="row">
                        <input readOnly value={sel.scan_url} onFocus={(e) => e.target.select()} />
                      </div>
                      <div className="row">
                        <button
                          className="ghost"
                          onClick={() => {
                            navigator.clipboard.writeText(sel.scan_url);
                            toast.success('Scan URL copied.');
                          }}
                        >
                          Copy URL
                        </button>
                        <a href={sel.scan_url} target="_blank" rel="noreferrer">
                          <button className="ghost">Test the scan flow</button>
                        </a>
                      </div>

                      <label>Danger zone</label>
                      <button
                        className="danger"
                        disabled={busy || sel.voided}
                        onClick={async () => {
                          const go = await confirmDialog({
                            title: `Void /${sel.code}?`,
                            body: 'Every printed copy of this code stops working immediately. This cannot be undone from here.',
                            confirmText: 'Void this code',
                            danger: true,
                          });
                          if (go)
                            act(async () => {
                              await api(`/v1/qr-codes/${sel.id}/void`, { method: 'POST' });
                              await load(sel.id);
                              toast.success(`/${sel.code} is voided.`);
                            });
                        }}
                      >
                        {sel.voided ? 'Already voided' : 'Void this code'}
                      </button>
                    </>
                  )}
                </div>

                <div className="studio-preview">
                  <div className="card">
                    <div className="preview-head">
                      <b>Live preview</b>
                      <span className="muted">{rendering ? 'rendering…' : dirty ? 'unsaved changes' : 'saved'}</span>
                    </div>

                    <div className="qrbox" style={{ background: backdrop.css }}>
                      {previewSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewSrc} alt={`QR code for ${sel.code}`} />
                      ) : (
                        <div className="skeleton" style={{ width: '70%', height: '70%', borderRadius: 8 }} />
                      )}
                    </div>

                    <div className="swatches" style={{ marginTop: 12 }}>
                      {BACKDROPS.map((b) => (
                        <button
                          key={b.name}
                          type="button"
                          className="chip"
                          role="radio"
                          aria-checked={b.name === backdrop.name}
                          title={`Preview on ${b.name.toLowerCase()}`}
                          onClick={() => setBackdrop(b)}
                        >
                          <span className="backdrop-chip" style={{ background: b.css }} />
                        </button>
                      ))}
                    </div>

                    {renderErr && <p className="err">{renderErr}</p>}
                    {!renderErr && warning && <p className="warn">{warning}</p>}

                    <p className="muted" style={{ marginTop: 12, wordBreak: 'break-all' }}>
                      {sel.scan_url}
                    </p>

                    <div className="row">
                      <button
                        disabled={busy || !dirty}
                        onClick={() =>
                          act(async () => {
                            await api(`/v1/qr-codes/${sel.id}`, { method: 'PATCH', body: JSON.stringify({ style }) });
                            setSaved(style);
                            await load(sel.id);
                            toast.success('Design saved — the stored code renders this way from now on.');
                          })
                        }
                      >
                        {busy ? 'Saving…' : dirty ? 'Save design' : 'Saved'}
                      </button>
                      <button className="ghost" disabled={!dirty} onClick={() => setStyle(saved)}>
                        Revert
                      </button>
                    </div>
                    <p className="hint">
                      Saving changes how <code>{`${API}/v1/qr-codes/${sel.id}/image`}</code> renders. It never changes
                      what the code points at, so anything already printed keeps working.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
