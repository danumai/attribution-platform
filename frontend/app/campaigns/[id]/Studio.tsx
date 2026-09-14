'use client';
import { useMemo, useState } from 'react';
import { API, api } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import type { QrCode } from '@/lib/types';
import { DEFAULT_STYLE, Style, contrastProblem, readLogo } from '@/lib/qr';
import {
  alertErr,
  alertWarn,
  btn,
  btnGhost,
  card,
  chip,
  code as codeChip,
  cx,
  hint,
  muted,
  previewHead,
  qrbox,
  skeleton,
  stampCaps,
  studio,
  studioPreview,
  swatches,
  tab,
  tabs,
} from '@/lib/tw';
import { checker } from './proof';
import { ColourPanel } from './panels/ColourPanel';
import { ExportPanel } from './panels/ExportPanel';
import { FramePanel } from './panels/FramePanel';
import { LogoPanel } from './panels/LogoPanel';
import { StylePanel } from './panels/StylePanel';

const PANELS = ['Style', 'Colour', 'Logo', 'Frame', 'Export'] as const;
type Panel = (typeof PANELS)[number];

const BACKDROPS = [
  { name: 'White', css: '#ffffff' },
  { name: 'Paper', css: '#e7ddc9' },
  { name: 'Dark', css: '#1a1712' },
  { name: 'Checker', css: checker(18) },
];

export function Studio({
  sel,
  style,
  setStyle,
  saved,
  setSaved,
  svg,
  renderErr,
  rendering,
  busy,
  act,
  reload,
}: {
  sel: QrCode;
  style: Style;
  setStyle: (fn: (s: Style) => Style) => void;
  saved: Style;
  setSaved: (s: Style) => void;
  svg: string;
  renderErr: string;
  rendering: boolean;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  reload: (keepSelId?: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>('Style');
  const [backdrop, setBackdrop] = useState(BACKDROPS[0]);
  const [exportPx, setExportPx] = useState(1024);

  const previewSrc = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''),
    [svg],
  );
  const dirty = useMemo(() => JSON.stringify(style) !== JSON.stringify(saved), [style, saved]);
  const warning = useMemo(() => contrastProblem(style), [style]);

  const set = (patch: Partial<Style>) => setStyle((s) => ({ ...s, ...patch }));

/**
 * A preset is a whole plate, not a patch — every key it owns is replaced rather than merged, so
 * picking a flat preset off a gradient one actually clears the gradient.
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

  async function pickLogo(file: File) {
    try {
      const logo = await readLogo(file);
      set({
        logo,
        ecc: 'H',
        logoScale: style.logoScale ?? 0.2,
        logoPad: style.logoPad ?? 0.12,
        logoShape: style.logoShape ?? 'rounded',
      });
      setPanel('Logo');
      toast.success('Logo added — error correction raised to H so the code still scans.');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className={studio}>
      <div className={cx(card, 'mt-3')}>
        <div className={cx(tabs, 'mb-1')} role="tablist">
          {PANELS.map((p) => (
            <button
              key={p}
              className={tab(p === panel)}
              role="tab"
              aria-selected={p === panel}
              onClick={() => setPanel(p)}
            >
              {p}
            </button>
          ))}
        </div>

        {panel === 'Style' && <StylePanel style={style} set={set} applyPreset={applyPreset} />}
        {panel === 'Colour' && <ColourPanel style={style} set={set} />}
        {panel === 'Logo' && <LogoPanel style={style} set={set} onPick={pickLogo} />}
        {panel === 'Frame' && <FramePanel style={style} set={set} />}
        {panel === 'Export' && (
          <ExportPanel
            sel={sel}
            svg={svg}
            busy={busy}
            exportPx={exportPx}
            onExportPx={setExportPx}
            act={act}
            reload={reload}
          />
        )}
      </div>

      <div className={studioPreview}>
        <div className={cx(card, 'mt-3')}>
          <div className={previewHead}>
            <b className="text-sm font-[650] tracking-[-0.015em]">Live preview</b>
            <span className={stampCaps}>
              {rendering ? 'rendering…' : dirty ? 'unsaved changes' : 'saved'}
            </span>
          </div>

          <div className={qrbox} style={{ background: backdrop.css }}>
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt={`QR code for ${sel.code}`} />
            ) : (
              <div className={skeleton} style={{ width: '70%', height: '70%', borderRadius: 8 }} />
            )}
          </div>

          <div className={cx(swatches, 'mt-3')}>
            {BACKDROPS.map((b) => (
              <button
                key={b.name}
                type="button"
                className={chip(b.name === backdrop.name)}
                role="radio"
                aria-checked={b.name === backdrop.name}
                title={`Preview on ${b.name.toLowerCase()}`}
                onClick={() => setBackdrop(b)}
              >
                <span className="size-5.5 rounded-sm border border-line" style={{ background: b.css }} />
              </button>
            ))}
          </div>

          {renderErr && <p className={cx(alertErr, 'mt-3.5')}>{renderErr}</p>}
          {!renderErr && warning && <p className={cx(alertWarn, 'mt-3.5')}>{warning}</p>}

          <p className={cx(muted, 'mt-3 break-all')}>{sel.scan_url}</p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className={btn}
              disabled={busy || !dirty}
              onClick={() =>
                act(async () => {
                  await api(`/v1/qr-codes/${sel.id}`, { method: 'PATCH', body: JSON.stringify({ style }) });
                  setSaved(style);
                  await reload(sel.id);
                  toast.success('Design saved — the stored code renders this way from now on.');
                })
              }
            >
              {busy ? 'Saving…' : dirty ? 'Save design' : 'Saved'}
            </button>
            <button className={btnGhost} disabled={!dirty} onClick={() => setStyle(() => saved)}>
              Revert
            </button>
          </div>
          <p className={hint}>
            Saving changes how <code className={codeChip}>{`${API}/v1/qr-codes/${sel.id}/image`}</code>{' '}
            renders. It never changes what the code points at, so anything already printed keeps
            working.
          </p>
        </div>
      </div>
    </div>
  );
}
