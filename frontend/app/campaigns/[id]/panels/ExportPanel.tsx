'use client';
import { api } from '@/lib/api';
import { confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import type { QrCode } from '@/lib/types';
import { download, svgToPng } from '@/lib/qr';
import { btn, btnDanger, btnGhost, chip, chipWide, cx, field, hint, label as labelClass, swatches } from '@/lib/tw';

const SIZES = [512, 1024, 2048, 4096];

export function ExportPanel({
  sel,
  svg,
  busy,
  exportPx,
  onExportPx,
  act,
  reload,
}: {
  sel: QrCode;
  svg: string;
  busy: boolean;
  exportPx: number;
  onExportPx: (px: number) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  reload: (keepSelId?: string) => Promise<void>;
}) {
  return (
    <>
      <label className={labelClass}>Raster size — {exportPx}px</label>
      <div className={swatches}>
        {SIZES.map((px) => (
          <button
            key={px}
            type="button"
            className={cx(chip(px === exportPx), chipWide)}
            aria-checked={px === exportPx}
            role="radio"
            onClick={() => onExportPx(px)}
          >
            {px}
          </button>
        ))}
      </div>
      <p className={hint}>
        SVG is the one to send to a printer — it stays sharp at any size. PNG is for slides and
        the web.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className={btn}
          disabled={!svg}
          onClick={() => {
            download(new Blob([svg], { type: 'image/svg+xml' }), `qr-${sel.code}.svg`);
            toast.success('SVG downloaded.');
          }}
        >
          Download SVG
        </button>
        <button
          className={btnGhost}
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

      <label className={labelClass}>Scan destination</label>
      <div className="flex flex-wrap items-center gap-3">
        <input className={field} readOnly value={sel.scan_url} onFocus={(e) => e.target.select()} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={btnGhost}
          onClick={() => {
            navigator.clipboard.writeText(sel.scan_url);
            toast.success('Scan URL copied.');
          }}
        >
          Copy URL
        </button>
        <a className={btnGhost} href={sel.scan_url} target="_blank" rel="noreferrer">
          Test the scan flow
        </a>
      </div>

      <label className={labelClass}>Danger zone</label>
      <button
        className={btnDanger}
        disabled={busy || sel.voided}
        onClick={async () => {
          const go = await confirmDialog({
            title: `Void /${sel.code}?`,
            body: 'Every printed copy of this code stops working immediately. This cannot be undone from here.',
            confirmText: 'Void this code',
            danger: true,
          });
          if (!go) return;
          await act(async () => {
            await api(`/v1/qr-codes/${sel.id}/void`, { method: 'POST' });
            await reload(sel.id);
            toast.success(`/${sel.code} is voided.`);
          });
        }}
      >
        {sel.voided ? 'Already voided' : 'Void this code'}
      </button>
    </>
  );
}
