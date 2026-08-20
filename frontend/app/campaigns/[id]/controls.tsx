'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { btnTinyGhost, chip, colorField, colorwell, cx, field, label as labelClass, logoWell, swatches } from '@/lib/tw';

/** A radio group drawn as swatches — the option renders itself rather than being named. */
export function Choice({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: any) => void;
  render: (v: string) => ReactNode;
}) {
  return (
    <div className={swatches} role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          aria-label={o}
          title={o}
          className={chip(o === value)}
          onClick={() => onChange(o)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

/** Colour well: the picker plus the hex, because a brand colour arrives as a hex string. */
export function Color({
  label,
  value,
  onChange,
  fallback = '#000000',
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  fallback?: string;
}) {
  const v = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return (
    <div className={colorwell}>
      <label className={cx(labelClass, 'mt-3.5')}>{label}</label>
      <div className="flex gap-2">
        <input
          className={cx(colorField, 'w-13 flex-[0_0_52px]')}
          type="color"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          className={cx(field, 'font-mono text-[13px] lowercase')}
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
export function LogoWell({
  logo,
  onPick,
  onClear,
}: {
  logo?: string;
  onPick: (f: File) => void;
  onClear: () => void;
}) {
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

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/svg+xml"
      hidden
      onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
    />
  );

  if (logo)
    return (
      <div className={logoWell('filled')}>
        {/* Literally white, and not `bg-card`: a logo is usually a transparent PNG, and the
            ground it has to be judged against is the one it will be printed on — the code's
            light modules. A themed surface here would preview a lie. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="size-15.5 shrink-0 rounded-md border border-line bg-white object-contain p-1.5"
          src={logo}
          alt="Selected logo"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <b className="text-sm font-semibold">Logo attached</b>
          <span className="text-[12.5px] text-mut">
            ~{Math.round((logo.length * 0.75) / 1024)}KB embedded
          </span>
          <div className="mt-1 flex gap-2">
            <button type="button" className={btnTinyGhost} onClick={() => input.current?.click()}>
              Replace
            </button>
            <button type="button" className={btnTinyGhost} onClick={onClear}>
              Remove
            </button>
          </div>
        </div>
        {picker}
      </div>
    );

  return (
    <div
      className={logoWell(over ? 'over' : 'idle')}
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
      <b className="text-sm font-semibold">Drop a logo, paste, or browse</b>
      <span className="text-[12.5px] text-mut">
        PNG, JPEG or SVG · large images are resized for you
      </span>
      {picker}
    </div>
  );
}
